# ADO PAT Token Creator — Chrome Extension

A developer-convenience Chrome extension that automates filling in the **New Token** form on the Azure DevOps Personal Access Tokens page with all required permissions pre-selected.

> **Security note:** The form is filled but **never submitted automatically**. You always review the filled-in form and click **"Create"** yourself.

---

## Permissions granted (all boxes checked)

| Scope | Scope | Scope |
|---|---|---|
| Build | Entitlements | Notifications |
| Code | Environment | Pipeline Resources |
| Deployment Groups | Extensions | Project and Team |
| Entitlements | Graph | Pull Request Threads |
| Identity | Member Entitlement Management | User Profile |
| Wiki | Work Items | |

---

## Installation

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **"Load unpacked"**.
4. Select the `pat-token-creator` folder (this directory).
5. The extension icon appears in your toolbar.

---

## Usage

1. Navigate to [https://powerbi.visualstudio.com/_usersSettings/tokens](https://powerbi.visualstudio.com/_usersSettings/tokens).
2. Click the **ADO PAT Token Creator** extension icon in the toolbar.
3. Enter a **Token name** in the popup.
4. Click **"Fill in token form"**.
5. The extension will:
   - Click **"+ New Token"** on the page.
   - Set the token name you provided.
   - Select **"Custom defined"** for scopes.
   - Check **all permission boxes** for each of the required scopes.
6. Review the completed form in the browser.
7. Click **"Create"** to generate the token — the extension never does this for you.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not reach the page" | Reload the tokens page, then try again. |
| Some scopes show "not found" | The ADO UI labels may have changed. Check those scopes manually. |
| Progress bar stalls | The page may still be loading. Wait a moment and retry. |
| Token name field stays empty | Refresh the popup (close and re-open it). |

### If scope detection fails

The content script finds scope sections by matching their **visible text labels** in the DOM. If Microsoft renames a scope label, detection for that scope will fail gracefully with a warning. You can fix this by editing `content.js` → `REQUIRED_SCOPES` and adding the new label name to the `names` array for the relevant scope.

---

## Development

The extension is plain HTML/CSS/JS — no build step required.

```
pat-token-creator/
├── manifest.json   Chrome extension manifest (v3)
├── popup.html      Extension popup UI
├── popup.css       Popup styles
├── popup.js        Popup logic & messaging
└── content.js      Page automation content script
```

To reload after editing: go to `chrome://extensions` and click the **⟳ reload** button on the extension card.
