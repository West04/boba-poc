const menuContainer = document.getElementById("menu");

function formatPrice(cents, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

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

  card.querySelector(".btn-edit").addEventListener("click", () => {
    renderEditMode(card, item);
  });

  card.querySelector("button:not(.btn-edit)").addEventListener("click", () => {
    orderItem(item.variationId);
  });
}

function renderEditMode(card, item) {
  const priceDollars = (item.priceCents / 100).toFixed(2);

  card.innerHTML = `
    ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.name}">` : ""}
    <input class="edit-input" type="text" value="${item.name}" placeholder="Item name">
    <input class="edit-input" type="number" step="0.01" min="0" value="${priceDollars}" placeholder="Price">
    <div class="btn-group">
      <button class="btn-cancel">Cancel</button>
      <button>Save</button>
    </div>
  `;

  const nameInput = card.querySelectorAll(".edit-input")[0];
  const priceInput = card.querySelectorAll(".edit-input")[1];

  card.querySelector(".btn-cancel").addEventListener("click", () => {
    renderDisplayMode(card, item);
  });

  card.querySelector("button:not(.btn-cancel)").addEventListener("click", async () => {
    const newName = nameInput.value.trim();
    const newPriceCents = Math.round(parseFloat(priceInput.value) * 100);

    if (!newName) {
      alert("Name cannot be empty.");
      return;
    }
    if (isNaN(newPriceCents) || newPriceCents < 0) {
      alert("Please enter a valid price.");
      return;
    }

    try {
      const res = await fetch(`/menu/${item.catalogObjectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, priceCents: newPriceCents }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to update item.");
        return;
      }

      // Update local item data and re-render in display mode
      item.name = newName;
      item.priceCents = newPriceCents;
      renderDisplayMode(card, item);
    } catch (err) {
      console.error("Update error:", err);
      alert("Something went wrong. Please try again.");
    }
  });
}

async function loadMenu() {
  try {
    const res = await fetch("/menu");
    const items = await res.json();

    if (!items.length) {
      menuContainer.textContent = "No items on the menu yet.";
      return;
    }

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

loadMenu();
