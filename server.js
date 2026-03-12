import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import multer from "multer";
import pkg from "square";
import {
  replaceAllItems, getAllItems, hasItems, updateItem, updateItemImage, insertItem,
  replaceAllDiscounts, getAllDiscounts, updateDiscount, insertDiscount,
  replaceAllCategories, getAllCategories, insertCategory, updateCategory,
  replaceAllModifierLists, getAllModifierLists, insertModifierList, updateModifierList,
} from "./db.js";

const upload = multer({ storage: multer.memoryStorage() });

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
  for await (const img of imageResult) {
    imageMap.set(img.id, img.imageData?.url);
  }

  const items = [];
  for await (const item of itemResult) {
    items.push(item);
  }

  return items.map((item) => {
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
// Helper: upload an image file to Square and attach it to a catalog object
// ---------------------------------------------------------------------------
async function uploadImageToSquare(file, catalogObjectId) {
  const imageFile = new File([file.buffer], file.originalname, { type: file.mimetype });
  const result = await client.catalog.images.create({
    imageFile,
    request: {
      idempotencyKey: crypto.randomUUID(),
      objectId: catalogObjectId,
      image: {
        type: "IMAGE",
        id: "#new-image",
        imageData: { caption: "" },
      },
    },
  });
  return result.image?.imageData?.url || null;
}

// ---------------------------------------------------------------------------
// POST /menu – create a new item in Square then SQLite (multipart)
// ---------------------------------------------------------------------------
app.post("/menu", upload.single("image"), async (req, res) => {
  try {
    const { name, priceCents: priceCentsStr } = req.body;
    const priceCents = parseInt(priceCentsStr, 10);

    if (!name || isNaN(priceCents)) {
      return res.status(400).json({ error: "name and priceCents are required" });
    }

    const result = await client.catalog.object.upsert({
      idempotencyKey: crypto.randomUUID(),
      object: {
        type: "ITEM",
        id: "#new-item",
        itemData: {
          name,
          variations: [
            {
              type: "ITEM_VARIATION",
              id: "#new-variation",
              itemVariationData: {
                name: "Regular",
                pricingType: "FIXED_PRICING",
                priceMoney: {
                  amount: BigInt(priceCents),
                  currency: "USD",
                },
              },
            },
          ],
        },
      },
    });

    const created = result.catalogObject;
    const variation = created.itemData?.variations?.[0];

    let imageUrl = null;
    if (req.file) {
      imageUrl = await uploadImageToSquare(req.file, created.id);
    }

    const item = {
      catalogObjectId: created.id,
      name: created.itemData?.name,
      variationId: variation?.id,
      priceCents,
      currency: "USD",
      imageUrl,
    };

    insertItem(item);

    res.status(201).json(item);
  } catch (error) {
    console.error("Error creating menu item:", error);
    res.status(500).json({ error: "Failed to create menu item" });
  }
});

// ---------------------------------------------------------------------------
// PUT /menu/:id/image – upload/replace image for an existing item
// ---------------------------------------------------------------------------
app.put("/menu/:id/image", upload.single("image"), async (req, res) => {
  try {
    const catalogObjectId = req.params.id;

    if (!req.file) {
      return res.status(400).json({ error: "image file is required" });
    }

    const imageUrl = await uploadImageToSquare(req.file, catalogObjectId);
    updateItemImage(catalogObjectId, imageUrl);

    res.json({ ok: true, imageUrl });
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({ error: "Failed to upload image" });
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
    await Promise.allSettled([
      syncCatalog().catch((e) => console.error("Webhook: catalog sync failed:", e)),
      syncDiscounts().catch((e) => console.error("Webhook: discount sync failed:", e)),
      syncCategories().catch((e) => console.error("Webhook: category sync failed:", e)),
      syncModifierLists().catch((e) => console.error("Webhook: modifier list sync failed:", e)),
    ]);
  }

  res.status(200).send();
});

// ---------------------------------------------------------------------------
// Fetch discounts from Square API
// ---------------------------------------------------------------------------
async function fetchDiscountsFromSquare() {
  const result = await client.catalog.list({ types: "DISCOUNT" });

  const discounts = [];
  for await (const item of result) {
    const d = item.discountData;
    discounts.push({
      catalogObjectId: item.id,
      name: d?.name || "",
      discountType: d?.discountType || "FIXED_AMOUNT",
      amountCents: d?.amountMoney ? Number(d.amountMoney.amount) : null,
      currency: d?.amountMoney?.currency || "USD",
      percentage: d?.percentage || null,
    });
  }
  return discounts;
}

async function syncDiscounts() {
  const discounts = await fetchDiscountsFromSquare();
  replaceAllDiscounts(discounts);
  console.log(`Synced ${discounts.length} discounts from Square`);
  return discounts.length;
}

// ---------------------------------------------------------------------------
// GET /discounts – read from SQLite
// ---------------------------------------------------------------------------
app.get("/discounts", (_req, res) => {
  try {
    const discounts = getAllDiscounts();
    res.json(discounts);
  } catch (error) {
    console.error("Error reading discounts from DB:", error);
    res.status(500).json({ error: "Failed to fetch discounts" });
  }
});

// ---------------------------------------------------------------------------
// PUT /discounts/:id – update discount in Square then SQLite
// ---------------------------------------------------------------------------
app.put("/discounts/:id", async (req, res) => {
  try {
    const catalogObjectId = req.params.id;
    const { name, amountCents, percentage } = req.body;

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const existing = await client.catalog.object.get({ objectId: catalogObjectId });
    const catalogObject = existing.object;
    const d = catalogObject.discountData;

    const updatedDiscountData = { ...d, name };

    if (d.discountType === "FIXED_AMOUNT" && amountCents != null) {
      updatedDiscountData.amountMoney = {
        amount: BigInt(amountCents),
        currency: d.amountMoney?.currency || "USD",
      };
    } else if (d.discountType === "FIXED_PERCENTAGE" && percentage != null) {
      updatedDiscountData.percentage = String(percentage);
    }

    await client.catalog.object.upsert({
      idempotencyKey: crypto.randomUUID(),
      object: {
        type: "DISCOUNT",
        id: catalogObjectId,
        version: catalogObject.version,
        discountData: updatedDiscountData,
      },
    });

    updateDiscount(catalogObjectId, name, amountCents ?? null, percentage ?? null);

    res.json({ ok: true, catalogObjectId, name, amountCents, percentage });
  } catch (error) {
    console.error("Error updating discount:", error);
    res.status(500).json({ error: "Failed to update discount" });
  }
});

// ---------------------------------------------------------------------------
// POST /discounts – create a new discount in Square then SQLite
// ---------------------------------------------------------------------------
app.post("/discounts", async (req, res) => {
  try {
    const { name, discountType, amountCents, percentage } = req.body;

    if (!name || !discountType) {
      return res.status(400).json({ error: "name and discountType are required" });
    }
    if (discountType === "FIXED_AMOUNT" && amountCents == null) {
      return res.status(400).json({ error: "amountCents is required for FIXED_AMOUNT" });
    }
    if (discountType === "FIXED_PERCENTAGE" && percentage == null) {
      return res.status(400).json({ error: "percentage is required for FIXED_PERCENTAGE" });
    }

    const discountData = { name, discountType };
    if (discountType === "FIXED_AMOUNT") {
      discountData.amountMoney = { amount: BigInt(amountCents), currency: "USD" };
    } else if (discountType === "FIXED_PERCENTAGE") {
      discountData.percentage = String(percentage);
    }

    const result = await client.catalog.object.upsert({
      idempotencyKey: crypto.randomUUID(),
      object: {
        type: "DISCOUNT",
        id: "#new-discount",
        discountData,
      },
    });

    const created = result.catalogObject;
    const discount = {
      catalogObjectId: created.id,
      name: created.discountData?.name,
      discountType: created.discountData?.discountType,
      amountCents: discountType === "FIXED_AMOUNT" ? amountCents : null,
      currency: "USD",
      percentage: discountType === "FIXED_PERCENTAGE" ? String(percentage) : null,
    };

    insertDiscount(discount);

    res.status(201).json(discount);
  } catch (error) {
    console.error("Error creating discount:", error);
    res.status(500).json({ error: "Failed to create discount" });
  }
});

// ---------------------------------------------------------------------------
// Categories – sync, GET, POST, PUT
// ---------------------------------------------------------------------------
async function syncCategories() {
  const result = await client.catalog.list({ types: "CATEGORY" });
  const categories = [];
  for await (const item of result) {
    categories.push({ catalogObjectId: item.id, name: item.categoryData?.name || "" });
  }
  replaceAllCategories(categories);
  console.log(`Synced ${categories.length} categories from Square`);
}

app.get("/categories", (_req, res) => {
  res.json(getAllCategories());
});

app.post("/categories", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const result = await client.catalog.object.upsert({
      idempotencyKey: crypto.randomUUID(),
      object: { type: "CATEGORY", id: "#new-category", categoryData: { name } },
    });

    const cat = { catalogObjectId: result.catalogObject.id, name };
    insertCategory(cat);
    res.status(201).json(cat);
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({ error: "Failed to create category" });
  }
});

