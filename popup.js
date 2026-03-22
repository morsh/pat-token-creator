/**
 * Popup script for ADO PAT Token Creator.
 *
 * Responsibilities:
 *  1. On open: check active tab and show appropriate UI state
 *     – Not on tokens page → navigate notice + "Open Tokens Page" button
 *     – On page but not authenticated → auth notice
 *     – On page and authenticated → main form (ready to go)
 *  2. "Open Tokens Page" button: opens / focuses the ADO tokens tab
 *  3. Validate token name, send createToken to content script
 *  4. Display live progress updates forwarded from content script
 */

const TOKENS_URL = 'https://powerbi.visualstudio.com/_usersSettings/tokens';
const ADO_TOKENS_RE =
  /visualstudio\.com\/_usersSettings\/tokens|dev\.azure\.com\/_usersSettings\/tokens/i;

// ---------------------------------------------------------------------------
// Scope list (must mirror REQUIRED_SCOPES in content.js)
// ---------------------------------------------------------------------------
const SCOPES = [
  'Build',
  'Code',
  'Deployment Groups',
  'Entitlements',
  'Environment',
  'Extensions',
  'Graph',
  'Identity',
  'Member Entitlement Management',
  'Notifications',
  'Packages',
  'Pipeline Resources',
  'Project and Team',
  'Pull Request Threads',
  'User Profile',
  'Wiki',
  'Work Items',
];

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const scopeList      = document.getElementById('scopeList');
const createBtn      = document.getElementById('createBtn');
const openPageBtn    = document.getElementById('openPageBtn');
const tokenNameInput = document.getElementById('tokenName');
const nameError      = document.getElementById('nameError');
const statusArea     = document.getElementById('statusArea');
const statusMessage  = document.getElementById('statusMessage');
const progressFill   = document.getElementById('progressFill');
const progressBar    = statusArea.querySelector('.progress-bar');
const authNotice     = document.getElementById('authNotice');
const navigateNotice = document.getElementById('navigateNotice');
const mainForm       = document.getElementById('mainForm');
const permissionsToggle  = document.getElementById('permissionsToggle');
const permissionsContent = document.getElementById('permissionsContent');
const permissionsLabel   = document.getElementById('permissionsLabel');
const tokenSection       = document.getElementById('tokenSection');
const tokenValueEl       = document.getElementById('tokenValue');
const tokenBase64El      = document.getElementById('tokenBase64');
const tokenExpiryEl      = document.getElementById('tokenExpiry');
const copyTokenBtn       = document.getElementById('copyToken');
const copyBase64Btn      = document.getElementById('copyBase64');
const npmrcMacBtn        = document.getElementById('npmrcMacBtn');
const npmrcWinBtn        = document.getElementById('npmrcWinBtn');
const npmrcHint          = document.getElementById('npmrcHint');

// ---------------------------------------------------------------------------
// Token storage (1-week TTL via chrome.storage.local)
// ---------------------------------------------------------------------------
const TOKEN_STORAGE_KEY = 'pat_token_data';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function saveToken(value) {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  await chrome.storage.local.set({ [TOKEN_STORAGE_KEY]: { value, expiresAt } });
  return expiresAt;
}

async function loadToken() {
  const result = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
  const data = result[TOKEN_STORAGE_KEY];
  if (!data || Date.now() > data.expiresAt) {
    if (data) await chrome.storage.local.remove(TOKEN_STORAGE_KEY);
    return null;
  }
  return data;
}

let _currentBase64 = '';

/**
 * Build a `node -e "..."` command that upserts the ADO npm registry
 * credentials into ~/.npmrc.  Mac/Linux uses single-quote outer wrapping;
 * Windows uses double-quote outer wrapping (cmd.exe / PowerShell).
 */
