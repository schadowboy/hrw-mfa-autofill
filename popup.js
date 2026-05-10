// HRW MFA Autofill — Popup Script v1.6
'use strict';

const $ = id => document.getElementById(id);

let totpInterval    = null;
let sessionInterval = null;

// ── Theme ─────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('hrw_theme') || 'system';
  applyTheme(saved);
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeVal === saved);
    btn.addEventListener('click', () => {
      const t = btn.dataset.themeVal;
      localStorage.setItem('hrw_theme', t);
      applyTheme(t);
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.themeVal === t));
    });
  });
})();

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// ── Boot ─────────────────────────────────────────────────────
checkExistingSession();

async function checkExistingSession() {
  const status = await msg({ type: 'GET_STATUS' });
  if (status && !status.locked) {
    const creds = await msg({ type: 'GET_CREDENTIALS' });
    if (creds && !creds.error) { await openMainUI(creds); return; }
  }
  initPinOverlay();
}

// ── PIN Overlay ───────────────────────────────────────────────
async function initPinOverlay() {
  const hasPinStored = await checkPinExists();
  renderPinUI(hasPinStored ? 'unlock' : 'setup');
  $('pinSubmitBtn').addEventListener('click', handlePinSubmit);
  $('pinInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') handlePinSubmit();
    $('pinError').textContent = '';
  });
  setTimeout(() => $('pinInput').focus(), 50);
}

async function checkPinExists() {
  const d = await new Promise(r => chrome.storage.local.get('hrw_pin_probe', r));
  return !!d.hrw_pin_probe;
}

function renderPinUI(mode) {
  $('pinSubmitBtn').dataset.mode = mode;
  const cfg = {
    setup:  { heading: 'PIN festlegen',    desc: 'Lege einen PIN fest (mind. 4 Zeichen). Er schützt deine Zugangsdaten mit AES-256-GCM.', ph: 'Neuen PIN wählen', btn: 'Festlegen & starten', hint: '[ ! ] Dieser PIN kann nicht wiederhergestellt werden!' },
    unlock: { heading: 'PIN eingeben',     desc: 'Gib deinen PIN ein, um auf deine verschlüsselten Zugangsdaten zuzugreifen.',             ph: '••••••',           btn: 'Entsperren',          hint: '' },
    change: { heading: 'Neuen PIN wählen', desc: 'Wähle einen neuen PIN. Alle gespeicherten Credentials werden neu verschlüsselt.',         ph: 'Neuer PIN',        btn: 'PIN ändern',          hint: '[ ! ] Du musst danach deine Daten erneut speichern.' },
  };
  const c = cfg[mode] || cfg.unlock;
  $('pinHeading').textContent   = c.heading;
  $('pinDesc').textContent      = c.desc;
  $('pinInput').placeholder     = c.ph;
  $('pinSubmitBtn').textContent = c.btn;
  $('pinHint').textContent      = c.hint;
  $('pinInput').value = '';
  $('pinError').textContent = '';
}

