/**
 * Content script for ADO PAT Token Creator.
 *
 * Automates filling in the "New Token" form on the Azure DevOps personal
 * access tokens page. The form is filled but NOT submitted — the user
 * must review and click "Create" themselves.
 *
 * Key improvements over v1:
 *  - waitFor uses both MutationObserver AND polling so Angular async renders
 *    are never missed.
 *  - Every element-find step uses multiple fallback strategies.
 *  - Auth state is detected early and reported back to the popup.
 *  - Generous timeouts (20 s) with a bootstrap check before the first wait.
 */

// ---------------------------------------------------------------------------
// Required scope names exactly as labeled in the ADO token creation form.
// Each entry also lists common alternate casings/spellings seen in ADO.
// ---------------------------------------------------------------------------
const REQUIRED_SCOPES = [
  { names: ['Build'] },
  { names: ['Code'] },
  { names: ['Deployment Groups', 'Deployment groups'] },
  { names: ['Entitlements'] },
  { names: ['Environment'] },
  { names: ['Extensions'] },
  { names: ['Graph'] },
  { names: ['Identity'] },
  { names: ['Member Entitlement Management', 'Member entitlement management'] },
  { names: ['Notifications'] },
  { names: ['Packaging', 'Packages'] },
  { names: ['Pipeline Resources', 'Pipeline resources'] },
  { names: ['Project and Team', 'Project and team'] },
  { names: ['Pull Request Threads', 'Pull request threads'] },
  { names: ['User Profile', 'User profile'] },
  { names: ['Wiki'] },
  { names: ['Work Items', 'Work items'] },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const log  = (...args) => console.log('[PAT Creator]', ...args);
const warn = (...args) => console.warn('[PAT Creator]', ...args);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits until `checker` returns a truthy value.
 *
 * Uses BOTH a MutationObserver and a setInterval so Angular/React async
 * renders that don't trigger the observer are still caught.
 */
function waitFor(checker, timeout = 20000, pollMs = 250) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearInterval(poller);
      clearTimeout(timer);
      resolve(value);
    };

    const check = () => {
      if (settled) return;
      const v = checker();
      if (v) finish(v);
    };

    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    const poller = setInterval(check, pollMs);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearInterval(poller);
      reject(new Error(`Timeout: element not found within ${timeout}ms`));
    }, timeout);

    // Check immediately too
    check();
  });
}

// ---------------------------------------------------------------------------
// Auth / page-state detection
// ---------------------------------------------------------------------------

/**
 * Returns 'authenticated' | 'unauthenticated' | 'loading'.
 * Called both at the start of automation and on timeout to give a better
 * error message.
 */
