// HRW MFA Autofill — Background Service Worker v1.6
//
// ROOT CAUSE FIX: MV3 service workers are killed after ~30s inactivity.
// All in-memory state (_session) was lost on restart → appeared as spontaneous lock.
//
// SOLUTION: chrome.storage.session (MV3 only)
//   - Cleared when the browser closes (true "browser session" scope)
//   - Persists across service worker restarts within the same browser session
//   - Never written to disk (unlike chrome.storage.local)
//   - Plaintext credentials stored here are safe: same security boundary as memory
//
// For timed sessions: expiry timestamp stored alongside credentials.
// On each GET_CREDENTIALS: check timestamp, clear if expired.
'use strict';

const SESSION_KEY = 'hrw_active_session';

// ── Helpers ───────────────────────────────────────────────────
function sessionGet() {
  return new Promise(r =>
    chrome.storage.session.get(SESSION_KEY, d => r(d[SESSION_KEY] || null))
  );
}
function sessionSet(data) {
  return new Promise(r =>
    chrome.storage.session.set({ [SESSION_KEY]: data }, r)
  );
}
function sessionClear() {
  return new Promise(r =>
    chrome.storage.session.remove(SESSION_KEY, r)
  );
}

// ── Message handler ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // P5 FIX: reject messages not from this extension
  if (sender.id !== chrome.runtime.id) return false;

  if (msg.type === 'GET_CREDENTIALS') {
    sessionGet().then(session => {
      if (!session) { sendResponse({ error: 'locked' }); return; }
      // Check expiry (0 = browser-session = no expiry)
      if (session.expiresAt && Date.now() > session.expiresAt) {
        sessionClear();
        sendResponse({ error: 'locked' });
        return;
      }
      // Extend on use
      if (session.expiresAt) {
        session.expiresAt = Date.now() + session.timeoutMs;
        sessionSet(session);
      }
      sendResponse({
        username:      session.username,
        password:      session.password,
        totp_secret:   session.totp_secret,
        hrw_autofill:  session.autofill,
        hrw_autologin: session.autologin,
      });
    });
    return true;
  }

  if (msg.type === 'SET_SESSION') {
    const timeoutMs   = msg.timeoutMinutes > 0 ? msg.timeoutMinutes * 60_000 : 0;
    const session = {
      username:    msg.username,
      password:    msg.password,
      totp_secret: msg.totp_secret,
      autofill:    msg.autofill,
      autologin:   msg.autologin,
      timeoutMs,
      expiresAt:   timeoutMs > 0 ? Date.now() + timeoutMs : 0,
    };
    sessionSet(session).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'UPDATE_OPTIONS') {
    sessionGet().then(session => {
      if (!session) { sendResponse({ ok: false }); return; }
      session.autofill  = msg.autofill;
      session.autologin = msg.autologin;
      if (msg.timeoutMinutes !== undefined) {
        session.timeoutMs = msg.timeoutMinutes > 0 ? msg.timeoutMinutes * 60_000 : 0;
        session.expiresAt = session.timeoutMs > 0 ? Date.now() + session.timeoutMs : 0;
      }
      sessionSet(session).then(() => sendResponse({ ok: true }));
    });
    return true;
  }

  if (msg.type === 'LOCK') {
    sessionClear().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    sessionGet().then(session => {
      if (!session) { sendResponse({ locked: true }); return; }
      if (session.expiresAt && Date.now() > session.expiresAt) {
        sessionClear();
        sendResponse({ locked: true });
        return;
      }
      const remainingMs = session.expiresAt > 0 ? session.expiresAt - Date.now() : -1;
      sendResponse({ locked: false, remainingMs });
    });
    return true;
  }

  if (msg.type === 'TRIGGER_AUTOFILL') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'AUTOFILL_NOW' }, () => {
          void chrome.runtime.lastError;
        });
      }
    });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// ── Install / update ──────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') console.log('[HRW MFA] Installed v1.6');
  if (reason === 'update') {
    // Remove any legacy plaintext keys from pre-v1.4
    chrome.storage.local.get(null, all => {
      const legacy = ['hrw_password', 'hrw_totp_secret'].filter(k => k in all);
      if (legacy.length) chrome.storage.local.remove(legacy);
    });
  }
});
