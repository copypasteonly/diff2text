(() => {
  const PR_URL_RE = /\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
  const BUTTON_ID = "diff2text-copy-btn";

  const PASTE_ICON_SVG = `<svg class="octicon octicon-paste mr-1" height="16" viewBox="0 0 16 16" width="16" aria-hidden="true">
    <path fill-rule="evenodd" d="M5.75 1a.75.75 0 00-.75.75v3c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-3a.75.75 0 00-.75-.75h-4.5zm.75 3V2.5h3V4h-3zm-2.874-.467a.75.75 0 00-.752-1.298A1.75 1.75 0 002 3.75v9.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0014 13.25v-9.5a1.75 1.75 0 00-.874-1.515.75.75 0 10-.752 1.298.25.25 0 01.126.217v9.5a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25v-9.5a.25.25 0 01.126-.217z"></path>
  </svg>`;

  // --- DOM Scraping ---

  function parsePrFromUrl() {
    const match = window.location.pathname.match(PR_URL_RE);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: match[3] };
  }

  function getAuthor() {
    const authorLink =
      document.querySelector(".gh-header-meta .author") ||
      document.querySelector("[data-hovercard-type='user'].author") ||
      document.querySelector(".pull-header-author .author");
    if (authorLink) return authorLink.textContent.trim();

    const headerMeta = document.querySelector(".gh-header-meta");
    if (headerMeta) {
      const link = headerMeta.querySelector(
        "a.author, a[data-hovercard-type='user']"
      );
      if (link) return link.textContent.trim();
    }

    return "unknown";
  }

  function normalizeDescription(text) {
    const value = text.trim();
    if (!value) return "";

    const lowered = value.toLowerCase();
    if (lowered === "nothing to preview") return "";

    return value;
  }

  function extractDescription(root) {
    const selectors = [
      "[data-testid='issue-body']",
      ".js-discussion .timeline-comment-group:first-of-type .comment-body",
      ".timeline-comment .comment-body",
      ".js-comment-body",
      ".comment-body",
    ];

    for (const selector of selectors) {
      const nodes = root.querySelectorAll(selector);
      for (const node of nodes) {
        if (
          node.closest("form") ||
          node.closest(".preview-content") ||
          node.closest(".write-content") ||
          node.closest(".js-previewable-comment-form")
        ) {
          continue;
        }

        const description = normalizeDescription(node.textContent || "");
        if (description) {
          return description;
        }
      }
    }

    return "";
  }

  async function getDescription(pr) {
    const currentPageDescription = extractDescription(document);
    if (currentPageDescription) {
      return currentPageDescription;
    }

    const prUrl = `${window.location.origin}/${pr.owner}/${pr.repo}/pull/${pr.number}`;
    const response = await fetch(prUrl, {
      credentials: "include",
      redirect: "follow",
    });

    if (!response.ok) {
      console.warn(
        `[diff2text] Failed to fetch PR page for description: HTTP ${response.status} from ${response.url}`
      );
      return "";
    }

    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return extractDescription(parsed);
  }

  // --- Diff Fetching ---

  function fetchDiff() {
    const pr = parsePrFromUrl();
    if (!pr) return Promise.reject(new Error("Not on a PR page"));

    const diffUrl = `${window.location.origin}/${pr.owner}/${pr.repo}/pull/${pr.number}.diff`;

    return fetch(diffUrl, {
      credentials: "include",
      redirect: "follow",
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${response.url}`);
      }
      return response.text();
    });
  }

  // --- Config ---

  async function getConfigText() {
    try {
      const result = await browser.storage.local.get("configText");
      return result.configText || "";
    } catch {
      return "";
    }
  }

  // --- Assembly & Copy ---

  async function copyPrData(btn) {
    const pr = parsePrFromUrl();
    if (!pr) return;

    btn.disabled = true;
    btn.querySelector(".Button-label").textContent = "Copying...";

    try {
      const [diff, configText] = await Promise.all([
        fetchDiff(),
        getConfigText(),
      ]);

      const author = getAuthor();
      const description = await getDescription(pr);

      let output = "";
      if (configText) output += configText + "\n";
      output += `PR #${pr.number}\n`;
      output += `Author: ${author}\n`;
      output += `PR Description:\n`;
      output += description + "\n\n";
      output += diff;

      await navigator.clipboard.writeText(output);

      btn.querySelector(".Button-label").textContent = "Copied!";
      setTimeout(() => resetButton(btn), 2000);
    } catch (err) {
      console.error("[diff2text]", err);
      btn.querySelector(".Button-label").textContent = "Error!";
      setTimeout(() => resetButton(btn), 2000);
    }
  }

  function resetButton(btn) {
    btn.disabled = false;
    const label = btn.querySelector(".Button-label");
    if (label) {
      label.textContent = "";
      const temp = document.createElement("template");
      temp.innerHTML = `${PASTE_ICON_SVG}Copy PR`;
      label.appendChild(temp.content);
    }
  }

  // --- Button Injection ---

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;

    // Anchor into the PR header actions (available on all PR tabs)
    const headerActions = document.querySelector(".gh-header-actions");
    if (!headerActions) return;

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.className = "Button--secondary Button--small Button mr-2";
    btn.type = "button";
    btn.setAttribute("data-view-component", "true");

    const content = document.createElement("span");
    content.className = "Button-content";
    const label = document.createElement("span");
    label.className = "Button-label";
    const temp = document.createElement("template");
    temp.innerHTML = `${PASTE_ICON_SVG}Copy PR`;
    label.appendChild(temp.content);
    content.appendChild(label);
    btn.appendChild(content);

    btn.addEventListener("click", () => copyPrData(btn));

    headerActions.prepend(btn);
  }

  // --- Navigation Handling ---

  // On every mutation: if on a PR page and the anchor exists but button doesn't, inject.
  // No URL tracking needed — injectButton() is idempotent (checks for existing button first).
  const observer = new MutationObserver(() => {
    if (window.location.pathname.includes("/pull/")) {
      injectButton();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Also try on initial load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectButton);
  } else {
    injectButton();
  }
})();