async function handlePinSubmit() {
  const pin  = $('pinInput').value;
  const mode = $('pinSubmitBtn').dataset.mode;

  if (pin.length < 4) { $('pinError').textContent = 'Mindestens 4 Zeichen.'; return; }

  $('pinSubmitBtn').disabled    = true;
  $('pinSubmitBtn').textContent = '…';

  try {
    if (mode === 'setup' || mode === 'change') {
      if (mode === 'change') {
        await new Promise(r => chrome.storage.local.remove(['hrw_pin_probe','hrw_enc_password','hrw_enc_totp_secret'], r));
      }
      await HRWCrypto.setPin(pin);
      // Set an empty session so background is unlocked and saveCredentials works immediately
      const emptyTimeout = await getTimeoutSetting();
      await msg({ type: 'SET_SESSION',
        username: '', password: '', totp_secret: '',
        autofill: false, autologin: false,
        timeoutMinutes: emptyTimeout });
      await openMainUI({ username:'', password:'', totp_secret:'', hrw_autofill:false, hrw_autologin:false });

    } else {
      const ok = await HRWCrypto.verifyPin(pin);
      if (!ok) {
        $('pinError').textContent = 'Falscher PIN.';
        $('pinInput').value = '';
        $('pinInput').focus();
        return;
      }

      const data = await new Promise(r =>
        chrome.storage.local.get(['hrw_username','hrw_enc_password','hrw_enc_totp_secret','hrw_autofill','hrw_autologin'], r)
      );
      const password    = data.hrw_enc_password    ? await HRWCrypto.decrypt(pin, data.hrw_enc_password)    : '';
      const totp_secret = data.hrw_enc_totp_secret ? await HRWCrypto.decrypt(pin, data.hrw_enc_totp_secret) : '';

      const creds = {
        username: data.hrw_username || '', password, totp_secret,
        hrw_autofill: data.hrw_autofill === true, hrw_autologin: !!data.hrw_autologin,
      };

      // Store decrypted session in background (chrome.storage.session — survives SW restart)
      const timeoutMinutes = await getTimeoutSetting();
      await msg({
        type: 'SET_SESSION',
        username:      creds.username,
        password:      creds.password,
        totp_secret:   creds.totp_secret,
        autofill:      creds.hrw_autofill,   // background expects no hrw_ prefix
        autologin:     creds.hrw_autologin,
        timeoutMinutes,
      });
      await msg({ type: 'TRIGGER_AUTOFILL' });
      await openMainUI(creds);
    }
  } catch (e) {
    $('pinError').textContent = '[ ✕ ] ' + e.message;
  } finally {
    $('pinSubmitBtn').disabled = false;
    const labels = { setup: 'Festlegen & starten', unlock: 'Entsperren', change: 'PIN ändern' };
    $('pinSubmitBtn').textContent = labels[mode] || 'OK';
  }
}

// ── Main UI ───────────────────────────────────────────────────
async function openMainUI(creds) {
  $('pinOverlay').style.display = 'none';
  $('mainUI').style.display     = 'block';
  updateStatusBar();
  setupTabs();
  populateFields(creds);
  setupHandlers();
  if (creds.totp_secret) startTOTPDisplay(creds.totp_secret);
  sessionInterval = setInterval(updateStatusBar, 15_000);
}

async function updateStatusBar() {
  const status = await msg({ type: 'GET_STATUS' });
  if (!status || status.locked) {
    $('statusDot').classList.remove('active');
    $('statusBarText').textContent = 'Gesperrt';
    return;
  }
  $('statusDot').classList.add('active');
  if (status.remainingMs < 0) {
    $('statusBarText').textContent = 'Entsperrt · Browser-Session';
  } else {
    const mins = Math.ceil(status.remainingMs / 60_000);
    $('statusBarText').textContent = `Entsperrt · ${mins} Min. verbleibend`;
  }
}

function populateFields(creds) {
  $('username').value    = creds.username    || '';
  $('password').value    = creds.password    || '';
  $('totpSecret').value  = creds.totp_secret || '';
  $('autofill').checked  = !!creds.hrw_autofill;
  $('autologin').checked = !!creds.hrw_autologin;
  // Apply autologin dependency after values are set
  if (window._syncAutologinState) window._syncAutologinState();
  getTimeoutSetting().then(t => {
    $('sessionTimeout').value = String(t);
    updateSecTimeoutLabel(t);
  });
}

function updateSecTimeoutLabel(minutes) {
  const el = $('secTimeoutLabel');
  if (!el) return;
  el.textContent = minutes === 0 ? 'Browser-Session' : minutes < 60 ? `${minutes} Min.` : `${minutes/60} Std.`;
}

