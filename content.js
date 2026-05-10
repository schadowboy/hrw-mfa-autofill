// HRW MFA Autofill — Content Script v1.6.5
// Fix: TOAST_ICONS hoisted to top (was const after first use → temporal dead zone)
// Fix: autologin reads config.hrw_autologin correctly from background session
'use strict';

(async () => {
  const host   = window.location.hostname;
  const path   = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  // ── Trusted origins for auto-click ───────────────────────────
  const TRUSTED_ORIGINS = new Set([
    'https://sso.hs-rw.de',
    'https://dsf.hs-ruhrwest.de',
    'https://campusnet.hs-ruhrwest.de',
    'https://portal.hs-ruhrwest.de',
    'https://owa.hs-ruhrwest.de',
  ]);

  // ── Toast SVG icons — MUST be declared before any showToast call ──
  const TOAST_ICONS = {
    ok:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    err:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    wait: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    nav:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  };

  // ── Listen for AUTOFILL_NOW (sent by popup after PIN unlock) ──
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'AUTOFILL_NOW') {
      runAutofill();
      sendResponse({ ok: true });
    }
    return false;
  });

  // ── Initial run on page load ──────────────────────────────────
  await runAutofill();

  // ── Main autofill entry point ─────────────────────────────────
  async function runAutofill() {
    const config = await getCredentials();

    if (!config) {
      showToast('Bitte Addon-Popup öffnen & entsperren', true, true);
      return;
    }

    dismissToast();

    if (!config.hrw_autofill) return;

    if (host === 'sso.hs-rw.de') {
      const m = (params.get('execution') || '').match(/^e(\d+)s(\d+)$/);
      if (m) {
        if (parseInt(m[2], 10) === 1) await handleCredentials(config, 'shibboleth');
        if (parseInt(m[2], 10) === 2) await handleTOTP(config);
      }
      return;
    }

    if (host === 'portal.hs-ruhrwest.de') {
      if (path.includes('login_check'))                    await handleTOTP(config);
      else if (path.toLowerCase().includes('sitepages'))   await handleCredentials(config, 'portal');
      return;
    }

    if (host === 'owa.hs-ruhrwest.de')        { await handleCredentials(config, 'owa'); return; }
    if (host === 'campusnet.hs-ruhrwest.de')   { await handleCampusNetEntry(config);    return; }
    if (host === 'dsf.hs-ruhrwest.de')         { await handleDSFIdentityServer(config); return; }
  }

  // ── Credentials from background session ──────────────────────
  function getCredentials() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_CREDENTIALS' }, response => {
        void chrome.runtime.lastError;
        if (!response || response.error) { resolve(null); return; }
        resolve(response);
      });
    });
  }

  // ── TOTP ──────────────────────────────────────────────────────
  async function handleTOTP(config) {
    if (!config.totp_secret) {
      showToast('Kein TOTP-Schlüssel konfiguriert', true);
      return;
    }

    await waitForElement(
      'input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"], ' +
      'input[name*="token"], input[type="text"], input[type="number"], input[type="tel"]',
      5000
    ).catch(() => null);
    await sleep(300);

    const otpField =
      findField(['input[autocomplete="one-time-code"]', 'input[name*="otp"]',
                 'input[name*="code"]', 'input[name*="token"]']) ||
      findOTPHeuristic();

    if (!otpField) return;

    try {
      const lastUsed   = await getLastUsedCounter();
      const period     = 30;
      const nowCounter = Math.floor(Date.now() / 1000 / period);

      if (lastUsed === nowCounter) {
        const secsLeft = period - (Math.floor(Date.now() / 1000) % period);
        showToast(`Warte auf neuen Code… (${secsLeft}s)`, false, true);
        await waitForNextTOTPWindow();
      }

      const code      = await TOTP.generate(config.totp_secret);
      const remaining = TOTP.getRemainingSeconds();

      fillField(otpField, code);
      showToast(`MFA-Code eingetragen (${remaining}s verbleibend)`);

      if (config.hrw_autologin) {
        await sleep(350);
        const btn = getSubmitButton();
        if (btn) {
          await markCounterUsed(nowCounter);
          btn.click();
        } else {
          showToast('Submit-Button nicht gefunden — bitte manuell bestätigen', true);
        }
      }
    } catch (e) {
      showToast('TOTP-Fehler: ' + e.message, true);
    }
  }

  // ── Credentials ───────────────────────────────────────────────
  async function handleCredentials(config, context) {
    if (!config.username || !config.password) {
      showToast('Keine Zugangsdaten konfiguriert', true);
      return;
    }

    const userSelectors = {
      shibboleth: ['#username', 'input[name="j_username"]', 'input[name="username"]', 'input[type="text"]'],
      portal:     ['input[type="email"]', 'input[name*="user"]', 'input[name*="login"]', 'input[type="text"]'],
      owa:        ['#username', 'input[name="username"]', 'input[type="email"]', 'input[type="text"]'],
    };

    await waitForElement('input[type="password"]', 5000).catch(() => null);
    await sleep(300);

    const userField = findField(userSelectors[context] || userSelectors.shibboleth);
    const passField = findField(['#password', 'input[name="j_password"]', 'input[name="password"]', 'input[type="password"]']);
    if (!userField || !passField) return;

    fillField(userField, config.username);
    fillField(passField, config.password);

    const labels = {
      shibboleth: 'SSO-Login eingetragen',
      portal:     'Portal-Login eingetragen',
      owa:        'OWA-Login eingetragen',
    };
    showToast(labels[context] || 'Zugangsdaten eingetragen');

    if (config.hrw_autologin) {
      await sleep(350);
      const btn = getSubmitButton();
      if (btn) btn.click();
      else showToast('Submit-Button nicht gefunden — bitte manuell bestätigen', true);
    }
  }

  // ── CampusNet ─────────────────────────────────────────────────
  async function handleCampusNetEntry(config) {
    if (!config.hrw_autologin) return;
    await sleep(1000);
    const link = findTrustedLink(['IdentityServer/connect/authorize']);
    if (link) { showToast('CampusNet: Weiterleitung…'); await sleep(300); link.click(); }
  }

  // ── DSF ───────────────────────────────────────────────────────
  async function handleDSFIdentityServer(config) {
    if (!config.hrw_autologin) return;
    await sleep(600);
    if (window.location.pathname.includes('/Account/Login')) {
      const link = findTrustedLink(['External/Challenge?provider=hrwshib']);
      if (link) { showToast('Weiter zu HRW-Shibboleth…'); await sleep(300); link.click(); }
    }
  }

  // ── TOTP replay protection ────────────────────────────────────
  function getLastUsedCounter() {
    return new Promise(r =>
      chrome.storage.local.get('hrw_last_totp_counter', d => r(d.hrw_last_totp_counter ?? -1))
    );
  }
  function markCounterUsed(c) {
    return new Promise(r => chrome.storage.local.set({ hrw_last_totp_counter: c }, r));
  }
  function waitForNextTOTPWindow() {
    return new Promise(resolve => {
      const period = 30;
      function tick() {
        const s  = period - (Math.floor(Date.now() / 1000) % period);
        const el = document.getElementById('hrw-mfa-toast');
        const msg = document.querySelector('.hrw-toast-msg');
        if (msg) msg.textContent = `Warte auf neuen Code… (${s}s)`;
        s <= 1 ? setTimeout(resolve, 1200) : setTimeout(tick, 1000);
      }
      tick();
    });
  }

  // ── DOM helpers ───────────────────────────────────────────────
  function findField(selectors) {
    for (const s of selectors) { const el = document.querySelector(s); if (el) return el; }
    return null;
  }

  function findTrustedLink(fragments) {
    const links = Array.from(document.querySelectorAll('a[href]'));
    for (const frag of fragments) {
      const found = links.find(a => {
        try { const u = new URL(a.href); return TRUSTED_ORIGINS.has(u.origin) && a.href.includes(frag); }
        catch { return false; }
      });
      if (found) return found;
    }
    return null;
  }

  function findOTPHeuristic() {
    const inputs = Array.from(document.querySelectorAll(
      'input[type="text"], input[type="number"], input[type="tel"], input:not([type])'
    ));
    const byAttr = inputs.find(el =>
      /otp|code|token|mfa|2fa|auth|totp|pin|verify/.test(
        (el.name + el.id + el.placeholder + el.className).toLowerCase()
      )
    );
    if (byAttr) return byAttr;
    const byLen = inputs.find(el => el.maxLength === 6);
    if (byLen) return byLen;
    showToast('OTP-Feld nicht erkannt — bitte manuell eingeben', true);
    return null;
  }

  function fillField(el, value) {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (setter?.set) setter.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  function getSubmitButton() {
    return (
      document.querySelector('[name="_eventId_proceed"]') ||
      document.querySelector('button[type="submit"]')     ||
      document.querySelector('input[type="submit"]')      ||
      document.querySelector('.btn-primary')              ||
      document.querySelector('button.submit')
    );
  }

  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const f = document.querySelector(selector);
        if (f) { obs.disconnect(); resolve(f); }
      });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('Timeout')); }, timeout);
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Toast ─────────────────────────────────────────────────────
  function toastIcon(text, isError) {
    if (isError) return TOAST_ICONS.err;
    if (text.includes('…')) return TOAST_ICONS.wait;
    if (text.includes('Weiter') || text.includes('leitung')) return TOAST_ICONS.nav;
    return TOAST_ICONS.ok;
  }

  function showToast(text, isError = false, persist = false) {
    let toast = document.getElementById('hrw-mfa-toast');
    if (toast) {
      const msgEl = toast.querySelector('.hrw-toast-msg');
      if (msgEl) msgEl.textContent = text;
      return;
    }
    toast = document.createElement('div');
    toast.id = 'hrw-mfa-toast';

    const iconSpan = document.createElement('span');
    iconSpan.style.cssText = 'display:inline-flex;align-items:center;flex-shrink:0';
    iconSpan.innerHTML = toastIcon(text, isError); // literal SVG from const above

    const msgSpan = document.createElement('span');
    msgSpan.className = 'hrw-toast-msg';
    msgSpan.textContent = text; // textContent — no HTML parsing

    toast.appendChild(iconSpan);
    toast.appendChild(msgSpan);

    Object.assign(toast.style, {
      position: 'fixed', top: '16px', right: '16px', zIndex: '999999',
      background: '#1E1E1E',
      color: isError ? '#F08080' : '#E8EFF5',
      padding: '9px 14px', borderRadius: '4px',
      fontSize: '12px', fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      transition: 'opacity 0.3s', opacity: '1',
      border: `1px solid ${isError ? '#6B3030' : '#2E3F50'}`,
      display: 'flex', alignItems: 'center', gap: '8px',
      maxWidth: '300px', lineHeight: '1.4',
    });

    document.body.appendChild(toast);

    if (!persist) {
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
      }, 3500);
    }
  }

  function dismissToast() {
    const t = document.getElementById('hrw-mfa-toast');
    if (t) t.remove();
  }

})();
