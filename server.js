import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import pkg from "square";
import { replaceAllItems, getAllItems, hasItems, updateItem } from "./db.js";

const { SquareClient, SquareEnvironment, WebhooksHelper } = pkg;

const app = express();

// Capture raw body for webhook signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

app.use(express.static("public"));

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN,
  environment: SquareEnvironment.Production,
});

// ---------------------------------------------------------------------------
// Fetch catalog from Square API
// ---------------------------------------------------------------------------
async function fetchCatalogFromSquare() {
  const [itemResult, imageResult] = await Promise.all([
    client.catalog.list({ types: "ITEM" }),
    client.catalog.list({ types: "IMAGE" }),
  ]);

  const imageMap = new Map();
  for (const img of imageResult.data || []) {
    imageMap.set(img.id, img.imageData?.url);
  }

  return (itemResult.data || []).map((item) => {
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
}

// ---------------------------------------------------------------------------
// Sync: fetch from Square → replace all rows in SQLite
// ---------------------------------------------------------------------------
async function syncCatalog() {
  const items = await fetchCatalogFromSquare();
  replaceAllItems(items);
  console.log(`Synced ${items.length} menu items from Square`);
  return items.length;
}

// ---------------------------------------------------------------------------
// GET /menu – read from SQLite (fast, synchronous)
// ---------------------------------------------------------------------------
app.get("/menu", (_req, res) => {
  try {
    const items = getAllItems();
    res.json(items);
  } catch (error) {
    console.error("Error reading menu from DB:", error);
    res.status(500).json({ error: "Failed to fetch menu items" });
  }
});

// ---------------------------------------------------------------------------
// PUT /menu/:id – update item name/price in Square then SQLite
// ---------------------------------------------------------------------------
app.put("/menu/:id", async (req, res) => {
  try {
    const catalogObjectId = req.params.id;
    const { name, priceCents } = req.body;

    if (!name || priceCents == null) {
      return res.status(400).json({ error: "name and priceCents are required" });
    }

    // Get current object from Square to obtain version and variation info
    const existing = await client.catalog.object.get({ objectId: catalogObjectId });
    const catalogObject = existing.object;
    const variation = catalogObject.itemData?.variations?.[0];

    if (!variation) {
      return res.status(404).json({ error: "No variation found for this item" });
    }

    // Upsert updated item back to Square
    await client.catalog.object.upsert({
      idempotencyKey: crypto.randomUUID(),
      object: {
        type: "ITEM",
        id: catalogObjectId,
        version: catalogObject.version,
        itemData: {
          ...catalogObject.itemData,
          name,
          variations: [
            {
              type: "ITEM_VARIATION",
              id: variation.id,
              version: variation.version,
              itemVariationData: {
                ...variation.itemVariationData,
                name,
                priceMoney: {
                  amount: BigInt(priceCents),
                  currency: variation.itemVariationData?.priceMoney?.currency || "USD",
                },
              },
            },
          ],
        },
      },
    });

    // Update local DB after successful Square update
    updateItem(catalogObjectId, name, priceCents);

    res.json({ ok: true, catalogObjectId, name, priceCents });
  } catch (error) {
    console.error("Error updating menu item:", error);
    res.status(500).json({ error: "Failed to update menu item" });
  }
});

// ---------------------------------------------------------------------------
// POST /seed – manual trigger to re-sync from Square
// ---------------------------------------------------------------------------
app.post("/seed", async (_req, res) => {
  try {
    const count = await syncCatalog();
    res.json({ ok: true, count });
  } catch (error) {
    console.error("Error seeding catalog:", error);
    res.status(500).json({ error: "Failed to seed menu items" });
  }
});

// ---------------------------------------------------------------------------
// POST /webhooks/square – receive catalog change notifications
// ---------------------------------------------------------------------------
app.post("/webhooks/square", async (req, res) => {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;

  if (!signatureKey || !notificationUrl) {
    console.warn(
      "Webhook received but SQUARE_WEBHOOK_SIGNATURE_KEY or SQUARE_WEBHOOK_NOTIFICATION_URL not set — skipping verification"
    );
  } else {
    const signatureHeader = req.headers["x-square-hmacsha256-signature"];
    const isValid = await WebhooksHelper.verifySignature({
      requestBody: req.rawBody,
      signatureHeader: signatureHeader || "",
      signatureKey,
      notificationUrl,
    });

    if (!isValid) {
      console.warn("Webhook signature verification failed");
      return res.status(200).send();
    }
  }

  const eventType = req.body?.type;
  console.log(`Webhook received: ${eventType}`);

  if (eventType === "catalog.version.updated") {
    try {
      await syncCatalog();
    } catch (error) {
      console.error("Error syncing catalog from webhook:", error);
    }
  }

  res.status(200).send();
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
// Start server — auto-seed if DB is empty
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

(async () => {
  if (!hasItems()) {
    console.log("Database is empty, seeding from Square...");
    try {
      await syncCatalog();
    } catch (error) {
      console.error("Auto-seed failed:", error);
    }
  } else {
    console.log("Database already has items, skipping auto-seed");
  }

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
})();
