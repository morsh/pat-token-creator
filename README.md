# ADO PAT Token Creator — Chrome Extension

A developer-convenience Chrome extension that automates creating a Personal Access Token on Azure DevOps with all required permissions pre-selected. It fills and submits the form for you, then displays the token directly in the popup so you can copy it in one click.

---

## Permissions granted (all boxes checked)

Build · Code · Deployment Groups · Entitlements · Environment · Extensions · Graph · Identity · Member Entitlement Management · Notifications · Packaging · Pipeline Resources · Project and Team · Pull Request Threads · User Profile · Wiki · Work Items

---

## Installation

### Option A — Load the latest release (recommended)

1. Go to the [Releases page](https://github.com/morsh/pat-token-creator/releases) and download the latest `ado-pat-token-creator-vX.Y.Z.zip`.
2. Unzip it to a permanent folder on your machine (e.g. `~/tools/pat-token-creator`).
3. Open Chrome and navigate to `chrome://extensions`.
4. Enable **Developer mode** (toggle in the top-right corner).
5. Click **"Load unpacked"** and select the unzipped folder.
6. The extension icon appears in your toolbar.

### Option B — Load from source

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **"Load unpacked"** and select the `pat-token-creator` folder.
5. The extension icon appears in your toolbar.

---

## Usage

1. Navigate to [https://powerbi.visualstudio.com/_usersSettings/tokens](https://powerbi.visualstudio.com/_usersSettings/tokens).  
   > If you're not on the tokens page, the popup will show an **"Open Tokens Page"** button — click it to go there automatically.
2. Make sure you are signed in. If not, the popup will show a sign-in notice.
3. Click the **ADO PAT Token Creator** extension icon in the toolbar.
4. Enter a **Token name** (defaults to `PAT-YYYY-MM-DD`).
5. Optionally expand **Permissions** to review the 16 scopes that will be selected.
6. Click **"Create Token"**.  
   The extension will:
   - Open the **"+ New Token"** panel on the page.
   - Fill in the token name and expiry.
   - Select **"Custom defined"** scopes and check all required permission boxes.
   - Submit the form and capture the generated token.
7. The generated token appears in the popup with two copy buttons:
   - **Access Token** — the raw PAT value.
   - **Base64** — the token Base64-encoded, ready for HTTP Basic Auth headers or `.npmrc`.
8. Use the **"Update .npmrc"** buttons to copy a ready-to-run terminal command that upserts the Azure Artifacts credentials into your `~/.npmrc`:
   - **Mac / Linux** — generates a `node -e "..."` command wrapped in single quotes (for zsh/bash).
   - **Windows** — generates the same command with double-quote wrapping (for cmd / PowerShell).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not reach the page" | Reload the tokens page, then try again. |
| Some scopes show "not found" | The ADO UI labels may have changed. Check those scopes manually. |
| Progress bar stalls | The page may still be loading. Wait a moment and retry. |
| Token name field stays empty | Close and re-open the popup to refresh it. |
| Sign-in notice shown | Sign in to Azure DevOps in the browser, then re-open the popup. |

### If scope detection fails

The content script finds scope sections by matching their **visible text labels** in the DOM. If Microsoft renames a scope label, detection for that scope will fail gracefully with a warning. You can fix this by editing `content.js` → `REQUIRED_SCOPES` and adding the new label name to the `names` array for the relevant scope.

---

## Development

The extension is plain HTML/CSS/JS — no build step required.

```
pat-token-creator/
├── manifest.json          Chrome extension manifest (v3)
├── popup.html             Extension popup UI
├── popup.css              Popup styles
├── popup.js               Popup logic & messaging
├── content.js             Page automation content script
├── package.json           npm scripts for bundling & releasing
├── scripts/
│   ├── bundle.js          Creates a distributable .zip in dist/
│   └── sync-manifest.js   Keeps manifest.json version in sync with package.json
└── .github/workflows/
    └── release.yml        GitHub Actions: bundles & publishes a release on tag push
```

To reload after editing: go to `chrome://extensions` and click the **⟳ reload** button on the extension card.

---

## Bundling & Releasing

### Bundle locally

```bash
npm run bundle
# → dist/ado-pat-token-creator-v1.0.0.zip
```

### Publish a new release

```bash
npm run release          # bumps patch version (1.0.0 → 1.0.1)
# or
npm version minor        # 1.0.0 → 1.1.0
npm version major        # 1.0.0 → 2.0.0
git push origin main --tags
```

`npm run release` does three things automatically:
1. Bumps the version in `package.json` and `manifest.json`.
2. Creates a git commit and a `vX.Y.Z` tag.
3. Pushes the commit and tag to `origin main`.

The **GitHub Actions** workflow (`.github/workflows/release.yml`) then picks up the tag, bundles the extension, and creates a GitHub Release with the `.zip` attached.
