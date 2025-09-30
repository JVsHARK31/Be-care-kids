import express, { type Request, Response, NextFunction } from "express";

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

// Error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(status).json({ message });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Image analysis endpoint
app.post("/api/analyze-image", async (req, res) => {
  try {
    const { dataURL } = req.body;
    
    if (!dataURL) {
      return res.status(400).json({ message: "dataURL is required" });
    }

    const apiKey = process.env.SUMOPOD_GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ 
        message: "SUMOPOD_GEMINI_API_KEY not configured" 
      });
    }

    // Simple mock response for now
    const mockResponse = {
      image_meta: {
        width: 800,
        height: 600,
        orientation: "landscape"
      },
      composition: [
        {
          label: "Nasi Goreng",
          confidence: 0.95,
          serving_est_g: 200,
          bbox_norm: { x: 0.1, y: 0.1, w: 0.8, h: 0.6 },
          nutrition: {
            calories_kcal: 350,
            macros: {
              protein_g: 12,
              carbs_g: 45,
              fat_g: 8,
              fiber_g: 2,
              sugar_g: 3
            },
            micros: {
              sodium_mg: 800,
              potassium_mg: 300,
              calcium_mg: 50,
              iron_mg: 2,
              vitamin_a_mcg: 100,
              vitamin_c_mg: 15,
              cholesterol_mg: 25
            },
            allergens: ["gluten"]
          }
        }
      ],
      totals: {
        serving_total_g: 200,
        calories_kcal: 350,
        macros: {
          protein_g: 12,
          carbs_g: 45,
          fat_g: 8,
          fiber_g: 2,
          sugar_g: 3
        },
        micros: {
          sodium_mg: 800,
          potassium_mg: 300,
          calcium_mg: 50,
          iron_mg: 2,
          vitamin_a_mcg: 100,
          vitamin_c_mg: 15,
          cholesterol_mg: 25
        },
        allergens: ["gluten"]
      },
      notes: "Analysis completed successfully"
    };

    res.json(mockResponse);
  } catch (error) {
    console.error('Image analysis error:', error);
    res.status(500).json({ 
      message: error instanceof Error ? error.message : "Analysis failed" 
    });
  }
});

// Camera analysis endpoint
app.post("/api/analyze-camera", async (req, res) => {
  try {
    const { dataURL } = req.body;
    
    if (!dataURL) {
      return res.status(400).json({ message: "dataURL is required" });
    }

    const apiKey = process.env.SUMOPOD_GPT5_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ 
        message: "SUMOPOD_GPT5_API_KEY not configured" 
      });
    }

    // Simple mock response for now
    const mockResponse = {
      image_meta: {
        width: 800,
        height: 600,
        orientation: "landscape"
      },
      composition: [
        {
          label: "Makanan Kamera",
          confidence: 0.90,
          serving_est_g: 150,
          bbox_norm: { x: 0.2, y: 0.2, w: 0.6, h: 0.5 },
          nutrition: {
            calories_kcal: 250,
            macros: {
              protein_g: 8,
              carbs_g: 35,
              fat_g: 6,
              fiber_g: 3,
              sugar_g: 5
            },
            micros: {
              sodium_mg: 600,
              potassium_mg: 250,
              calcium_mg: 40,
              iron_mg: 1.5,
              vitamin_a_mcg: 80,
              vitamin_c_mg: 12,
              cholesterol_mg: 20
            },
            allergens: []
          }
        }
      ],
      totals: {
        serving_total_g: 150,
        calories_kcal: 250,
        macros: {
          protein_g: 8,
          carbs_g: 35,
          fat_g: 6,
          fiber_g: 3,
          sugar_g: 5
        },
        micros: {
          sodium_mg: 600,
          potassium_mg: 250,
          calcium_mg: 40,
          iron_mg: 1.5,
          vitamin_a_mcg: 80,
          vitamin_c_mg: 12,
          cholesterol_mg: 20
        },
        allergens: []
      },
      notes: "Camera analysis completed successfully"
    };

    res.json(mockResponse);
  } catch (error) {
    console.error('Camera analysis error:', error);
    res.status(500).json({ 
      message: error instanceof Error ? error.message : "Analysis failed" 
    });
  }
});

export default app;
