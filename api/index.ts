import express, { type Request, Response, NextFunction } from "express";

const SUMOPOD_BASE_URL = "https://ai.sumopod.com/v1/chat/completions";

async function callSumopodAPI(apiKey: string, model: string, dataURL: string): Promise<any> {
  const requestBody = {
    model,
    temperature: 0.2,
    max_tokens: 4000,
    messages: [
      {
        role: "system",
        content:
          "You are a pediatric nutrition and food composition expert. Respond with STRICT JSON only per the provided schema. No extra text.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Analyze this image. Identify each distinct food item (e.g., nasi goreng, kerupuk, sayur, telur, sosis). For each item, estimate serving_est_g and provide nutrition fields. Provide composition bounding boxes as normalized bbox (x,y,w,h) in [0..1]. Sum all items into totals. Reply strictly with JSON schema only.",
          },
          {
            type: "image_url",
            image_url: {
              url: dataURL,
            },
          },
        ],
      },
    ],
  };

  const response = await fetch(SUMOPOD_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sumopod API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return content;
}

function extractJSON(text: string): object {
  try {
    return JSON.parse(text);
  } catch {
    let cleanedText = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
    try {
      return JSON.parse(cleanedText);
    } catch {
      const firstBrace = cleanedText.indexOf("{");
      const lastBrace = cleanedText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = cleanedText.substring(firstBrace, lastBrace + 1);
        return JSON.parse(jsonStr);
      }
      throw new Error("No JSON found in response");
    }
  }
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Upload image analysis using GEMINI
app.post("/api/analyze-image", async (req: Request, res: Response) => {
  try {
    const { dataURL } = req.body as { dataURL?: string };
    if (!dataURL) {
      return res.status(400).json({ message: "dataURL is required" });
    }
    // Siapkan fallback model dan key
    const keyGemini = process.env.SUMOPOD_GEMINI_API_KEY || process.env.SUMOPOD_API_KEY;
    const keyGpt = process.env.SUMOPOD_GPT5_API_KEY || process.env.SUMOPOD_API_KEY;
    if (!keyGemini && !keyGpt) {
      return res.status(500).json({ message: "Sumopod API keys not configured" });
    }

    const candidates: Array<{ model: string; key: string }> = [];
    if (keyGemini) {
      candidates.push({ model: "gemini/gemini-2.0-flash", key: keyGemini });
      candidates.push({ model: "gemini/gemini-1.5-flash", key: keyGemini });
    }
    if (keyGpt) {
      candidates.push({ model: "gpt-5-nano", key: keyGpt });
    }

    // Coba berurutan dengan retry ringan untuk 5xx
    let lastErr: unknown = undefined;
    for (const { model, key } of candidates) {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const raw = await callSumopodAPI(key, model, dataURL);
            const json = extractJSON(raw);
            return res.json(json);
          } catch (e: any) {
            const msg = typeof e?.message === 'string' ? e.message : '';
            // Ulangi hanya jika kemungkinan masalah sementara (5xx/UNAVAILABLE)
            const transient = /\b(5\\d{2}|UNAVAILABLE|timeout)\b/i.test(msg);
            if (attempt === 0 && transient) {
              await new Promise(r => setTimeout(r, 500));
              continue;
            }
            throw e;
          }
        }
      } catch (err) {
        lastErr = err;
        // lanjut ke kandidat berikutnya
      }
    }

    throw lastErr ?? new Error("All model candidates failed");
  } catch (error) {
    console.error("/api/analyze-image error:", error);
    return res.status(500).json({ message: error instanceof Error ? error.message : "Analysis failed" });
  }
});

// Camera capture analysis using GPT-5-nano
app.post("/api/analyze-camera", async (req: Request, res: Response) => {
  try {
    const { dataURL } = req.body as { dataURL?: string };
    if (!dataURL) {
      return res.status(400).json({ message: "dataURL is required" });
    }
    const keyGpt = process.env.SUMOPOD_GPT5_API_KEY || process.env.SUMOPOD_API_KEY;
    const keyGemini = process.env.SUMOPOD_GEMINI_API_KEY || process.env.SUMOPOD_API_KEY;
    if (!keyGpt && !keyGemini) {
      return res.status(500).json({ message: "Sumopod API keys not configured" });
    }

    const candidates: Array<{ model: string; key: string }> = [];
    if (keyGpt) candidates.push({ model: "gpt-5-nano", key: keyGpt });
    if (keyGemini) candidates.push({ model: "gemini/gemini-2.0-flash", key: keyGemini });

    let lastErr: unknown = undefined;
    for (const { model, key } of candidates) {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const raw = await callSumopodAPI(key, model, dataURL);
            const json = extractJSON(raw);
            return res.json(json);
          } catch (e: any) {
            const msg = typeof e?.message === 'string' ? e.message : '';
            const transient = /\b(5\\d{2}|UNAVAILABLE|timeout)\b/i.test(msg);
            if (attempt === 0 && transient) {
              await new Promise(r => setTimeout(r, 500));
              continue;
            }
            throw e;
          }
        }
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr ?? new Error("All model candidates failed");
  } catch (error) {
    console.error("/api/analyze-camera error:", error);
    return res.status(500).json({ message: error instanceof Error ? error.message : "Analysis failed" });
  }
});

// Error handling middleware (last)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err?.status || err?.statusCode || 500;
  const message = err?.message || "Internal Server Error";
  res.status(status).json({ message });
});

export default app;
