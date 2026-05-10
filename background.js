// HRW MFA Autofill — Background Script v1.6.8 (Firefox MV2)
// Differences from Edge/Chrome MV3 version:
//   - No service_worker — runs as background page (persistent: false)
//   - chrome.storage.session polyfilled via lib/compat.js
//   - chrome.runtime.getContexts() not available in MV2 — removed
//   - Sender validation uses chrome.runtime.id (same as MV3)
'use strict';

const SESSION_KEY = 'hrw_active_session';

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) return false;

  if (msg.type === 'GET_CREDENTIALS') {
    sessionGet().then(session => {
      if (!session) { sendResponse({ error: 'locked' }); return; }
      if (session.expiresAt && Date.now() > session.expiresAt) {
        sessionClear();
        sendResponse({ error: 'locked' });
        return;
      }
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
    const timeoutMs = msg.timeoutMinutes > 0 ? msg.timeoutMinutes * 60_000 : 0;
    sessionSet({
      username:    msg.username,
      password:    msg.password,
      totp_secret: msg.totp_secret,
      autofill:    msg.autofill,
      autologin:   msg.autologin,
      timeoutMs,
      expiresAt:   timeoutMs > 0 ? Date.now() + timeoutMs : 0,
    }).then(() => sendResponse({ ok: true }));
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
      sendResponse({
        locked: false,
        remainingMs: session.expiresAt > 0 ? session.expiresAt - Date.now() : -1,
      });
    });
    return true;
  }

  if (msg.type === 'TRIGGER_AUTOFILL') {
    // MV2: use chrome.tabs.query + sendMessage
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

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') console.log('[HRW MFA] Firefox install v1.6.8');
  if (reason === 'update') {
    chrome.storage.local.get(null, all => {
      const legacy = ['hrw_password', 'hrw_totp_secret'].filter(k => k in all);
      if (legacy.length) chrome.storage.local.remove(legacy);
    });
  }
});
