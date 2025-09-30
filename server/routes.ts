import type { Express } from "express";
import { z } from "zod";
import { AnalysisRequestSchema, NutritionAnalysisSchema, insertUserSchema, insertMealSchema, insertNutritionGoalsSchema } from "@shared/schema";
import { storage } from "./storage";

const SUMOPOD_BASE_URL = "https://ai.sumopod.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are a pediatric nutrition and food composition expert. Respond with STRICT JSON only per the provided schema. No extra text.

Analyze this image. Identify each distinct food item (e.g., nasi goreng, kerupuk, sayur, telur, sosis). For each item, estimate serving_est_g and provide nutrition fields. Provide composition bounding boxes as normalized bbox (x,y,w,h) in [0..1]. Sum all items into totals. Reply strictly with JSON schema only.

Return JSON in this exact format:
{
  "image_meta": {
    "width": number,
    "height": number,
    "orientation": "portrait" | "landscape" | "square"
  },
  "composition": [
    {
      "label": "string",
      "confidence": number,
      "serving_est_g": number,
      "bbox_norm": {
        "x": number, "y": number, "w": number, "h": number
      },
      "nutrition": {
        "calories_kcal": number,
        "macros": {
          "protein_g": number,
          "carbs_g": number,
          "fat_g": number,
          "fiber_g": number,
          "sugar_g": number
        },
        "micros": {
          "sodium_mg": number,
          "potassium_mg": number,
          "calcium_mg": number,
          "iron_mg": number,
          "vitamin_a_mcg": number,
          "vitamin_c_mg": number,
          "cholesterol_mg": number
        },
        "allergens": ["string"]
      }
    }
  ],
  "totals": {
    "serving_total_g": number,
    "calories_kcal": number,
    "macros": {
      "protein_g": number,
      "carbs_g": number,
      "fat_g": number,
      "fiber_g": number,
      "sugar_g": number
    },
    "micros": {
      "sodium_mg": number,
      "potassium_mg": number,
      "calcium_mg": number,
      "iron_mg": number,
      "vitamin_a_mcg": number,
      "vitamin_c_mg": number,
      "cholesterol_mg": number
    },
    "allergens": ["string"]
  },
  "notes": "string"
}`;

async function callSumopodAPI(apiKey: string, model: string, dataURL: string): Promise<any> {
  const requestBody = {
    model,
    temperature: 0.2,
    max_tokens: 4000,
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Analyze this image. Identify each distinct food item (e.g., nasi goreng, kerupuk, sayur, telur, sosis). For each item, estimate serving_est_g and provide nutrition fields. Provide composition bounding boxes as normalized bbox (x,y,w,h) in [0..1]. Sum all items into totals. Reply strictly with JSON schema only.',
          },
          {
            type: 'image_url',
            image_url: {
              url: dataURL,
            },
          },
        ],
      },
    ],
  };

  console.log('Calling Sumopod API with model:', model);
  console.log('Request body keys:', Object.keys(requestBody));
  console.log('Image data URL prefix:', dataURL.substring(0, 50));

  const response = await fetch(SUMOPOD_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  console.log('Sumopod API response status:', response.status);
  console.log('Sumopod API response headers:', Object.fromEntries(response.headers.entries()));

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Sumopod API error response body:', errorText);
    throw new Error(`Sumopod API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  console.log('Sumopod API response keys:', Object.keys(data));
  return data.choices[0]?.message?.content || '';
}

function extractJSON(text: string): object {
  try {
    // Try parsing directly first
    return JSON.parse(text);
  } catch {
    // Remove markdown code fences if present
    let cleanedText = text.replace(/```json\s*/g, '').replace(/\s*```$/g, '').trim();
    
    try {
      return JSON.parse(cleanedText);
    } catch {
      // Extract JSON object using regex - find first { to last }
      const firstBrace = cleanedText.indexOf('{');
      const lastBrace = cleanedText.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = cleanedText.substring(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(jsonStr);
        } catch (parseError) {
          console.error('JSON parse error:', parseError);
          console.error('Attempted to parse:', jsonStr.substring(0, 200));
          throw new Error('Invalid JSON in response - response may be truncated');
        }
      }
      
      console.error('No valid JSON structure found in response');
      console.error('Response text:', text.substring(0, 500));
      throw new Error('No JSON found in response');
    }
  }
}

