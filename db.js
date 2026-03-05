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

export function hasItems() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM menu_items").get();
  return row.count > 0;
}
