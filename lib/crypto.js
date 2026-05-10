// HRW MFA Autofill — Crypto Module
// AES-256-GCM encryption + PBKDF2 key derivation (200k iterations, SHA-256)
// PIN-derived key encrypts password and TOTP secret before chrome.storage.local
// A verification token is stored to check PIN correctness without decrypting real secrets

'use strict';

const HRWCrypto = (() => {
  const PBKDF2_ITERATIONS = 200_000;
  const ENC = new TextEncoder();
  const DEC = new TextDecoder();

  // P2 FIX: random per-installation salt instead of static string.
  // Generated once on first use, stored in chrome.storage.local (not sensitive).
  // Eliminates precomputed-table attacks even when source code is known.
  async function getSalt() {
    const stored = await new Promise(r => chrome.storage.local.get('hrw_pbkdf2_salt', r));
    if (stored.hrw_pbkdf2_salt) return stored.hrw_pbkdf2_salt;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const salt  = btoa(String.fromCharCode(...bytes));
    await new Promise(r => chrome.storage.local.set({ hrw_pbkdf2_salt: salt }, r));
    return salt;
  }

  async function deriveKey(pin) {
    const salt = await getSalt();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', ENC.encode(pin), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: ENC.encode(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encrypt(pin, plaintext) {
    const key = await deriveKey(pin);
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ENC.encode(plaintext));
    return {
      iv:   btoa(String.fromCharCode(...iv)),
      data: btoa(String.fromCharCode(...new Uint8Array(enc))),
    };
  }

  async function decrypt(pin, { iv, data }) {
    const key     = await deriveKey(pin);
    const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
    const ctBytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const plain   = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ctBytes);
    return DEC.decode(plain);
  }

  const PROBE = 'hrw-pin-verified';

  async function setPin(pin) {
    const enc = await encrypt(pin, PROBE);
    await new Promise(r => chrome.storage.local.set({ hrw_pin_probe: enc }, r));
  }

  // null = no PIN set yet, true = correct, false = wrong
  async function verifyPin(pin) {
    const data = await new Promise(r => chrome.storage.local.get('hrw_pin_probe', r));
    if (!data.hrw_pin_probe) return null;
    try {
      return (await decrypt(pin, data.hrw_pin_probe)) === PROBE;
    } catch {
      return false;
    }
  }

  return { encrypt, decrypt, setPin, verifyPin };
})();