// ── Handlers ─────────────────────────────────────────────────
function setupHandlers() {
  $('saveBtn').addEventListener('click', saveCredentials);
  $('saveBtnQuick').addEventListener('click', saveOptions);
  $('togglePw').addEventListener('click', () => toggleVis('password','togglePw'));
  $('toggleSecret').addEventListener('click', () => toggleVis('totpSecret','toggleSecret'));
  $('copyBtn').addEventListener('click', copyTOTP);

  // FIX: Immediately push toggle changes to background session
  // FIX: autologin depends on autofill — disable it when autofill is off
  window._syncAutologinState = syncAutologinState; // expose for populateFields
  function syncAutologinState() {
    const af = $('autofill').checked;
    $('autologin').disabled = !af;
    $('autologin').closest('.toggle-row').style.opacity = af ? '1' : '0.4';
    if (!af) $('autologin').checked = false;
  }

  $('autofill').addEventListener('change', async () => {
    syncAutologinState();
    await saveOptionsImmediate();
  });
  $('autologin').addEventListener('change', async () => {
    await saveOptionsImmediate();
  });

  syncAutologinState(); // set initial state on open

  $('totpSecret').addEventListener('input', () => {
    const val = $('totpSecret').value.trim().replace(/\s/g,'').toUpperCase();
    val.length >= 16 ? startTOTPDisplay(val) : stopTOTPDisplay();
  });

  $('sessionTimeout').addEventListener('change', async () => {
    const minutes = parseInt($('sessionTimeout').value, 10);
    await chrome.storage.local.set({ hrw_session_timeout: minutes });
    await msg({ type: 'UPDATE_OPTIONS', autofill: $('autofill').checked, autologin: $('autologin').checked, timeoutMinutes: minutes });
    updateSecTimeoutLabel(minutes);
    showStatus('statusMsgQuick', `[ ✓ ] Timeout: ${minutes === 0 ? 'Browser-Session' : minutes + ' Min.'}`);
  });

  $('lockBtn').addEventListener('click', doLock);
  $('changePinBtn').addEventListener('click', doLock.bind(null, 'change'));
  $('clearDataBtn').addEventListener('click', async () => {
    // P4 FIX: inline confirmation instead of blocking confirm() dialog
    const confirmed = await showInlineConfirm(
      $('clearDataBtn'),
      'Wirklich alle Daten löschen? (Nicht rückgängig)'
    );
    if (!confirmed) return;
    await msg({ type: 'LOCK' });
    await new Promise(r => chrome.storage.local.clear(r));
    doLock('setup');
  });
}

async function doLock(nextMode = 'unlock') {
  clearInterval(sessionInterval);
  stopTOTPDisplay();
  await msg({ type: 'LOCK' });
  $('mainUI').style.display     = 'none';
  $('pinOverlay').style.display = 'block';
  $('statusDot').classList.remove('active');
  $('statusBarText').textContent = 'Gesperrt';
  renderPinUI(nextMode);
  setTimeout(() => $('pinInput').focus(), 50);
}

function toggleVis(inputId, btnId) {
  const el = $(inputId);
  const hide = el.type === 'password';
  el.type = hide ? 'text' : 'password';
  $(btnId).textContent = hide ? 'verbergen' : 'anzeigen';
}

// Save credentials — re-encrypt using stored PIN probe validation
// Uses a two-field PIN confirm UI instead of prompt()
async function saveCredentials() {
  const pw     = $('password').value;
  const secret = $('totpSecret').value.trim().replace(/\s/g,'').toUpperCase();

  if (secret && !/^[A-Z2-7=]+$/.test(secret)) {
    showStatus('statusMsg','[ ✕ ] Ungültiger TOTP-Schlüssel (Base32)',true); return;
  }

  // Check session still valid
  const sessionCreds = await msg({ type: 'GET_CREDENTIALS' });
  if (!sessionCreds || sessionCreds.error) {
    showStatus('statusMsg','[ ✕ ] Session abgelaufen — bitte erneut entsperren',true); return;
  }

  // Inline PIN confirm (no prompt())
  const pin = await showPinConfirmInline();
  if (!pin) return;

  const ok = await HRWCrypto.verifyPin(pin);
  if (!ok) { showStatus('statusMsg','[ ✕ ] Falscher PIN',true); return; }

  $('saveBtn').disabled = true; $('saveBtn').textContent = 'Verschlüssele…';
  try {
    const toStore = { hrw_username: $('username').value.trim() };
    if (pw)     toStore.hrw_enc_password    = await HRWCrypto.encrypt(pin, pw);
    if (secret) toStore.hrw_enc_totp_secret = await HRWCrypto.encrypt(pin, secret);
    await new Promise(r => chrome.storage.local.remove(['hrw_password','hrw_totp_secret'], r));
    await new Promise(r => chrome.storage.local.set(toStore, r));

    const timeout = await getTimeoutSetting();
    await msg({ type: 'SET_SESSION',
      username:      $('username').value.trim(),
      password:      pw,
      totp_secret:   secret,
      autofill:      $('autofill').checked,    // background expects no hrw_ prefix
      autologin:     $('autologin').checked,
      timeoutMinutes: timeout });

    if (secret) startTOTPDisplay(secret);
    showStatus('statusMsg','[ ✓ ] Verschlüsselt gespeichert');
  } catch(e) {
    showStatus('statusMsg','[ ✕ ] ' + e.message, true);
  } finally {
    $('saveBtn').disabled = false; $('saveBtn').textContent = 'Verschlüsselt speichern';
  }
}