function buildNpmrcCommand(base64, platform) {
  const entries = [
    ['//powerbi.pkgs.visualstudio.com/_packaging/PowerBIClients/npm/registry/:username', 'powerbi'],
    ['//powerbi.pkgs.visualstudio.com/_packaging/PowerBIClients/npm/registry/:_password', base64],
    ['//powerbi.pkgs.visualstudio.com/_packaging/PowerBIClients/npm/registry/:always-auth', 'true'],
    ['//pkgs.dev.azure.com/powerbi/_packaging/PowerBIClients/npm/registry/:_password', base64],
    ['//pkgs.dev.azure.com/powerbi/_packaging/PowerBIClients/npm/registry/:username', 'powerbi'],
    ['//pkgs.dev.azure.com/powerbi/_packaging/PowerBIClients/npm/registry/:always-auth', 'true'],
  ];

  if (platform === 'mac') {
    // Outer single-quotes (zsh/bash) → double-quoted JS strings inside
    const obj = '{' + entries.map(([k, v]) => `"${k}":"${v}"`).join(',') + '}';
    const s = [
      `const fs=require("fs"),os=require("os"),p=require("path").join(os.homedir(),".npmrc")`,
      `const u=${obj}`,
      `const raw=fs.existsSync(p)?fs.readFileSync(p,"utf8"):""`,
      `let lines=raw.split(/\\r?\\n/)`,
      `if(lines[lines.length-1]==="")lines.pop()`,
      `const found=new Set()`,
      `lines=lines.map(l=>{const k=l.split("=")[0];if(u[k]!==undefined){found.add(k);return k+"="+u[k];}return l})`,
      `Object.entries(u).forEach(([k,v])=>{if(!found.has(k))lines.push(k+"="+v)})`,
      `fs.writeFileSync(p,lines.join(os.EOL))`,
      `console.log(".npmrc updated successfully")`,
    ].join(';');
    return `node -e '${s}'`;
  } else {
    // Outer double-quotes (cmd.exe / PowerShell) → single-quoted JS strings inside
    const obj = '{' + entries.map(([k, v]) => `'${k}':'${v}'`).join(',') + '}';
    const s = [
      `const fs=require('fs'),os=require('os'),p=require('path').join(os.homedir(),'.npmrc')`,
      `const u=${obj}`,
      `const raw=fs.existsSync(p)?fs.readFileSync(p,'utf8'):''`,
      `let lines=raw.split(/\\r?\\n/)`,
      `if(lines[lines.length-1]==='')lines.pop()`,
      `const found=new Set()`,
      `lines=lines.map(l=>{const k=l.split('=')[0];if(u[k]!==undefined){found.add(k);return k+'='+u[k];}return l})`,
      `Object.entries(u).forEach(([k,v])=>{if(!found.has(k))lines.push(k+'='+v)})`,
      `fs.writeFileSync(p,lines.join(os.EOL))`,
      `console.log('.npmrc updated successfully')`,
    ].join(';');
    return `node -e "${s}"`;
  }
}

async function copyNpmrcCommand(platform, btn) {
  const cmd = buildNpmrcCommand(_currentBase64, platform);
  try {
    await navigator.clipboard.writeText(cmd);
    btn.classList.add('copied');
    npmrcHint.textContent = '\u26a1 Copied! Paste and run in your terminal to update ~/.npmrc';
    npmrcHint.classList.remove('hidden');
    setTimeout(() => {
      btn.classList.remove('copied');
      npmrcHint.classList.add('hidden');
    }, 3000);
  } catch { /* clipboard denied */ }
}

npmrcMacBtn.addEventListener('click', () => copyNpmrcCommand('mac', npmrcMacBtn));
npmrcWinBtn.addEventListener('click', () => copyNpmrcCommand('win', npmrcWinBtn));

function showToken(value, expiresAt) {
  tokenValueEl.value  = value;
  _currentBase64 = btoa(value);
  tokenBase64El.value = _currentBase64;
  const expiry = new Date(expiresAt);
  tokenExpiryEl.textContent = `Valid until ${expiry.toLocaleDateString()}`;
  tokenSection.classList.remove('hidden');
  npmrcMacBtn.disabled = false;
  npmrcWinBtn.disabled = false;
}

// ---------------------------------------------------------------------------
// Populate scope checkboxes
// ---------------------------------------------------------------------------
for (const scope of SCOPES) {
  const li    = document.createElement('li');
  const label = document.createElement('label');
  const cb    = document.createElement('input');
  cb.type    = 'checkbox';
  cb.checked = true;
  cb.value   = scope;
  label.appendChild(cb);
  label.appendChild(document.createTextNode('\u00a0' + scope));
  li.appendChild(label);
  scopeList.appendChild(li);
  cb.addEventListener('change', updateScopeCount);
}

function getSelectedScopes() {
  return Array.from(scopeList.querySelectorAll('input[type="checkbox"]:checked'))
    .map((cb) => cb.value);
}

function updateScopeCount() {
  const n = getSelectedScopes().length;
  permissionsLabel.textContent = `Permissions (${n} selected)`;
}

// Expand / collapse permissions
permissionsToggle.addEventListener('click', () => {
  const expanded = permissionsToggle.getAttribute('aria-expanded') === 'true';
  permissionsToggle.setAttribute('aria-expanded', String(!expanded));
  permissionsContent.hidden = expanded;
});

// Copy to clipboard
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  } catch { /* clipboard permission denied */ }
}

copyTokenBtn.addEventListener('click', () => copyText(tokenValueEl.value, copyTokenBtn));
copyBase64Btn.addEventListener('click', () => copyText(tokenBase64El.value, copyBase64Btn));

// ---------------------------------------------------------------------------
// UI state helpers
// ---------------------------------------------------------------------------

/** Show the "not on tokens page" notice and hide the form. */
function showNavigateNotice() {
  navigateNotice.classList.remove('hidden');
  authNotice.classList.add('hidden');
  mainForm.style.display = 'none';
}

