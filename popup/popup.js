const textarea = document.getElementById("config-text");
const saveBtn = document.getElementById("save-btn");
const status = document.getElementById("status");

let statusTimeout = null;

// Load saved config on popup open
browser.storage.local.get("configText").then((result) => {
  textarea.value = result.configText || "";
});

saveBtn.addEventListener("click", () => {
  browser.storage.local.set({ configText: textarea.value }).then(() => {
    status.textContent = "Saved!";
    status.classList.add("visible");

    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => {
      status.classList.remove("visible");
    }, 2000);
  });
});
