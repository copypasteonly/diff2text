const textarea = document.getElementById("config-text");
const saveBtn = document.getElementById("save-btn");
const statusEl = document.getElementById("status");

let statusTimeout = null;

const DEFAULT_TEMPLATE = `{{TITLE}}
PR #{{PR_NUMBER}}
Author: {{AUTHOR}}
PR Description:
{{DESCRIPTION}}

{{DIFF}}`;

// Load saved config
browser.storage.local.get("configText").then((result) => {
  textarea.value = result.configText || DEFAULT_TEMPLATE;
});

// Variable chip insertion
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const varName = chip.getAttribute("data-var");
    const tag = `{{${varName}}}`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);

    textarea.value = before + tag + after;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + tag.length;
  });
});

// Save
saveBtn.addEventListener("click", () => {
  browser.storage.local
    .set({ configText: textarea.value })
    .then(() => browser.storage.local.remove("githubToken"))
    .then(() => {
      statusEl.textContent = "Saved!";
      statusEl.classList.add("visible");

      clearTimeout(statusTimeout);
      statusTimeout = setTimeout(() => {
        statusEl.classList.remove("visible");
      }, 2000);
    });
});
