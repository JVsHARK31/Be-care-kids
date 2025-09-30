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

function toNumber(value: any, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeAnalysis(raw: any) {
  const image_meta = {
    width: toNumber(raw?.image_meta?.width, 0),
    height: toNumber(raw?.image_meta?.height, 0),
    orientation:
      (raw?.image_meta?.orientation === 'portrait' ||
        raw?.image_meta?.orientation === 'landscape' ||
        raw?.image_meta?.orientation === 'square')
        ? raw.image_meta.orientation
        : (toNumber(raw?.image_meta?.width, 0) === toNumber(raw?.image_meta?.height, 0)
            ? 'square'
            : toNumber(raw?.image_meta?.width, 0) > toNumber(raw?.image_meta?.height, 0)
              ? 'landscape'
              : 'portrait'),
  } as const;

  const composition: any[] = Array.isArray(raw?.composition) ? raw.composition : [];
  const normItems = composition.map((it) => ({
    label: String(it?.label ?? 'item'),
    confidence: toNumber(it?.confidence, 0.5),
    serving_est_g: toNumber(it?.serving_est_g, 0),
    bbox_norm: {
      x: toNumber(it?.bbox_norm?.x, 0),
      y: toNumber(it?.bbox_norm?.y, 0),
      w: toNumber(it?.bbox_norm?.w, 0),
      h: toNumber(it?.bbox_norm?.h, 0),
    },
    nutrition: {
      calories_kcal: toNumber(it?.nutrition?.calories_kcal, 0),
      macros: {
        protein_g: toNumber(it?.nutrition?.macros?.protein_g, 0),
        carbs_g: toNumber(it?.nutrition?.macros?.carbs_g, 0),
        fat_g: toNumber(it?.nutrition?.macros?.fat_g, 0),
        fiber_g: toNumber(it?.nutrition?.macros?.fiber_g, 0),
        sugar_g: toNumber(it?.nutrition?.macros?.sugar_g, 0),
      },
      micros: {
        sodium_mg: toNumber(it?.nutrition?.micros?.sodium_mg, 0),
        potassium_mg: toNumber(it?.nutrition?.micros?.potassium_mg, 0),
        calcium_mg: toNumber(it?.nutrition?.micros?.calcium_mg, 0),
        iron_mg: toNumber(it?.nutrition?.micros?.iron_mg, 0),
        vitamin_a_mcg: toNumber(it?.nutrition?.micros?.vitamin_a_mcg, 0),
        vitamin_c_mg: toNumber(it?.nutrition?.micros?.vitamin_c_mg, 0),
        cholesterol_mg: toNumber(it?.nutrition?.micros?.cholesterol_mg, 0),
      },
      allergens: Array.isArray(it?.nutrition?.allergens) ? it.nutrition.allergens.map(String) : [],
    },
  }));

  // derive totals if missing
  const totalsProvided = raw?.totals ?? {};
  const totals = {
    serving_total_g: toNumber(totalsProvided?.serving_total_g, normItems.reduce((s, i) => s + toNumber(i.serving_est_g, 0), 0)),
    calories_kcal: toNumber(totalsProvided?.calories_kcal, normItems.reduce((s, i) => s + toNumber(i.nutrition?.calories_kcal, 0), 0)),
    macros: {
      protein_g: toNumber(totalsProvided?.macros?.protein_g, normItems.reduce((s, i) => s + toNumber(i.nutrition?.macros?.protein_g, 0), 0)),
      carbs_g: toNumber(totalsProvided?.macros?.carbs_g, normItems.reduce((s, i) => s + toNumber(i.nutrition?.macros?.carbs_g, 0), 0)),
      fat_g: toNumber(totalsProvided?.macros?.fat_g, normItems.reduce((s, i) => s + toNumber(i.nutrition?.macros?.fat_g, 0), 0)),
      fiber_g: toNumber(totalsProvided?.macros?.fiber_g, normItems.reduce((s, i) => s + toNumber(i.nutrition?.macros?.fiber_g, 0), 0)),
      sugar_g: toNumber(totalsProvided?.macros?.sugar_g, normItems.reduce((s, i) => s + toNumber(i.nutrition?.macros?.sugar_g, 0), 0)),
    },
    micros: {
      sodium_mg: toNumber(totalsProvided?.micros?.sodium_mg, normItems.reduce((s, i) => s + toNumber(i.nutrition?.micros?.sodium_mg, 0), 0)),
      potassium_mg: toNumber(totalsProvided?.micros?.potassium_mg, normItems.reduce((s, i) => s + toNumber(i.nutrition?.micros?.potassium_mg, 0), 0)),
      calcium_mg: toNumber(totalsProvided?.micros?.calcium_mg, normItems.reduce((s, i) => s + toNumber(i.nutrition?.micros?.calcium_mg, 0), 0)),
      iron_mg: toNumber(totalsProvided?.micros?.iron_mg, normItems.reduce((s, i) => s + toNumber(i.nutrition?.micros?.iron_mg, 0), 0)),
      vitamin_a_mcg: toNumber(totalsProvided?.micros?.vitamin_a_mcg, normItems.reduce((s, i) => s + toNumber(i.nutrition?.micros?.vitamin_a_mcg, 0), 0)),
      vitamin_c_mg: toNumber(totalsProvided?.micros?.vitamin_c_mg, normItems.reduce((s, i) => s + toNumber(i.nutrition?.micros?.vitamin_c_mg, 0), 0)),
      cholesterol_mg: toNumber(totalsProvided?.micros?.cholesterol_mg, normItems.reduce((s, i) => s + toNumber(i.nutrition?.micros?.cholesterol_mg, 0), 0)),
    },
    allergens: Array.isArray(totalsProvided?.allergens)
      ? totalsProvided.allergens.map(String)
      : Array.from(new Set(normItems.flatMap((i: any) => Array.isArray(i?.nutrition?.allergens) ? i.nutrition.allergens.map(String) : []))),
  };

  return {
    image_meta,
    composition: normItems,
    totals,
    notes: typeof raw?.notes === 'string' ? raw.notes : undefined,
  };
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
            const normalized = normalizeAnalysis(json);
            return res.json(normalized);
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
            const normalized = normalizeAnalysis(json);
            return res.json(normalized);
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
