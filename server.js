import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import pkg from "square";
const { SquareClient, SquareEnvironment } = pkg;

const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN,
  environment: SquareEnvironment.Sandbox,
});

// ---------------------------------------------------------------------------
// GET /menu – list every ITEM from the Square Catalog
// ---------------------------------------------------------------------------
app.get("/menu", async (_req, res) => {
  try {
    const [itemResult, imageResult] = await Promise.all([
      client.catalog.list({ types: "ITEM" }),
      client.catalog.list({ types: "IMAGE" }),
    ]);

    const imageMap = new Map();
    for (const img of imageResult.data || []) {
      imageMap.set(img.id, img.imageData?.url);
    }

    const items = (itemResult.data || []).map((item) => {
      const variation = item.itemData?.variations?.[0];
      const priceMoney = variation?.itemVariationData?.priceMoney;
      const imageId = item.itemData?.imageIds?.[0];

      return {
        catalogObjectId: item.id,
        name: item.itemData?.name,
        variationId: variation?.id,
        priceCents: priceMoney ? Number(priceMoney.amount) : 0,
        currency: priceMoney?.currency || "USD",
        imageUrl: imageId ? imageMap.get(imageId) : null,
      };
    });

    res.json(items);
  } catch (error) {
    console.error("Error fetching catalog:", error);
    res.status(500).json({ error: "Failed to fetch menu items" });
  }
});

// ---------------------------------------------------------------------------
// POST /create-checkout – build a Square payment link for one item
// ---------------------------------------------------------------------------
app.post("/create-checkout", async (req, res) => {
  try {
    const { itemVariationId } = req.body;

    if (!itemVariationId) {
      return res.status(400).json({ error: "itemVariationId is required" });
    }

    const result = await client.checkout.paymentLinks.create({
      idempotencyKey: crypto.randomUUID(),
      order: {
        locationId: process.env.SQUARE_LOCATION_ID,
        lineItems: [
          {
            catalogObjectId: itemVariationId,
            quantity: "1",
          },
        ],
      },
    });

    res.json({ url: result.paymentLink?.longUrl });
  } catch (error) {
    console.error("Error creating checkout:", error);
    res.status(500).json({ error: "Failed to create checkout link" });
  }
});

// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