export async function registerRoutes(app: Express): Promise<Express> {
  // Check available models for debugging
  app.get("/api/models", async (req, res) => {
    try {
      const geminiKey = process.env.SUMOPOD_GEMINI_API_KEY;
      const gptKey = process.env.SUMOPOD_GPT5_API_KEY;
      
      if (!geminiKey || !gptKey) {
        return res.status(500).json({ message: "API keys not configured" });
      }

      const [geminiModels, gptModels] = await Promise.all([
        fetch("https://ai.sumopod.com/v1/models", {
          headers: { "Authorization": `Bearer ${geminiKey}` }
        }).then(r => r.json()),
        fetch("https://ai.sumopod.com/v1/models", {
          headers: { "Authorization": `Bearer ${gptKey}` }
        }).then(r => r.json())
      ]);

      res.json({
        gemini_key_models: geminiModels,
        gpt_key_models: gptModels
      });
    } catch (error) {
      console.error('Models check error:', error);
      res.status(500).json({ message: "Failed to check models" });
    }
  });

  // Image upload analysis using GEMINI
  app.post("/api/analyze-image", async (req, res) => {
    try {
      const { dataURL } = AnalysisRequestSchema.parse(req.body);
      
      const apiKey = process.env.SUMOPOD_GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ 
          message: "SUMOPOD_GEMINI_API_KEY not configured" 
        });
      }

      const rawResponse = await callSumopodAPI(apiKey, "gemini/gemini-2.0-flash", dataURL);
      console.log("Raw AI response:", JSON.stringify(rawResponse, null, 2));
      
      const jsonData = extractJSON(rawResponse);
      console.log("Extracted JSON:", JSON.stringify(jsonData, null, 2));
      
      // Validate response against schema
      const analysis = NutritionAnalysisSchema.parse(jsonData);
      
      res.json(analysis);
    } catch (error) {
      console.error('Image analysis error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Analysis failed" 
      });
    }
  });

  // Camera capture analysis using GPT-5-nano
  app.post("/api/analyze-camera", async (req, res) => {
    try {
      const { dataURL } = AnalysisRequestSchema.parse(req.body);
      
      const apiKey = process.env.SUMOPOD_GPT5_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ 
          message: "SUMOPOD_GPT5_API_KEY not configured" 
        });
      }

      const rawResponse = await callSumopodAPI(apiKey, "gpt-5-nano", dataURL);
      const jsonData = extractJSON(rawResponse);
      
      // Validate response against schema
      const analysis = NutritionAnalysisSchema.parse(jsonData);
      
      res.json(analysis);
    } catch (error) {
      console.error('Camera analysis error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Analysis failed" 
      });
    }
  });

  // Authentication routes - DISABLED
  app.post("/api/auth/register", async (req, res) => {
    res.status(410).json({ message: "Authentication is no longer supported" });
  });

  app.post("/api/auth/login", async (req, res) => {
    res.status(410).json({ message: "Authentication is no longer supported" });
  });

  // Meal tracking routes - DISABLED (using localStorage)
  app.post("/api/meals", async (req, res) => {
    res.status(410).json({ message: "Meal storage moved to client-side localStorage" });
  });

  app.get("/api/meals/:userId", async (req, res) => {
    res.status(410).json({ message: "Meal storage moved to client-side localStorage" });
  });

  app.get("/api/meals/:userId/range", async (req, res) => {
    res.status(410).json({ message: "Meal storage moved to client-side localStorage" });
  });

  app.delete("/api/meals/:mealId/:userId", async (req, res) => {
    res.status(410).json({ message: "Meal storage moved to client-side localStorage" });
  });

  // Nutrition goals routes - DISABLED (using localStorage)
  app.post("/api/nutrition-goals", async (req, res) => {
    res.status(410).json({ message: "Nutrition goals moved to client-side localStorage" });
  });

  app.get("/api/nutrition-goals/:userId", async (req, res) => {
    res.status(410).json({ message: "Nutrition goals moved to client-side localStorage" });
  });

  app.put("/api/nutrition-goals/:userId", async (req, res) => {
    res.status(410).json({ message: "Nutrition goals moved to client-side localStorage" });
  });

  return app;
}