// Inline PIN confirmation: replaces the save button area temporarily
function showPinConfirmInline() {
  return new Promise(resolve => {
    const area = $('saveBtn').parentElement;
    const orig = $('saveBtn').outerHTML + ($('statusMsg').outerHTML || '');

    // createElement — no innerHTML with variables
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;gap:8px;margin-top:12px';

    const input = document.createElement('input');
    Object.assign(input, { id: 'pinConfirmInput', type: 'password', placeholder: 'PIN bestätigen', maxLength: 64 });
    input.style.cssText = 'flex:1;padding:9px 11px;border:1.5px solid var(--hrw-cyan);border-radius:4px;background:var(--input-bg);color:var(--text);font-size:13px;outline:none;';

    const okBtn = document.createElement('button');
    okBtn.id = 'pinConfirmOk';
    okBtn.textContent = 'OK';
    okBtn.style.cssText = 'padding:9px 14px;background:var(--hrw-cyan);border:none;border-radius:4px;color:#fff;font-weight:700;cursor:pointer;';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'pinConfirmCancel';
    cancelBtn.textContent = '✕';
    cancelBtn.style.cssText = 'padding:9px 10px;background:var(--bg);border:1.5px solid var(--border);border-radius:4px;color:var(--text-2);cursor:pointer;';

    wrapper.appendChild(input);
    wrapper.appendChild(okBtn);
    wrapper.appendChild(cancelBtn);

    $('saveBtn').replaceWith(wrapper);
    $('statusMsg') && $('statusMsg').remove();

    // Use the already-declared `input`, `okBtn`, `cancelBtn` — no re-declaration
    function restore(value) {
      wrapper.outerHTML = orig;
      resolve(value);
    }

    setTimeout(() => input.focus(), 30);
    okBtn.addEventListener('click', () => restore(input.value));
    cancelBtn.addEventListener('click', () => restore(null));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') restore(input.value); if (e.key === 'Escape') restore(null); });
  });
}

async function saveOptionsImmediate() {
  const autofill  = $('autofill').checked;
  const autologin = autofill ? $('autologin').checked : false;
  await new Promise(r => chrome.storage.local.set({ hrw_autofill: autofill, hrw_autologin: autologin }, r));
  await msg({ type: 'UPDATE_OPTIONS', autofill, autologin });
}

async function saveOptions() {
  const autofill  = $('autofill').checked;
  const autologin = $('autologin').checked;
  await new Promise(r => chrome.storage.local.set({ hrw_autofill: autofill, hrw_autologin: autologin }, r));
  await msg({ type: 'UPDATE_OPTIONS', autofill, autologin });
  showStatus('statusMsgQuick','Gespeichert');
}