app.put("/categories/:id", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const existing = await client.catalog.object.get({ objectId: req.params.id });
    const catalogObject = existing.object;

    await client.catalog.object.upsert({
      idempotencyKey: crypto.randomUUID(),
      object: {
        type: "CATEGORY",
        id: req.params.id,
        version: catalogObject.version,
        categoryData: { name },
      },
    });

    updateCategory(req.params.id, name);
    res.json({ ok: true, catalogObjectId: req.params.id, name });
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({ error: "Failed to update category" });
  }
});

// ---------------------------------------------------------------------------
// Modifier lists – sync, GET, POST, PUT
// ---------------------------------------------------------------------------
function squareModsToLocal(mods) {
  return (mods || []).map((m) => ({
    id: m.id,
    name: m.modifierData?.name || "",
    priceCents: m.modifierData?.priceMoney ? Number(m.modifierData.priceMoney.amount) : 0,
    currency: m.modifierData?.priceMoney?.currency || "USD",
  }));
}

async function syncModifierLists() {
  const [listResult, modResult] = await Promise.all([
    client.catalog.list({ types: "MODIFIER_LIST" }),
    client.catalog.list({ types: "MODIFIER" }),
  ]);

  // Build a fallback map: modifierListId → MODIFIER objects
  // Used when the list response doesn't embed modifiers inline
  const modByListId = new Map();
  for await (const mod of modResult) {
    const listId = mod.modifierData?.modifierListId;
    if (listId) {
      if (!modByListId.has(listId)) modByListId.set(listId, []);
      modByListId.get(listId).push(mod);
    }
  }

  const lists = [];
  for await (const item of listResult) {
    const embedded = item.modifierListData?.modifiers;
    const mods = embedded?.length ? embedded : (modByListId.get(item.id) || []);
    lists.push({
      catalogObjectId: item.id,
      name: item.modifierListData?.name || "",
      selectionType: item.modifierListData?.selectionType || "MULTIPLE",
      modifiersJson: JSON.stringify(squareModsToLocal(mods)),
    });
  }

  replaceAllModifierLists(lists);
  console.log(`Synced ${lists.length} modifier lists from Square`);
}

