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

  card.innerHTML = `
    <h2>${item.name}</h2>
    <p class="price">${formatPrice(item.priceCents, item.currency)}</p>
    <button>Order Now</button>
  `;

  card.querySelector("button").addEventListener("click", () => {
    orderItem(item.variationId);
  });

  return card;
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
