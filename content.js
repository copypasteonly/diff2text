(() => {
  const PR_URL_RE = /\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
  const BUTTON_ID = "diff2text-copy-btn";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const PASTE_ICON_PATH =
    "M5.75 1a.75.75 0 00-.75.75v3c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-3a.75.75 0 00-.75-.75h-4.5zm.75 3V2.5h3V4h-3zm-2.874-.467a.75.75 0 00-.752-1.298A1.75 1.75 0 002 3.75v9.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0014 13.25v-9.5a1.75 1.75 0 00-.874-1.515.75.75 0 10-.752 1.298.25.25 0 01.126.217v9.5a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25v-9.5a.25.25 0 01.126-.217z";

  function createPasteIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "octicon octicon-paste mr-1");
    svg.setAttribute("height", "16");
    svg.setAttribute("width", "16");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("d", PASTE_ICON_PATH);
    svg.appendChild(path);
    return svg;
  }

  function fillButtonLabel(label) {
    label.textContent = "";
    label.appendChild(createPasteIcon());
    label.appendChild(document.createTextNode("Copy PR"));
  }

  // --- DOM Scraping ---

  function parsePrFromUrl() {
    const match = window.location.pathname.match(PR_URL_RE);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: match[3] };
  }

  function getAuthor() {
    const authorLink =
      document.querySelector(".gh-header-meta .author") ||
      document.querySelector(
        "[data-component='PageHeader.Description'] a[data-hovercard-type='user']"
      ) ||
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

  function getTitle() {
    const el =
      document.querySelector(".gh-header-title .js-issue-title") ||
      document.querySelector(".js-issue-title") ||
      document.querySelector("h1[data-component='PH_Title'] .markdown-title");
    return el ? el.textContent.trim() : "";
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

  async function fetchText(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} from ${response.url}`);
      error.status = response.status;
      throw error;
    }
    return response.text();
  }

  function fetchDiffFromApi(pr, token) {
    const headers = { Accept: "application/vnd.github.diff" };
    if (token) headers.Authorization = `Bearer ${token}`;

    return fetchText(
      `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`,
      { headers, credentials: "omit" }
    );
  }

  async function fetchDiffFromSession(pr) {
    const diffUrl = `${window.location.origin}/${pr.owner}/${pr.repo}/pull/${pr.number}.diff`;
    const options = { credentials: "include", redirect: "follow" };

    try {
      return await fetchText(diffUrl, options);
    } catch (err) {
      // patch-diff.githubusercontent.com sometimes returns transient 5xx
      if (!(err.status >= 500)) throw err;
      console.warn("[diff2text] Retrying .diff after", err.message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return fetchText(diffUrl, options);
    }
  }

  async function getToken() {
    try {
      const result = await browser.storage.local.get("githubToken");
      return (result.githubToken || "").trim();
    } catch {
      return "";
    }
  }

  // Order: API with token (if set) -> session .diff (retried once on 5xx)
  // -> unauthenticated API (public repos only).
  async function fetchDiff() {
    const pr = parsePrFromUrl();
    if (!pr) throw new Error("Not on a PR page");

    const token = await getToken();
    const attempts = [];
    if (token) attempts.push(["API (token)", () => fetchDiffFromApi(pr, token)]);
    attempts.push(["session .diff", () => fetchDiffFromSession(pr)]);
    if (!token) attempts.push(["API (no token)", () => fetchDiffFromApi(pr, "")]);

    const failures = [];
    for (const [name, attempt] of attempts) {
      try {
        return await attempt();
      } catch (err) {
        console.warn(`[diff2text] ${name} failed:`, err.message);
        failures.push(`${name}: ${err.message}`);
      }
    }
    throw new Error(`All diff sources failed (${failures.join("; ")})`);
  }

  // --- Config ---

  const DEFAULT_TEMPLATE = `{{TITLE}}
PR #{{PR_NUMBER}}
Author: {{AUTHOR}}
PR Description:
{{DESCRIPTION}}

{{DIFF}}`;

  async function getTemplate() {
    try {
      const result = await browser.storage.local.get("configText");
      return result.configText || DEFAULT_TEMPLATE;
    } catch {
      return DEFAULT_TEMPLATE;
    }
  }

  function renderTemplate(template, vars) {
    let output = template;
    for (const [key, value] of Object.entries(vars)) {
      output = output.split(`{{${key}}}`).join(value);
    }
    return output;
  }

  // --- Assembly & Copy ---

  async function copyPrData(btn) {
    const pr = parsePrFromUrl();
    if (!pr) return;

    btn.disabled = true;
    btn.querySelector(".Button-label").textContent = "Copying...";

    try {
      const [diff, template] = await Promise.all([
        fetchDiff(),
        getTemplate(),
      ]);

      const prUrl = `${window.location.origin}/${pr.owner}/${pr.repo}/pull/${pr.number}`;

      const output = renderTemplate(template, {
        PR_NUMBER: pr.number,
        TITLE: getTitle(),
        AUTHOR: getAuthor(),
        DESCRIPTION: await getDescription(pr),
        DIFF: diff,
        REPO: pr.repo,
        OWNER: pr.owner,
        URL: prUrl,
      });

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
    if (label) fillButtonLabel(label);
  }

  // --- Button Injection ---

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const anchor = findButtonAnchor();
    if (!anchor) return;

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.className = "Button--secondary Button--small Button mr-2";
    btn.type = "button";
    btn.setAttribute("data-view-component", "true");

    const content = document.createElement("span");
    content.className = "Button-content";
    const label = document.createElement("span");
    label.className = "Button-label";
    fillButtonLabel(label);
    content.appendChild(label);
    btn.appendChild(content);

    btn.addEventListener("click", () => copyPrData(btn));

    if (anchor.prepend) {
      anchor.el.prepend(btn);
    } else {
      btn.classList.add("ml-2");
      anchor.el.appendChild(btn);
    }
  }

  // Old header (Files tab, classic UI) uses .gh-header-actions. The React PR
  // page uses a Primer PageHeader whose actions slot is hidden (d-none) when
  // empty, e.g. logged out, so fall back to the title area in that case.
  function findButtonAnchor() {
    const legacy = document.querySelector(".gh-header-actions");
    if (legacy) return { el: legacy, prepend: true };

    const actions = document.querySelector("[data-component='PH_Actions']");
    if (actions && !actions.classList.contains("d-none")) {
      return { el: actions, prepend: true };
    }

    const titleArea = document.querySelector("[data-component='TitleArea']");
    if (titleArea) return { el: titleArea, prepend: false };

    return null;
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
