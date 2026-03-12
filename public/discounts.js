const discountsContainer = document.getElementById("discounts");

function formatDiscountValue(discount) {
  if (discount.discountType === "FIXED_AMOUNT" && discount.amountCents != null) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: discount.currency }).format(discount.amountCents / 100);
  }
  if (discount.discountType === "FIXED_PERCENTAGE" && discount.percentage != null) {
    return `${discount.percentage}%`;
  }
  return "Variable";
}

function discountTypeLabel(type) {
  switch (type) {
    case "FIXED_AMOUNT": return "Fixed Amount";
    case "FIXED_PERCENTAGE": return "Fixed Percentage";
    case "VARIABLE_AMOUNT": return "Variable Amount";
    case "VARIABLE_PERCENTAGE": return "Variable Percentage";
    default: return type;
  }
}

function createCard(discount) {
  const card = document.createElement("div");
  card.className = "card";
  renderDisplayMode(card, discount);
  return card;
}

function renderDisplayMode(card, discount) {
  const isEditable = discount.discountType === "FIXED_AMOUNT" || discount.discountType === "FIXED_PERCENTAGE";

  card.innerHTML = `
    <h2>${discount.name}</h2>
    <p class="price">${formatDiscountValue(discount)}</p>
    <p class="discount-type">${discountTypeLabel(discount.discountType)}</p>
    <div class="btn-group">
      ${isEditable ? `<button class="btn-edit">Edit</button>` : ""}
    </div>
  `;

  if (isEditable) {
    card.querySelector(".btn-edit").addEventListener("click", () => openDiscountSidebar(discount, card));
  }
}

function discountFormHTML(discount) {
  const isAmount = !discount || discount.discountType === "FIXED_AMOUNT";
  const currentValue = discount
    ? (isAmount ? (discount.amountCents / 100).toFixed(2) : discount.percentage || "")
    : "";

  if (discount) {
    // Edit: type is fixed, just show name + value
    return `
      <label class="sidebar-label">Name</label>
      <input class="edit-input" type="text" value="${discount.name}" placeholder="Discount name">
      <label class="sidebar-label">${isAmount ? "Amount" : "Percentage"}</label>
      <input class="edit-input" type="number" step="0.01" min="0" value="${currentValue}"
        placeholder="${isAmount ? "0.00" : "0.00"}">
      <p class="discount-type" style="margin-top:0.25rem">${discountTypeLabel(discount.discountType)}</p>
    `;
  }

  // Add: let user pick the type
  return `
    <label class="sidebar-label">Name</label>
    <input class="edit-input" type="text" placeholder="Discount name">
    <label class="sidebar-label">Type</label>
    <select class="edit-input edit-select" id="sb-discount-type">
      <option value="FIXED_AMOUNT">Fixed Amount ($)</option>
      <option value="FIXED_PERCENTAGE">Fixed Percentage (%)</option>
    </select>
    <label class="sidebar-label" id="sb-value-label">Amount</label>
    <input class="edit-input" type="number" step="0.01" min="0" placeholder="0.00">
  `;
}

function openDiscountSidebar(discount, card) {
  const isEdit = !!discount;

  openSidebar(
    isEdit ? "Edit Discount" : "Add Discount",
    discountFormHTML(discount),
    async () => {
      const body = document.getElementById("sidebar-body");
      const inputs = body.querySelectorAll(".edit-input");
      const name = inputs[0].value.trim();
      const val = parseFloat(inputs[isEdit ? 1 : 2].value);

      if (!name) { alert("Name cannot be empty."); return; }
      if (isNaN(val) || val < 0) { alert("Please enter a valid value."); return; }

      try {
        if (isEdit) {
          const isAmount = discount.discountType === "FIXED_AMOUNT";
          const payload = { name };
          if (isAmount) payload.amountCents = Math.round(val * 100);
          else payload.percentage = String(val);

          const res = await fetch(`/discounts/${discount.catalogObjectId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) { alert(data.error || "Failed to update discount."); return; }

          discount.name = name;
          if (isAmount) discount.amountCents = payload.amountCents;
          else discount.percentage = payload.percentage;
          closeSidebar();
          renderDisplayMode(card, discount);
        } else {
          const discountType = body.querySelector("#sb-discount-type").value;
          const payload = { name, discountType };
          if (discountType === "FIXED_AMOUNT") payload.amountCents = Math.round(val * 100);
          else payload.percentage = String(val);

          const res = await fetch("/discounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const newDiscount = await res.json();
          if (!res.ok) { alert(newDiscount.error || "Failed to add discount."); return; }
          closeSidebar();
          discountsContainer.appendChild(createCard(newDiscount));
        }
      } catch (err) {
        console.error("Save error:", err);
        alert("Something went wrong. Please try again.");
      }
    },
    {
      saveLabel: isEdit ? "Save" : "Add Discount",
      afterOpen: (body) => {
        // Update value label when type changes (add mode only)
        const typeSelect = body.querySelector("#sb-discount-type");
        const valueLabel = body.querySelector("#sb-value-label");
        if (typeSelect && valueLabel) {
          typeSelect.addEventListener("change", () => {
            valueLabel.textContent = typeSelect.value === "FIXED_AMOUNT" ? "Amount" : "Percentage";
          });
        }
      },
    }
  );
}

async function loadDiscounts() {
  try {
    const res = await fetch("/discounts");
    const discounts = await res.json();
    if (!discounts.length) { discountsContainer.textContent = "No discounts found."; return; }
    discounts.forEach((d) => discountsContainer.appendChild(createCard(d)));
  } catch (err) {
    console.error("Failed to load discounts:", err);
    discountsContainer.textContent = "Failed to load discounts. Is the server running?";
  }
}

document.getElementById("add-discount-btn").addEventListener("click", () => openDiscountSidebar(null, null));

loadDiscounts();
