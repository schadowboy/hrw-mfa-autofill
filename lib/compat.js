// HRW MFA Autofill — Browser Compatibility Shim
// Polyfills chrome.storage.session (MV3/Chrome only) for Firefox MV2.
// Firefox has no storage.session → we emulate it using an in-memory Map
// inside the background page (persistent: false but kept alive while popup is open).
// Security note: equivalent to chrome.storage.session — no disk write,
// cleared when the background page is unloaded (browser close / idle eviction).
'use strict';

// ── chrome.* alias ────────────────────────────────────────────
// Firefox supports both browser.* (Promise) and chrome.* (callback) APIs.
// Our code uses chrome.* callbacks throughout — no changes needed.

// ── chrome.storage.session polyfill ──────────────────────────
if (typeof chrome !== 'undefined' && chrome.storage && !chrome.storage.session) {
  const _sessionMap = new Map();

  chrome.storage.session = {
    get(key, callback) {
      const result = {};
      if (typeof key === 'string') {
        if (_sessionMap.has(key)) result[key] = _sessionMap.get(key);
      } else if (Array.isArray(key)) {
        key.forEach(k => { if (_sessionMap.has(k)) result[k] = _sessionMap.get(k); });
      } else {
        _sessionMap.forEach((v, k) => { result[k] = v; });
      }
      if (callback) callback(result);
      return Promise.resolve(result);
    },

    set(items, callback) {
      Object.entries(items).forEach(([k, v]) => _sessionMap.set(k, v));
      if (callback) callback();
      return Promise.resolve();
    },

    remove(key, callback) {
      const keys = typeof key === 'string' ? [key] : key;
      keys.forEach(k => _sessionMap.delete(k));
      if (callback) callback();
      return Promise.resolve();
    },

    clear(callback) {
      _sessionMap.clear();
      if (callback) callback();
      return Promise.resolve();
    }
  };
}
