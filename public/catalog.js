// =============================================================================
// Categories
// =============================================================================
const categoriesContainer = document.getElementById("categories");

function createCategoryCard(cat) {
  const card = document.createElement("div");
  card.className = "card";
  renderCategoryDisplay(card, cat);
  return card;
}

function renderCategoryDisplay(card, cat) {
  card.innerHTML = `
    <h2>${cat.name}</h2>
    <div class="btn-group">
      <button class="btn-edit">Edit</button>
    </div>
  `;
  card.querySelector(".btn-edit").addEventListener("click", () => openCategorySidebar(cat, card));
}

function openCategorySidebar(cat, card) {
  const isEdit = !!cat;

  openSidebar(
    isEdit ? "Edit Category" : "Add Category",
    `
      <label class="sidebar-label">Name</label>
      <input class="edit-input" type="text" value="${cat?.name || ""}" placeholder="Category name">
    `,
    async () => {
      const name = document.getElementById("sidebar-body").querySelector(".edit-input").value.trim();
      if (!name) { alert("Name cannot be empty."); return; }

      try {
        if (isEdit) {
          const res = await fetch(`/categories/${cat.catalogObjectId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const data = await res.json();
          if (!res.ok) { alert(data.error || "Failed to update category."); return; }
          cat.name = name;
          closeSidebar();
          renderCategoryDisplay(card, cat);
        } else {
          const res = await fetch("/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const newCat = await res.json();
          if (!res.ok) { alert(newCat.error || "Failed to add category."); return; }
          closeSidebar();
          categoriesContainer.appendChild(createCategoryCard(newCat));
        }
      } catch (err) {
        console.error("Save error:", err);
        alert("Something went wrong. Please try again.");
      }
    },
    { saveLabel: isEdit ? "Save" : "Add Category" }
  );
}

document.getElementById("add-category-btn").addEventListener("click", () => openCategorySidebar(null, null));

async function loadCategories() {
  try {
    const res = await fetch("/categories");
    const categories = await res.json();
    if (!categories.length) { categoriesContainer.textContent = "No categories found."; return; }
    categories.forEach((cat) => categoriesContainer.appendChild(createCategoryCard(cat)));
  } catch (err) {
    console.error("Failed to load categories:", err);
    categoriesContainer.textContent = "Failed to load categories.";
  }
}

// =============================================================================
// Modifier Lists
// =============================================================================
const modifierListsContainer = document.getElementById("modifier-lists");

function formatModPrice(cents) {
  if (!cents) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function selectionTypeLabel(type) {
  return type === "SINGLE" ? "Single choice" : "Multiple choice";
}

function createModifierListCard(list) {
  const card = document.createElement("div");
  card.className = "card modifier-list-card";
  renderModifierListDisplay(card, list);
  return card;
}

function renderModifierListDisplay(card, list) {
  const modifierItems = list.modifiers.length
    ? list.modifiers.map((m) =>
        `<li>${m.name}${m.priceCents ? ` <span class="mod-price-tag">+${formatModPrice(m.priceCents)}</span>` : ""}</li>`
      ).join("")
    : `<li class="empty-mods">No options yet</li>`;

  card.innerHTML = `
    <h2>${list.name}</h2>
    <p class="discount-type">${selectionTypeLabel(list.selectionType)}</p>
    <ul class="modifier-display-list">${modifierItems}</ul>
    <div class="btn-group">
      <button class="btn-edit">Edit</button>
    </div>
  `;
  card.querySelector(".btn-edit").addEventListener("click", () => openModifierListSidebar(list, card));
}

function modifierListFormHTML(list) {
  const entriesHTML = (list?.modifiers || []).map((m, i) => modifierEntryHTML(m, i)).join("");
  return `
    <label class="sidebar-label">Name</label>
    <input class="edit-input mod-list-name" type="text" value="${list?.name || ""}" placeholder="e.g. Toppings">
    <label class="sidebar-label">Selection type</label>
    <select class="edit-input edit-select mod-list-type">
      <option value="MULTIPLE" ${!list || list.selectionType === "MULTIPLE" ? "selected" : ""}>Multiple choice</option>
      <option value="SINGLE" ${list?.selectionType === "SINGLE" ? "selected" : ""}>Single choice</option>
    </select>
    <label class="sidebar-label">Options</label>
    <div class="modifier-entries">${entriesHTML}</div>
    <button class="btn-add-mod">+ Add Option</button>
  `;
}

function modifierEntryHTML(mod, index) {
  return `
    <div class="modifier-entry" data-index="${index}">
      <input class="edit-input mod-name" type="text" value="${mod?.name || ""}" placeholder="Option name" data-id="${mod?.id || ""}">
      <input class="edit-input mod-price" type="number" step="0.01" min="0" value="${mod?.priceCents ? (mod.priceCents / 100).toFixed(2) : ""}" placeholder="+$0.00">
      <button class="btn-remove-mod" title="Remove">✕</button>
    </div>
  `;
}

function attachModifierListeners(container) {
  container.querySelectorAll(".btn-remove-mod").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest(".modifier-entry").remove());
  });

  container.querySelector(".btn-add-mod").addEventListener("click", () => {
    const entries = container.querySelector(".modifier-entries");
    const index = entries.querySelectorAll(".modifier-entry").length;
    const div = document.createElement("div");
    div.innerHTML = modifierEntryHTML({ name: "", priceCents: 0, id: "" }, index);
    const entry = div.firstElementChild;
    entry.querySelector(".btn-remove-mod").addEventListener("click", () => entry.remove());
    entries.appendChild(entry);
    entry.querySelector(".mod-name").focus();
  });
}

function collectModifiers(container) {
  return Array.from(container.querySelectorAll(".modifier-entry")).map((entry) => ({
    id: entry.querySelector(".mod-name").dataset.id || null,
    name: entry.querySelector(".mod-name").value.trim(),
    priceCents: (() => {
      const v = parseFloat(entry.querySelector(".mod-price").value);
      return isNaN(v) || v <= 0 ? 0 : Math.round(v * 100);
    })(),
  })).filter((m) => m.name);
}

function openModifierListSidebar(list, card) {
  const isEdit = !!list;

  openSidebar(
    isEdit ? "Edit Option List" : "Add Option List",
    modifierListFormHTML(list),
    async () => {
      const body = document.getElementById("sidebar-body");
      const name = body.querySelector(".mod-list-name").value.trim();
      const selectionType = body.querySelector(".mod-list-type").value;
      if (!name) { alert("Name cannot be empty."); return; }

      const modifiers = collectModifiers(body);

      try {
        if (isEdit) {
          const res = await fetch(`/modifier-lists/${list.catalogObjectId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, selectionType, modifiers }),
          });
          const data = await res.json();
          if (!res.ok) { alert(data.error || "Failed to update option list."); return; }
          list.name = data.name;
          list.selectionType = data.selectionType;
          list.modifiers = data.modifiers;
          closeSidebar();
          renderModifierListDisplay(card, list);
        } else {
          const res = await fetch("/modifier-lists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, selectionType, modifiers }),
          });
          const newList = await res.json();
          if (!res.ok) { alert(newList.error || "Failed to add option list."); return; }
          closeSidebar();
          modifierListsContainer.appendChild(createModifierListCard({ ...newList, modifiers: newList.modifiers || [] }));
        }
      } catch (err) {
        console.error("Save error:", err);
        alert("Something went wrong. Please try again.");
      }
    },
    {
      saveLabel: isEdit ? "Save" : "Add List",
      afterOpen: (body) => attachModifierListeners(body),
    }
  );
}

document.getElementById("add-modifier-list-btn").addEventListener("click", () => openModifierListSidebar(null, null));

async function loadModifierLists() {
  try {
    const res = await fetch("/modifier-lists");
    const lists = await res.json();
    if (!lists.length) { modifierListsContainer.textContent = "No option lists found."; return; }
    lists.forEach((list) => modifierListsContainer.appendChild(createModifierListCard(list)));
  } catch (err) {
    console.error("Failed to load modifier lists:", err);
    modifierListsContainer.textContent = "Failed to load option lists.";
  }
}

loadCategories();
loadModifierLists();