function detectPageState() {
  const url = window.location.href;

  // Redirected to sign-in or login page (URL-based only — safe from ADO nav links)
  if (/login\.microsoftonline|\/signin\b|_signin/i.test(url)) {
    return 'unauthenticated';
  }

  // Presence of an actual login form (not just any link with "login" text)
  // Note: we intentionally skip checking for aria-label*="sign in" because
  // authenticated ADO pages have "Signed in as …" user-avatar labels that
  // would trigger a false positive.
  const hasLoginForm = !!document.querySelector(
    'form[action*="login"], #loginForm, [class*="login-container" i]'
  );
  if (hasLoginForm) {
    return 'unauthenticated';
  }

  // ADO app container visible → authenticated
  if (
    document.querySelector(
      '.vss-Page-content, .main-container, [class*="pac-pat"], [class*="PatList"]'
    )
  ) {
    return 'authenticated';
  }

  return 'loading';
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/**
 * Sets the value of a React/Angular-controlled input and fires the events
 * those frameworks listen for.
 */
function setInputValue(element, value) {
  const nativeSetter =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

  if (nativeSetter) nativeSetter.call(element, value);
  else element.value = value;

  ['input', 'change', 'blur', 'keyup'].forEach((eventName) =>
    element.dispatchEvent(new Event(eventName, { bubbles: true }))
  );
  // React synthetic event also needs InputEvent
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
}

/**
 * Find a button / [role=button] whose trimmed textContent matches `re`.
 * Prefers visible elements (offsetParent !== null).
 */
function findButtonByText(re) {
  const pattern = re instanceof RegExp ? re : new RegExp(re, 'i');
  let fallback = null;
  for (const el of document.querySelectorAll(
    'button, [role="button"], a[role="button"]'
  )) {
    if (!pattern.test(el.textContent.trim())) continue;
    if (el.offsetParent !== null) return el; // visible — prefer
    fallback = fallback || el;
  }
  return fallback;
}

/**
 * Multi-strategy "New Token" button finder.
 */
function findNewTokenButton() {
  // Strategy 1: text content (covers "+ New Token", "New Token", "New token")
  const byText = findButtonByText(/new\s+token/i);
  if (byText) return byText;

  // Strategy 2: aria-label / title attribute
  for (const el of document.querySelectorAll('[aria-label], [title]')) {
    const label = (
      el.getAttribute('aria-label') || el.getAttribute('title') || ''
    ).trim();
    if (/new\s+token/i.test(label)) return el;
  }

  return null;
}

/**
 * Find the token name text input inside a newly-opened panel / dialog.
 *
 * The actual Bolt input for the ADO "Create PAT" dialog uses:
 *   <input aria-label="Name" class="bolt-textfield-input" ...>
 * There is NO placeholder and NO type="text" attribute.
 */
function findNameInput() {
  const selectors = [
    // Actual ADO Bolt dialog — exact aria-label from the DOM
    '[role="dialog"] input[aria-label="Name"]',
    '[role="complementary"] input[aria-label="Name"]',
    '.bolt-panel-callout-content input[aria-label="Name"]',
    // Generic bolt textfield inside a panel (not a button type)
    '[role="dialog"] input.bolt-textfield-input:not([type="button"])',
    '.bolt-panel-callout-content input.bolt-textfield-input:not([type="button"])',
    // Broader fallbacks
    'input[aria-label="Name"]',
    'input[aria-label*="Token name" i]',
    'input[placeholder*="Token name" i]',
    'input[aria-label*="name" i]:not([type="button"])',
  ];
  for (const s of selectors) {
    try {
      const el = document.querySelector(s);
      if (el) return el;
    } catch { /* invalid selector – skip */ }
  }
  return null;
}

/**
 * Multi-strategy "Custom defined" radio / option finder.
 *
 * The real ADO Bolt dialog uses:
 *   <div role="radio" aria-checked="true" id="__bolt-custom">Custom defined</div>
 * — there are NO native input[type="radio"] elements.
 */
function findCustomDefinedOption() {
  // Strategy 1: Bolt [role="radio"] div containing "Custom defined" text
  for (const el of document.querySelectorAll('[role="radio"]')) {
    if (/custom\s*defined/i.test(el.textContent)) return el;
    // Check via aria-labelledby
    const labelId = el.getAttribute('aria-labelledby');
    if (labelId) {
      const label = document.getElementById(labelId);
      if (label && /custom\s*defined/i.test(label.textContent)) return el;
    }
  }

  // Strategy 2: native input[type="radio"] with associated "custom" label
  for (const radio of document.querySelectorAll('input[type="radio"]')) {
    const label =
      radio.closest('label') ||
      (radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null) ||
      radio.parentElement;
    if (label && /custom/i.test(label.textContent)) return radio;
    if (/custom/i.test([radio.value, radio.id, radio.name].join(' '))) return radio;
  }

  // Strategy 3: any element whose text is exactly "Custom defined"
  for (const el of document.querySelectorAll('span, div, label, p, td')) {
    if (/^custom\s+defined$/i.test(el.textContent.trim())) {
      let cur = el;
      for (let i = 0; i < 5; i++) {
        if (!cur || cur === document.body) break;
        if (cur.getAttribute('role') === 'radio' || cur.tagName === 'LABEL') return cur;
        cur = cur.parentElement;
      }
      return el;
    }
  }

  return null;
}

/**
 * Finds the "Show all scopes" link inside the PAT dialog.
 * Most scopes are hidden behind this link — must be clicked before
 * checking scope checkboxes.
 */
function findShowAllScopesButton() {
  for (const el of document.querySelectorAll('[role="button"], .bolt-link, span, a')) {
    if (/show\s+all\s+scopes/i.test(el.textContent.trim())) return el;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scope section detection
// ---------------------------------------------------------------------------

/**
 * Returns elements whose trimmed text content exactly matches `text`
 * (case-insensitive).
 */
function findElementsByExactText(text, selector = '*') {
  const lower = text.toLowerCase();
  const results = [];
  for (const el of document.querySelectorAll(selector)) {
    if (el.textContent.trim().toLowerCase() === lower) results.push(el);
  }
  return results;
}

/**
 * Collect both native and Bolt checkboxes from an element.
 * Bolt checkboxes are div[role="checkbox"], native are input[type="checkbox"].
 */
function collectCheckboxes(container) {
  return [
    ...container.querySelectorAll('[role="checkbox"]'),
    ...container.querySelectorAll('input[type="checkbox"]'),
  ];
}

/**
 * Returns true if a checkbox element is checked.
 * Handles both native inputs and Bolt [role="checkbox"] divs.
 */
function isChecked(el) {
  return el.tagName === 'INPUT'
    ? el.checked
    : el.getAttribute('aria-checked') === 'true';
}

/**
 * Returns true if a checkbox element is disabled.
 */
function isDisabled(el) {
  return el.tagName === 'INPUT'
    ? el.disabled
    : el.getAttribute('aria-disabled') === 'true';
}

/**
 * Given a scope name, finds the container element that wraps both the label
 * and its associated permission checkboxes.
 *
 * Supports the real ADO Bolt dialog structure:
 *   <div class="groupingContainer-*">
 *     <span class="groupingTitle-*">Scope Name</span>
 *     <div class="checkboxContainer-*">
 *       <div role="checkbox" ...>  ← Bolt checkbox, NOT input[type=checkbox]
 *
 * Returns { container, checkboxes } or null if not found.
 */
function findScopeContainer(scopeName) {
  const lower = scopeName.toLowerCase();

  // Primary: Bolt groupingTitle spans (class*="groupingTitle")
  for (const titleEl of document.querySelectorAll('[class*="groupingTitle"]')) {
    if (titleEl.textContent.trim().toLowerCase() === lower) {
      const container = titleEl.closest('[class*="groupingContainer"]');
      if (container) {
        const checkboxes = collectCheckboxes(container);
        if (checkboxes.length > 0) return { container, checkboxes };
      }
    }
  }

  // Fallback: any element with exact text match, walk up to find checkboxes
  const candidates = findElementsByExactText(
    scopeName,
    'td, th, div, span, label, strong, h3, h4, p, li, dt'
  );

  for (const candidate of candidates) {
    let el = candidate.parentElement;
    for (let depth = 0; depth < 12 && el && el !== document.body; depth++) {
      const checkboxes = collectCheckboxes(el);
      if (checkboxes.length > 0) return { container: el, checkboxes };
      el = el.parentElement;
    }
  }

  // Fallback: text-node walker (catches text that spans multiple elements)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent.trim().toLowerCase() === lower) {
      let el = node.parentElement;
      for (let depth = 0; depth < 12 && el && el !== document.body; depth++) {
        const checkboxes = collectCheckboxes(el);
        if (checkboxes.length > 0) return { container: el, checkboxes };
        el = el.parentElement;
      }
    }
  }

  return null;
}

/**
 * Checks all enabled, unchecked checkboxes inside the given scope section.
 * Handles both native input[type=checkbox] and Bolt [role=checkbox] divs.
 * Returns true if the section was found, false otherwise.
 */
async function checkAllPermissionsForScope(scope) {
  for (const name of scope.names) {
    const result = findScopeContainer(name);
    if (result) {
      const { checkboxes } = result;
      log(`  "${name}": found ${checkboxes.length} checkbox(es)`);
      for (const cb of checkboxes) {
        if (!isChecked(cb) && !isDisabled(cb)) {
          cb.click();
          await sleep(80);
        }
      }
      return true;
    }
  }
  warn(`Could not find scope section for: "${scope.names[0]}"`);
  return false;
}

// ---------------------------------------------------------------------------
// Status channel back to popup
// ---------------------------------------------------------------------------
function sendStatus(status, message, progress = null, data = null) {
  try {
    chrome.runtime.sendMessage({ type: 'status', status, message, progress, data });
  } catch { /* popup closed */ }
}

/**
 * After clicking "Create", ADO shows a success dialog containing the
 * newly-generated token value in a readonly input.  We wait for that
 * input to appear and read its value.
 *
 * Strategy order (most → least specific):
 *  1. Inputs inside success-labelled containers (class*="success", etc.)
 *  2. Readonly/disabled inputs adjacent to a "Copy" button
 *  3. Any input with a token-related aria-label
 *  4. Any readonly/disabled input whose value looks like a PAT
 *     (prefer pure-alphanumeric ADO PAT format; fall back to base64url)
 */
async function captureCreatedTokenValue() {
  const tryFind = () => {
    // ── 1. Success container ────────────────────────────────────────────
    for (const container of document.querySelectorAll(
      '[class*="success" i], [class*="pat-token" i], [class*="patToken" i], [class*="tokenValue" i]'
    )) {
      for (const el of container.querySelectorAll('input')) {
        const val = (el.value || '').trim();
        if (val.length >= 30) return val;
      }
    }

    // ── 2. Readonly input near a "Copy" button ──────────────────────────
    for (const btn of document.querySelectorAll('button, [role="button"]')) {
      const label = (btn.textContent || '') + (btn.getAttribute('aria-label') || '');
      if (!/\bcopy\b/i.test(label)) continue;

      // Check siblings and parent container for a readonly input
      for (const scope of [btn.parentElement, btn.parentElement?.parentElement]) {
        if (!scope) continue;
        for (const inp of scope.querySelectorAll('input')) {
          const val = (inp.value || '').trim();
          if (val.length >= 30) return val;
        }
      }
    }

    // ── 3. Input with token-related aria-label ──────────────────────────
    for (const el of document.querySelectorAll(
      'input[aria-label*="token" i], input[aria-label*="personal access" i], input[aria-label*="pat" i]'
    )) {
      const val = (el.value || '').trim();
      if (val.length >= 30) return val;
    }

    // ── 4. Any readonly/disabled input ─────────────────────────────────
    // Prefer pure alphanumeric (classic ADO PAT format — no dashes or underscores),
    // which avoids picking up CSRF/session tokens that use base64url encoding.
    for (const el of document.querySelectorAll('input[readonly], input[disabled]')) {
      const val = (el.value || '').trim();
      if (val.length >= 40 && /^[a-zA-Z0-9+/=]+$/.test(val)) return val;
    }
    // Broader fallback — accepts base64url chars as well
    for (const el of document.querySelectorAll('input[readonly], input[disabled]')) {
      const val = (el.value || '').trim();
      if (val.length >= 40 && /^[a-zA-Z0-9+/=_-]+$/.test(val)) return val;
    }

    return null;
  };

  try {
    return await waitFor(tryFind, 12000);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main automation
// ---------------------------------------------------------------------------
async function createToken(tokenName, selectedScopes = null) {
  try {
    // ── 0. Quick auth check ────────────────────────────────────────────
    const initialState = detectPageState();
    if (initialState === 'unauthenticated') {
      sendStatus(
        'auth',
        'You are not signed in. Please sign in to Azure DevOps first, then try again.'
      );
      return { success: false, error: 'unauthenticated' };
    }

    // ── 1. Wait for Angular app to bootstrap, then find "New Token" ───
    sendStatus('running', 'Waiting for the tokens page to load…', 5);
    log('Starting token creation, name:', tokenName);

    // Wait until at least one button exists (Angular bootstrap check)
    await waitFor(
      () => document.querySelectorAll('button').length > 0,
      15000
    );

    sendStatus('running', 'Looking for "New Token" button…', 10);
    const newTokenBtn = await waitFor(findNewTokenButton, 20000);

    log('Clicking "New Token"…');
    newTokenBtn.focus();
    newTokenBtn.click();

    // Wait for the panel / drawer to appear
    sendStatus('running', 'Opening "New Token" panel…', 15);
    await waitFor(
      () =>
        document.querySelector(
          '.ms-Panel, .bolt-panel, [role="dialog"], [role="complementary"]'
        ),
      12000
    );
    await sleep(200); // let the animation settle

    // ── 2. Fill token name ────────────────────────────────────────────
    sendStatus('running', 'Setting token name…', 20);

    const nameInput = await waitFor(findNameInput, 12000);
    log('Setting token name…');
    nameInput.focus();
    setInputValue(nameInput, tokenName);
    await sleep(150);

    // ── 3. Select "Custom defined" scopes (may already be pre-selected) ─
    sendStatus('running', 'Selecting "Custom defined" scopes…', 28);

    const customOption = await waitFor(findCustomDefinedOption, 12000);
    // Only click if not already checked (Bolt radio uses aria-checked)
    const alreadyChecked =
      customOption.getAttribute('aria-checked') === 'true' ||
      (customOption.tagName === 'INPUT' && customOption.checked);
    if (!alreadyChecked) {
      log('Clicking "Custom defined"…');
      customOption.click();
    } else {
      log('"Custom defined" already selected — skipping click');
    }

    // Wait for Bolt [role="checkbox"] elements to appear
    sendStatus('running', 'Waiting for scope list to load…', 33);
    await waitFor(
      () => document.querySelectorAll('[role="checkbox"]').length > 2,
      12000
    );
    await sleep(100);

    // ── 3b. Expand hidden scopes via "Show all scopes" link ───────────
    sendStatus('running', 'Expanding all scopes…', 36);
    const showAllBtn = findShowAllScopesButton();
    if (showAllBtn) {
      log('Clicking "Show all scopes"…');
      showAllBtn.click();
      // Wait for the button to disappear — Bolt removes/hides it once expanded.
      // This is more reliable than counting checkboxes (Bolt may just toggle visibility).
      await waitFor(
        () => !findShowAllScopesButton(),
        3000
      ).catch(() => log('"Show all scopes" button still present — continuing anyway'));
      await sleep(80);
    } else {
      log('No "Show all scopes" button found — all scopes may already be visible');
    }

    // ── 4. Check all scope permissions ────────────────────────────────
    // Only check the scopes the user selected (or all if none were excluded)
    const scopesToProcess = selectedScopes
      ? REQUIRED_SCOPES.filter((s) => selectedScopes.some((sel) => s.names.includes(sel)))
      : REQUIRED_SCOPES;

    let successCount = 0;
    const failed = [];

    for (let i = 0; i < scopesToProcess.length; i++) {
      const scope = scopesToProcess[i];
      const progress = 35 + Math.round(((i + 1) / scopesToProcess.length) * 55);

      sendStatus(
        'running',
        `Checking: ${scope.names[0]} (${i + 1}/${scopesToProcess.length})`,
        progress
      );

      const found = await checkAllPermissionsForScope(scope);
      if (found) successCount++;
      else failed.push(scope.names[0]);

      await sleep(50);
    }

    // ── 5. Click "Create" ──────────────────────────────────────────────
    log(`Done. ${successCount} scopes checked, ${failed.length} not found.`);

    if (failed.length > 0) {
      warn('Scopes not found:', failed.join(', '));
      sendStatus(
        'warning',
        `${successCount} scopes checked. Could not find: ${failed.join(', ')}. Please check those manually before creating.`,
        95
      );
      // Give the user a moment to see the warning, then still submit
      await sleep(2000);
    }

    sendStatus('running', 'Clicking "Create"…', 97);

    // The Create button starts disabled and becomes enabled once the form is
    // valid. It is a [role="button"] with class "primary" inside the panel footer.
    const createBtn = await waitFor(() => {
      for (const el of document.querySelectorAll(
        '[role="button"], button'
      )) {
        const text = el.textContent.trim();
        // Use word-boundary match so minor whitespace or icon text doesn't break it
        if (!/\bcreate\b/i.test(text)) continue;
        // Must not be disabled
        if (
          el.getAttribute('aria-disabled') === 'true' ||
          el.classList.contains('disabled') ||
          el.disabled
        ) continue;
        return el;
      }
      return null;
    }, 10000);

    log('Clicking "Create"…');
    createBtn.click();

    // ── 6. Capture the generated token value from the success dialog ──
    sendStatus('running', 'Waiting for token value…', 98);
    const tokenValue = await captureCreatedTokenValue();

    // Save to local storage for the popup to access on next open
    if (tokenValue) {
      try {
        const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 1 week
        await chrome.storage.local.set({
          pat_token_data: { value: tokenValue, expiresAt },
        });
        log('Token saved to storage.');
      } catch (e) {
        warn('Could not save token to storage:', e);
      }
    }

    sendStatus('token_ready', 'Token created successfully!', 100, { tokenValue });
    return { success: true, successCount, failed };
  } catch (err) {
    warn('Error:', err);

    // Give a smarter error message on timeout
    let message = err.message;
    if (/timeout/i.test(message)) {
      const state = detectPageState();
      if (state === 'unauthenticated') {
        message =
          'You do not appear to be signed in. Please sign in to Azure DevOps and reload the page, then try again.';
        sendStatus('auth', message);
        return { success: false, error: message };
      }
      message =
        'Timed out waiting for a page element. Make sure the Azure DevOps tokens page is fully loaded and you are signed in, then try again.';
    }

    sendStatus('error', message);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'checkState') {
    sendResponse({ state: detectPageState() });
    return false;
  }

  if (message.action === 'createToken') {
    createToken(message.tokenName, message.selectedScopes || null)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }
});