/** Show the "not signed in" notice and hide the form. */
function showAuthNotice() {
  authNotice.classList.remove('hidden');
  navigateNotice.classList.add('hidden');
  mainForm.style.display = 'none';
}

/** Show the main form (ready state). */
function showMainForm() {
  mainForm.style.display = '';
  navigateNotice.classList.add('hidden');
  authNotice.classList.add('hidden');
}

function setStatus(status, message, progress = null) {
  nameError.classList.add('hidden');
  statusArea.classList.remove('hidden');

  statusMessage.textContent = message;
  statusMessage.className = status; // 'running' | 'success' | 'warning' | 'error' | 'auth'

  progressFill.className = 'progress-fill';
  if (['success', 'warning', 'error'].includes(status)) {
    progressFill.classList.add(status);
  }

  if (progress !== null) {
    progressFill.style.width = `${progress}%`;
    progressBar.setAttribute('aria-valuenow', String(progress));
  }
}

function clearStatus() {
  statusArea.classList.add('hidden');
  progressFill.style.width = '0%';
  progressFill.className = 'progress-fill';
}

// ---------------------------------------------------------------------------
// Default token name: PAT-YYYY-MM-DD
// ---------------------------------------------------------------------------
function defaultTokenName() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `PAT-${y}-${m}-${d}`;
}

tokenNameInput.value = defaultTokenName();
async function initPopup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url || !ADO_TOKENS_RE.test(tab.url)) {
    showNavigateNotice();
    return;
  }

  // We are on the tokens page — ask the content script for the auth state
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'checkState',
    });

    if (response?.state === 'unauthenticated') {
      showAuthNotice();
    } else {
      showMainForm();
    }
  } catch {
    // Content script not (yet) injected — try to inject it now, then recheck
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'checkState',
      });
      if (response?.state === 'unauthenticated') {
        showAuthNotice();
      } else {
        showMainForm();
      }
    } catch {
      // Couldn't inject — show the form anyway, automation will surface auth errors
      showMainForm();
    }
  }
}

initPopup();

// Load any stored token that is still valid
loadToken().then((stored) => {
  if (stored) showToken(stored.value, stored.expiresAt);
});

// ---------------------------------------------------------------------------
// "Open Tokens Page" button
// ---------------------------------------------------------------------------
openPageBtn.addEventListener('click', async () => {
  // If a tokens page tab already exists, focus it; otherwise open a new one
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => t.url && ADO_TOKENS_RE.test(t.url));

  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: TOKENS_URL });
  }

  // Close the popup so the user lands on the page
  window.close();
});

// ---------------------------------------------------------------------------
// Live progress messages from the content script
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'status') return;

  if (message.status === 'auth') {
    showAuthNotice();
    createBtn.disabled = false;
    return;
  }

  if (message.status === 'token_ready') {
    setStatus('success', message.message, 100);
    const tokenVal = message.data?.tokenValue;
    if (tokenVal) {
      saveToken(tokenVal).then((expiresAt) => showToken(tokenVal, expiresAt));
    }
    createBtn.disabled = false;
    return;
  }

  setStatus(message.status, message.message, message.progress ?? null);

  if (['warning', 'error'].includes(message.status)) {
    createBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// "Fill in token form" button
// ---------------------------------------------------------------------------
createBtn.addEventListener('click', async () => {
  const tokenName = tokenNameInput.value.trim();

  // Validate name
  if (!tokenName) {
    nameError.classList.remove('hidden');
    tokenNameInput.classList.add('invalid');
    tokenNameInput.focus();

    tokenNameInput.addEventListener(
      'input',
      () => {
        nameError.classList.add('hidden');
        tokenNameInput.classList.remove('invalid');
      },
      { once: true }
    );
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url || !ADO_TOKENS_RE.test(tab.url)) {
    showNavigateNotice();
    return;
  }

  createBtn.disabled = true;
  clearStatus();
  setStatus('running', 'Connecting to page…', 2);

  const send = () =>
    chrome.tabs.sendMessage(tab.id, {
      action: 'createToken',
      tokenName,
      selectedScopes: getSelectedScopes(),
    });

  try {
    const response = await send();

    if (!response?.success && response?.error !== 'unauthenticated') {
      setStatus('error', response?.error ?? 'An unknown error occurred.');
      createBtn.disabled = false;
    }
    // success / warning / auth cases handled by the onMessage listener above
  } catch {
    // Content script not injected yet — inject and retry once
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      const response = await send();

      if (!response?.success && response?.error !== 'unauthenticated') {
        setStatus('error', response?.error ?? 'An unknown error occurred.');
        createBtn.disabled = false;
      }
    } catch (err) {
      setStatus(
        'error',
        `Could not reach the page. Try reloading the tokens page and trying again. (${err.message})`
      );
      createBtn.disabled = false;
    }
  }
});

