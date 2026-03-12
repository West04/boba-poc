const sidebarOverlay = document.getElementById("sidebar-overlay");
const sidebar = document.getElementById("sidebar");
const sidebarTitle = document.getElementById("sidebar-title");
const sidebarBody = document.getElementById("sidebar-body");
const sidebarSaveBtn = document.getElementById("sidebar-save");

let _onSave = null;

function openSidebar(title, bodyHTML, onSave, { saveLabel = "Save", afterOpen } = {}) {
  sidebarTitle.textContent = title;
  sidebarBody.innerHTML = bodyHTML;
  sidebarSaveBtn.textContent = saveLabel;
  _onSave = onSave;

  sidebarOverlay.classList.add("open");
  sidebar.classList.add("open");

  if (afterOpen) afterOpen(sidebarBody);

  // Focus the first focusable field
  sidebarBody.querySelector("input, select, textarea")?.focus();
}

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("open");
  _onSave = null;
}

document.getElementById("sidebar-close").addEventListener("click", closeSidebar);
document.getElementById("sidebar-cancel").addEventListener("click", closeSidebar);
sidebarOverlay.addEventListener("click", closeSidebar);
sidebarSaveBtn.addEventListener("click", () => _onSave?.());
