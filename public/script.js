const menuContainer = document.getElementById("menu");

function formatPrice(cents, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

// ---------------------------------------------------------------------------
// Image preview helper (works on any container)
// ---------------------------------------------------------------------------
function attachImagePreview(container) {
  const imgInput = container.querySelector(".img-input");
  const imgEl = container.querySelector(".img-preview");
  const imgLabel = container.querySelector(".img-input-label");
  if (!imgInput) return;

  imgInput.addEventListener("change", () => {
    const file = imgInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      imgEl.src = e.target.result;
      imgEl.style.display = "";
      imgLabel.textContent = "Change Image";
      imgLabel.appendChild(imgInput);
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Item sidebar form
// ---------------------------------------------------------------------------
function itemFormHTML(item) {
  const priceDollars = item ? (item.priceCents / 100).toFixed(2) : "";
  return `
    <div class="img-edit-area">
      <img class="img-preview" src="${item?.imageUrl || ""}" alt="preview" ${!item?.imageUrl ? 'style="display:none"' : ""}>
      <label class="img-input-label">
        ${item?.imageUrl ? "Change Image" : "+ Add Image"}
        <input type="file" accept="image/*" class="img-input" hidden>
      </label>
    </div>
    <label class="sidebar-label">Name</label>
    <input class="edit-input" type="text" value="${item?.name || ""}" placeholder="Item name">
    <label class="sidebar-label">Price</label>
    <input class="edit-input" type="number" step="0.01" min="0" value="${priceDollars}" placeholder="0.00">
  `;
}

function openItemSidebar(item, card) {
  const isEdit = !!item;

  openSidebar(
    isEdit ? "Edit Item" : "Add Item",
    itemFormHTML(item),
    async () => {
      const body = document.getElementById("sidebar-body");
      const inputs = body.querySelectorAll(".edit-input");
      const name = inputs[0].value.trim();
      const priceCents = Math.round(parseFloat(inputs[1].value) * 100);

      if (!name) { alert("Name cannot be empty."); return; }
      if (isNaN(priceCents) || priceCents < 0) { alert("Please enter a valid price."); return; }

      try {
        if (isEdit) {
          const imageFile = body.querySelector(".img-input")?.files[0];
          if (imageFile) {
            const fd = new FormData();
            fd.append("image", imageFile);
            const r = await fetch(`/menu/${item.catalogObjectId}/image`, { method: "PUT", body: fd });
            const d = await r.json();
            if (!r.ok) { alert(d.error || "Failed to upload image."); return; }
            item.imageUrl = d.imageUrl;
          }

          const res = await fetch(`/menu/${item.catalogObjectId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, priceCents }),
          });
          const data = await res.json();
          if (!res.ok) { alert(data.error || "Failed to update item."); return; }

          item.name = name;
          item.priceCents = priceCents;
          closeSidebar();
          renderDisplayMode(card, item);
        } else {
          const fd = new FormData();
          fd.append("name", name);
          fd.append("priceCents", priceCents);
          const imageFile = body.querySelector(".img-input")?.files[0];
          if (imageFile) fd.append("image", imageFile);

          const res = await fetch("/menu", { method: "POST", body: fd });
          const newItem = await res.json();
          if (!res.ok) { alert(newItem.error || "Failed to add item."); return; }

          closeSidebar();
          menuContainer.appendChild(createCard(newItem));
        }
      } catch (err) {
        console.error("Save error:", err);
        alert("Something went wrong. Please try again.");
      }
    },
    {
      saveLabel: isEdit ? "Save" : "Add Item",
      afterOpen: (body) => attachImagePreview(body),
    }
  );
}

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------
function createCard(item) {
  const card = document.createElement("div");
  card.className = "card";
  renderDisplayMode(card, item);
  return card;
}

function renderDisplayMode(card, item) {
  card.innerHTML = `
    ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.name}">` : ""}
    <h2>${item.name}</h2>
    <p class="price">${formatPrice(item.priceCents, item.currency)}</p>
    <div class="btn-group">
      <button class="btn-edit">Edit</button>
      <button>Order Now</button>
    </div>
  `;

  card.querySelector(".btn-edit").addEventListener("click", () => openItemSidebar(item, card));
  card.querySelector("button:not(.btn-edit)").addEventListener("click", () => orderItem(item.variationId));
}

// ---------------------------------------------------------------------------
// Load & order
// ---------------------------------------------------------------------------
async function loadMenu() {
  try {
    const res = await fetch("/menu");
    const items = await res.json();
    if (!items.length) { menuContainer.textContent = "No items on the menu yet."; return; }
    items.forEach((item) => menuContainer.appendChild(createCard(item)));
  } catch (err) {
    console.error("Failed to load menu:", err);
    menuContainer.textContent = "Failed to load menu. Is the server running?";
  }
}

async function orderItem(variationId) {
  try {
    const res = await fetch("/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemVariationId: variationId }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      alert(data.error || "Failed to create checkout link.");
    }
  } catch (err) {
    console.error("Checkout error:", err);
    alert("Something went wrong. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Add button
// ---------------------------------------------------------------------------
document.getElementById("add-item-btn").addEventListener("click", () => openItemSidebar(null, null));

loadMenu();