// ── TOTP Display ──────────────────────────────────────────────
function startTOTPDisplay(secret) {
  stopTOTPDisplay();
  $('copyBtn').style.display = 'block';
  async function tick() {
    try {
      const code = await TOTP.generate(secret);
      const rem  = TOTP.getRemainingSeconds();
      const el   = $('totpDisplay');
      el.textContent = code.replace(/(\d{3})(\d{3})/, '$1 $2');
      el.className   = 'totp-code' + (rem <= 5 ? ' danger' : rem <= 10 ? ' warn' : '');
      $('timerFill').style.width      = (rem / 30 * 100) + '%';
      $('timerFill').style.background = rem <= 5 ? 'var(--danger)' : rem <= 10 ? 'var(--warn)' : 'var(--hrw-cyan)';
      $('timerText').textContent      = `${rem}s bis zum nächsten Code`;
    } catch {
      $('totpDisplay').className = 'totp-code empty';
      $('totpDisplay').textContent = '– Fehler –';
    }
  }
  tick(); totpInterval = setInterval(tick, 1000);
}

function stopTOTPDisplay() {
  if (totpInterval) { clearInterval(totpInterval); totpInterval = null; }
  $('totpDisplay').className   = 'totp-code empty';
  $('totpDisplay').textContent = '– – – – – –';
  $('copyBtn').style.display   = 'none';
  $('timerFill').style.width   = '0%';
  $('timerText').textContent   = '';
}

function copyTOTP() {
  const raw = $('totpDisplay').textContent.replace(/\s/g,'');
  if (!raw || raw.includes('–')) return;
  navigator.clipboard.writeText(raw).then(() => {
    $('copyBtn').textContent = 'Kopiert';
    $('copyBtn').classList.add('copied');
    setTimeout(() => { $('copyBtn').textContent = 'Kopieren'; $('copyBtn').classList.remove('copied'); }, 2000);
  });
}

// ── Tabs ──────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $('tab-' + tab.dataset.tab).classList.add('active');
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────
// Inline two-button confirm — replaces trigger button, uses createElement (no innerHTML)
function showInlineConfirm(triggerBtn, label) {
  return new Promise(resolve => {
    const orig = triggerBtn.outerHTML;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:6px;margin-top:0';

    const lbl = document.createElement('span');
    lbl.textContent = label; // textContent — no HTML parsing
    lbl.style.cssText = 'flex:1;font-size:11px;color:var(--danger);display:flex;align-items:center;padding:0 4px;line-height:1.3';

    const yes = document.createElement('button');
    yes.textContent = 'Ja';
    yes.style.cssText = 'padding:8px 12px;background:var(--danger);border:none;border-radius:4px;color:#fff;font-weight:700;font-size:12px;cursor:pointer';

    const no = document.createElement('button');
    no.textContent = 'Nein';
    no.style.cssText = 'padding:8px 10px;background:var(--bg);border:1.5px solid var(--border);border-radius:4px;color:var(--text-2);font-size:12px;cursor:pointer';

    wrap.appendChild(lbl);
    wrap.appendChild(yes);
    wrap.appendChild(no);
    triggerBtn.replaceWith(wrap);

    function restore(val) { wrap.outerHTML = orig; setupHandlers(); resolve(val); }
    yes.addEventListener('click', () => restore(true));
    no.addEventListener('click',  () => restore(false));
  });
}

function msg(payload) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(payload, response => {
      void chrome.runtime.lastError;
      resolve(response || null);
    });
  });
}

async function getTimeoutSetting() {
  const d = await new Promise(r => chrome.storage.local.get('hrw_session_timeout', r));
  return d.hrw_session_timeout ?? 60;
}

const STATUS_SVG_OK   = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>';
const STATUS_SVG_ERR  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

function showStatus(elId, text, isError = false) {
  const el = $(elId);
  if (!el) return;
  const clean = text.replace(/^\[ [✓✕!] \] /, '');
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
  el.style.display = 'flex'; el.style.gap = '5px'; el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  // P1 FIX: use createElement + textContent — never innerHTML with variable data
  el.innerHTML = ''; // clear
  const iconWrap = document.createElement('span');
  iconWrap.style.cssText = 'display:inline-flex;align-items:center;flex-shrink:0';
  iconWrap.innerHTML = isError ? STATUS_SVG_ERR : STATUS_SVG_OK; // literal SVG only
  const label = document.createElement('span');
  label.textContent = clean; // safe: textContent never parses HTML
  el.appendChild(iconWrap);
  el.appendChild(label);
  setTimeout(() => { if (el) { el.innerHTML = ''; el.style.display = ''; } }, 3500);
}
