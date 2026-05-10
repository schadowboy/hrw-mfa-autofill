// TOTP Implementation (RFC 6238) - no external dependencies
// Base32 decode + HMAC-SHA1 + TOTP

const TOTP = (() => {
  // Base32 alphabet
  const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function base32Decode(base32) {
    // Remove spaces, dashes, convert to uppercase
    const input = base32.replace(/[\s-]/g, '').toUpperCase();
    let bits = 0;
    let value = 0;
    let output = [];

    for (let i = 0; i < input.length; i++) {
      const idx = BASE32_CHARS.indexOf(input[i]);
      if (idx === -1) continue; // skip padding/invalid chars
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        output.push((value >>> bits) & 0xff);
      }
    }
    return new Uint8Array(output);
  }

  async function hmacSHA1(keyBytes, messageBytes) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageBytes);
    return new Uint8Array(signature);
  }

  function intToBytes(n) {
    // Use BigInt for correct 64-bit integer handling (no floating point rounding)
    const bytes = new Uint8Array(8);
    let v = BigInt(Math.floor(n));
    for (let i = 7; i >= 0; i--) {
      bytes[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return bytes;
  }

  async function generate(secret, digits = 6, period = 30) {
    const keyBytes = base32Decode(secret);
    const counter = Math.floor(Date.now() / 1000 / period);
    const counterBytes = intToBytes(counter);
    const hmac = await hmacSHA1(keyBytes, counterBytes);

    // Dynamic truncation
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    const otp = code % Math.pow(10, digits);
    return otp.toString().padStart(digits, '0');
  }

  function getRemainingSeconds(period = 30) {
    return period - (Math.floor(Date.now() / 1000) % period);
  }

  // base32Decode is intentionally NOT exported — it is an internal primitive.
  // External callers should only use generate() and getRemainingSeconds().
  return { generate, getRemainingSeconds };
})();
