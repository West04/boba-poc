import Database from "better-sqlite3";

const db = new Database("menu.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS menu_items (
    catalog_object_id TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    variation_id      TEXT NOT NULL,
    price_cents       INTEGER NOT NULL DEFAULT 0,
    currency          TEXT NOT NULL DEFAULT 'USD',
    image_url         TEXT,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS discounts (
    catalog_object_id TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    discount_type     TEXT NOT NULL,
    amount_cents      INTEGER,
    currency          TEXT NOT NULL DEFAULT 'USD',
    percentage        TEXT,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const insertStmt = db.prepare(`
  INSERT INTO menu_items (catalog_object_id, name, variation_id, price_cents, currency, image_url)
  VALUES (@catalogObjectId, @name, @variationId, @priceCents, @currency, @imageUrl)
`);

export function replaceAllItems(items) {
  const tx = db.transaction((rows) => {
    db.exec("DELETE FROM menu_items");
    for (const row of rows) {
      insertStmt.run(row);
    }
  });
  tx(items);
}

export function getAllItems() {
  const rows = db.prepare("SELECT * FROM menu_items").all();
  return rows.map((r) => ({
    catalogObjectId: r.catalog_object_id,
    name: r.name,
    variationId: r.variation_id,
    priceCents: r.price_cents,
    currency: r.currency,
    imageUrl: r.image_url,
  }));
}

export function updateItem(catalogObjectId, name, priceCents) {
  const stmt = db.prepare(
    "UPDATE menu_items SET name = ?, price_cents = ?, updated_at = datetime('now') WHERE catalog_object_id = ?"
  );
  return stmt.run(name, priceCents, catalogObjectId);
}

export function updateItemImage(catalogObjectId, imageUrl) {
  const stmt = db.prepare(
    "UPDATE menu_items SET image_url = ?, updated_at = datetime('now') WHERE catalog_object_id = ?"
  );
  return stmt.run(imageUrl, catalogObjectId);
}

export function hasItems() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM menu_items").get();
  return row.count > 0;
}

export function insertItem(item) {
  insertStmt.run(item);
}

const insertDiscountStmt = db.prepare(`
  INSERT INTO discounts (catalog_object_id, name, discount_type, amount_cents, currency, percentage)
  VALUES (@catalogObjectId, @name, @discountType, @amountCents, @currency, @percentage)
`);

export function replaceAllDiscounts(discounts) {
  const tx = db.transaction((rows) => {
    db.exec("DELETE FROM discounts");
    for (const row of rows) {
      insertDiscountStmt.run(row);
    }
  });
  tx(discounts);
}

export function getAllDiscounts() {
  const rows = db.prepare("SELECT * FROM discounts").all();
  return rows.map((r) => ({
    catalogObjectId: r.catalog_object_id,
    name: r.name,
    discountType: r.discount_type,
    amountCents: r.amount_cents,
    currency: r.currency,
    percentage: r.percentage,
  }));
}

export function insertDiscount(discount) {
  insertDiscountStmt.run(discount);
}

export function updateDiscount(catalogObjectId, name, amountCents, percentage) {
  const stmt = db.prepare(
    "UPDATE discounts SET name = ?, amount_cents = ?, percentage = ?, updated_at = datetime('now') WHERE catalog_object_id = ?"
  );
  return stmt.run(name, amountCents ?? null, percentage ?? null, catalogObjectId);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    catalog_object_id TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const insertCategoryStmt = db.prepare(`
  INSERT INTO categories (catalog_object_id, name) VALUES (@catalogObjectId, @name)
`);

export function replaceAllCategories(categories) {
  const tx = db.transaction((rows) => {
    db.exec("DELETE FROM categories");
    for (const row of rows) insertCategoryStmt.run(row);
  });
  tx(categories);
}

export function getAllCategories() {
  return db.prepare("SELECT * FROM categories").all().map((r) => ({
    catalogObjectId: r.catalog_object_id,
    name: r.name,
  }));
}

export function insertCategory(cat) {
  insertCategoryStmt.run(cat);
}

export function updateCategory(catalogObjectId, name) {
  db.prepare("UPDATE categories SET name = ?, updated_at = datetime('now') WHERE catalog_object_id = ?").run(name, catalogObjectId);
}

// ---------------------------------------------------------------------------
// Modifier lists (stored with modifiers as JSON)
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS modifier_lists (
    catalog_object_id TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    selection_type    TEXT NOT NULL DEFAULT 'MULTIPLE',
    modifiers_json    TEXT NOT NULL DEFAULT '[]',
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const insertModifierListStmt = db.prepare(`
  INSERT INTO modifier_lists (catalog_object_id, name, selection_type, modifiers_json)
  VALUES (@catalogObjectId, @name, @selectionType, @modifiersJson)
`);

export function replaceAllModifierLists(lists) {
  const tx = db.transaction((rows) => {
    db.exec("DELETE FROM modifier_lists");
    for (const row of rows) insertModifierListStmt.run(row);
  });
  tx(lists);
}

export function getAllModifierLists() {
  return db.prepare("SELECT * FROM modifier_lists").all().map((r) => ({
    catalogObjectId: r.catalog_object_id,
    name: r.name,
    selectionType: r.selection_type,
    modifiers: JSON.parse(r.modifiers_json),
  }));
}

export function insertModifierList(list) {
  insertModifierListStmt.run(list);
}

export function updateModifierList(catalogObjectId, name, selectionType, modifiers) {
  db.prepare(
    "UPDATE modifier_lists SET name = ?, selection_type = ?, modifiers_json = ?, updated_at = datetime('now') WHERE catalog_object_id = ?"
  ).run(name, selectionType, JSON.stringify(modifiers), catalogObjectId);
}
