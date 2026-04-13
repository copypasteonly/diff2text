# diff2text — Firefox Extension Design Spec

## Context

When reviewing GitHub pull requests, it's common to need the PR's metadata and diff in a single copyable block — for pasting into an LLM prompt, a review tool, or a note. Today this requires manually copying from multiple parts of the page and fetching the diff separately. This extension puts a single button on the PR page that assembles everything and copies it to clipboard.

## Overview

A Manifest V3 Firefox WebExtension that injects a button into GitHub pull request pages. Clicking it scrapes PR metadata from the DOM, fetches the raw unified diff via GitHub's `.diff` endpoint, and copies a structured text block to the clipboard. A toolbar popup lets the user configure a prefix text (e.g., an LLM prompt) that prepends the output.

## Architecture

### Components

1. **Content Script** (`content.js` + `content.css`) — Injected on `github.com/*/pull/*` pages. Handles button injection, DOM scraping, diff fetching, and clipboard copy.
2. **Popup** (`popup/popup.html`, `popup/popup.js`, `popup/popup.css`) — Toolbar popup for configuring the prefix text. Writes to `browser.storage.local`.
3. **Manifest** (`manifest.json`) — MV3. Declares content scripts, permissions, host permissions, and action popup.

No background/service worker in v1.

### Data Flow

```
User clicks injected button
  → Content script parses PR number from URL
  → Scrapes author and description from DOM
  → Fetches {PR_URL}.diff (same-origin, inherits user session)
  → Reads configText from browser.storage.local
  → Assembles output string
  → Copies to clipboard via navigator.clipboard.writeText()
  → Shows brief "Copied!" feedback on button
```

### File Structure

```
diff2text/
├── manifest.json
├── content.js
├── content.css
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── icons/
    ├── icon-48.png
    └── icon-96.png
```

## Manifest (manifest.json)

- `manifest_version`: 3
- `permissions`: `["storage", "clipboardWrite"]`
- `host_permissions`: `["https://github.com/*"]` — for future flexibility (e.g., moving fetch to service worker)
- `content_scripts`: match `["https://github.com/*/pull/*"]`, load `content.js` and `content.css`
- `action.default_popup`: `popup/popup.html`
- `browser_specific_settings.gecko.id`: extension ID for Firefox

## Content Script

### SPA Navigation Handling

GitHub is a single-page app (turbo-driven). The content script must:

1. Run on initial page load (if the URL matches a PR page).
2. Use a `MutationObserver` on a high-level container to detect client-side navigations.
3. On each relevant mutation, check the current URL against `/pull/\d+` pattern.
4. If on a PR page and the button is not already injected, inject it.
5. If navigated away from a PR page, clean up any injected button.
6. Track the last-seen URL to avoid redundant processing.

### Button Placement

Anchored into the PR header actions area (`.gh-header-actions` or a stable selector near the PR title/actions bar). Integrates naturally with GitHub's UI rather than floating on top of content.

### DOM Scraping

- **PR Number**: Parsed from `window.location.pathname` via regex `/\/pull\/(\d+)/`.
- **Author**: The author link in the PR header area (e.g., `.author` or similar selector in the PR header meta line).
- **PR Description**: The first `.comment-body` or `.js-comment-body` element in the PR timeline (this is the PR body, not a review comment).

### Diff Fetching

- URL: `${window.location.origin}${prPathname}.diff` (e.g., `https://github.com/owner/repo/pull/123.diff`)
- Uses `fetch()` from content script context — same-origin request inherits the user's GitHub cookies/session.
- Works for both public and private repos the user is logged into.
- Response is plain text, used as-is.

### Clipboard & Feedback

- `navigator.clipboard.writeText(assembledText)` to copy.
- On success: button text changes to "Copied!" with a checkmark for ~2 seconds, then reverts.
- On failure: button shows brief error state.

## Output Format

```
{configText — if non-empty, followed by newline}
PR #{number}
Author: {username}
PR Description:
{PR description body text}

{raw unified diff}
```

If `configText` is empty, the output starts directly at `PR #...`.

## Popup (Config UI)

### Layout

Minimal panel:
- `<textarea>` for prefix text, placeholder: "Enter your prompt or prefix text here..."
- "Save" button
- Status indicator ("Saved!" confirmation, fades after ~2 seconds)

### Storage

- Save: `browser.storage.local.set({ configText: value })`
- Load: `browser.storage.local.get("configText")` — on popup open to populate the textarea
- Content script reads the same key on each button click

### Default

Empty string — no prefix by default.

## Verification Plan

1. **Load as temporary extension** in Firefox (`about:debugging` → "This Firefox" → "Load Temporary Add-on")
2. **Navigate to a public GitHub PR** — verify the button appears in the PR header area
3. **Click the button** — verify clipboard contains the correct structured text with PR number, author, description, and diff
4. **Configure prefix text** via the popup — verify it appears at the top of the copied output
5. **SPA navigation test** — navigate between PR pages and non-PR pages using GitHub's internal links, verify button appears/disappears correctly and no duplicate buttons
6. **Private repo test** (if available) — verify the `.diff` fetch works when logged in
7. **Large PR test** — verify the diff fetches completely (not truncated)
8. **Cross-browser prep** — verify manifest is valid for Chrome MV3 as well (can be tested later)