app.get("/modifier-lists", (_req, res) => {
  res.json(getAllModifierLists());
});

app.post("/modifier-lists", async (req, res) => {
  try {
    const { name, selectionType = "MULTIPLE", modifiers = [] } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const modifierObjects = modifiers.map((m, i) => ({
      type: "MODIFIER",
      id: `#mod-${i}`,
      modifierData: {
        name: m.name,
        ...(m.priceCents ? { priceMoney: { amount: BigInt(m.priceCents), currency: "USD" } } : {}),
      },
    }));

    const result = await client.catalog.object.upsert({
      idempotencyKey: crypto.randomUUID(),
      object: {
        type: "MODIFIER_LIST",
        id: "#new-modifier-list",
        modifierListData: { name, selectionType, modifiers: modifierObjects },
      },
    });

    const created = result.catalogObject;
    const localMods = squareModsToLocal(created.modifierListData?.modifiers);
    const list = {
      catalogObjectId: created.id,
      name: created.modifierListData?.name || name,
      selectionType,
      modifiersJson: JSON.stringify(localMods),
    };
    insertModifierList(list);

    res.status(201).json({ ...list, modifiers: localMods, modifiersJson: undefined });
  } catch (error) {
    console.error("Error creating modifier list:", error);
    res.status(500).json({ error: "Failed to create modifier list" });
  }
});

app.put("/modifier-lists/:id", async (req, res) => {
  try {
    const { name, selectionType = "MULTIPLE", modifiers = [] } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const existing = await client.catalog.object.get({ objectId: req.params.id });
    const catalogObject = existing.object;

    // Build version map from current Square state so existing modifiers don't conflict
    const existingVersionMap = new Map(
      (catalogObject.modifierListData?.modifiers || []).map((m) => [m.id, m.version])
    );

    const modifierObjects = modifiers.map((m, i) => {
      const obj = {
        type: "MODIFIER",
        id: m.id || `#mod-new-${i}`,
        modifierData: {
          name: m.name,
          ...(m.priceCents ? { priceMoney: { amount: BigInt(m.priceCents), currency: "USD" } } : {}),
        },
      };
      if (m.id && existingVersionMap.has(m.id)) {
        obj.version = existingVersionMap.get(m.id);
      }
      return obj;
    });

    const result = await client.catalog.object.upsert({
      idempotencyKey: crypto.randomUUID(),
      object: {
        type: "MODIFIER_LIST",
        id: req.params.id,
        version: catalogObject.version,
        modifierListData: { name, selectionType, modifiers: modifierObjects },
      },
    });

    const updated = result.catalogObject;
    const localMods = squareModsToLocal(updated.modifierListData?.modifiers);
    updateModifierList(req.params.id, name, selectionType, localMods);

    res.json({ ok: true, catalogObjectId: req.params.id, name, selectionType, modifiers: localMods });
  } catch (error) {
    console.error("Error updating modifier list:", error);
    res.status(500).json({ error: "Failed to update modifier list" });
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

  try {
    await syncDiscounts();
  } catch (error) {
    console.error("Discount sync failed:", error);
  }

  try {
    await syncCategories();
  } catch (error) {
    console.error("Category sync failed:", error);
  }

  try {
    await syncModifierLists();
  } catch (error) {
    console.error("Modifier list sync failed:", error);
  }

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
})();
