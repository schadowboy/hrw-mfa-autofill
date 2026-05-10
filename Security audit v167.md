# HRW MFA Autofill — Finaler Security Audit v1.6.7
**Datum:** 2026-05-06  
**Codebase:** `hrw-mfa-addon/` (7 Dateien, ~1758 LoC)  
**Engine:** Semgrep OSS 1.161.0 (12 custom rules + Trail of Bits JS) + manuelle Taint-Analyse  
**Skills:** semgrep · insecure-defaults · sharp-edges · variant-analysis · differential-review

---

## Gesamtbewertung

```
╔══════════════════════════════════════════════════════════╗
║  Sicherheitsniveau: SEHR GUT                              ║
║                                                           ║
║  Kritisch   0   ████████████████████   keine offen       ║
║  Hoch       0   ████████████████████   keine offen       ║
║  Mittel     0   ████████████████████   keine offen       ║
║  Niedrig    0   ████████████████████   keine offen       ║
║  Info/FP    2   ░░░░░░░░░░░░░░░░░░░░   beide False Pos.  ║
╚══════════════════════════════════════════════════════════╝
```

**Keine echten Schwachstellen offen.** Die zwei verbleibenden Semgrep-Findings sind verifizierte False Positives. Das Addon ist für den privaten Einsatz freigegeben.

---

## Semgrep-Ergebnisse v1.6.7

| Ruleset | Findings | Bewertung |
|---|---|---|
| Custom rules (12 Regeln) | 2 | ✅ Beide False Positives — siehe unten |
| Trail of Bits JS | 0 | ✅ Sauber |
| elttam | 0 | ✅ Sauber |
| r2c-ci | 0 | ✅ Sauber |

---

## ℹ️ False Positive — HMAC-SHA1 in `totp.js:32`

**Regel:** `ext-sha1-string`

```javascript
{ name: 'HMAC', hash: 'SHA-1' }  // totp.js:32
```

**Analyse:** RFC 6238 (TOTP) und RFC 4226 (HOTP) schreiben HMAC-SHA1 als Standardalgorithmus vor. Alle Authenticator-Apps (Google Authenticator, Authy, Microsoft Authenticator) implementieren denselben Algorithmus. Eine Änderung würde die erzeugten Codes inkompatibel mit der HRW-MFA-Infrastruktur machen. HMAC-SHA1-Kollisionsangriffe sind für MAC-Konstrukte nicht anwendbar.

**Urteil: False Positive — RFC-konforme, zwingend erforderliche Implementierung.**

---

## ℹ️ False Positive — `localStorage.setItem` in `popup.js:17`

**Regel:** `ext-localstorage-write`

```javascript
localStorage.setItem('hrw_theme', t);  // t ∈ {'light', 'dark', 'system'}
```

**Analyse:** Der einzige `localStorage`-Schreibzugriff speichert ausschließlich die Theme-Präferenz. Der Wert ist eine von drei hardkodierten Optionen (`'light'` / `'dark'` / `'system'`), direkt aus `data-theme-val`-Attributen eigener HTML-Elemente. Kein Credential, kein Secret, kein User-Input fließt hier ein.

**Urteil: False Positive — korrekte Nutzung von `localStorage` für UI-Präferenzen.**

---

## Verifizierte Fixes gegenüber v1.6.6

| Finding v1.6.6 | Fix | Verifikation |
|---|---|---|
| `innerHTML` + Template-Variable in `showInlineConfirm` | `createElement` + `textContent` | ✅ 0 innerHTML+variable Hits |
| `innerHTML` + Template-Variable in `showPinConfirmInline` | `createElement` für alle Elemente | ✅ verifiziert |
| Doppelte `showInlineConfirm`-Deklaration (dead code) | Erste (4-Parameter) entfernt | ✅ nur 1 Deklaration |

### Vollständige `innerHTML`-Inventory v1.6.7

Alle verbleibenden `innerHTML`-Schreibzugriffe in `popup.js`:

| Zeile | Inhalt | Risiko |
|---|---|---|
| 478 | `el.innerHTML = ''` | Keines — leert Element |
| 481 | `iconWrap.innerHTML = STATUS_SVG_ERR \| OK` | Keines — hardkodierte Konstanten |
| 486 | `el.innerHTML = ''` | Keines — leert Element nach Timeout |

**→ Kein einziger `innerHTML`-Schreibzugriff mit variablem Inhalt.**

---

## Gesamte Sicherheitsarchitektur — Finalzustand

### Kryptographie
| Komponente | Implementierung |
|---|---|
| Schlüsselableitung | PBKDF2, SHA-256, 200.000 Iterationen, zufälliger per-Installation Salt |
| Verschlüsselung | AES-256-GCM, zufälliger 12-Byte IV pro Encrypt-Vorgang |
| Key-Export | `extractable: false` — Schlüssel verlässt nie den Browser |
| TOTP | HMAC-SHA1, RFC 6238, BigInt-Counter, Replay-Schutz |
| PIN-Prüfung | AES-GCM Auth-Tag als Gate — String-Vergleich danach sicher |

### Storage
| Speicherort | Inhalt | Scope |
|---|---|---|
| `chrome.storage.local` | Verschlüsselte Blobs, zufälliger Salt, PBKDF2-Probe | Persistent |
| `chrome.storage.session` | Entschlüsselte Credentials (Laufzeit-Cache) | Browser-Session, kein Disk |
| `localStorage` | Theme-Präferenz ('light'/'dark'/'system') | Persistent, unkritisch |

### Kommunikation
| Kanal | Sicherheit |
|---|---|
| Popup → Background | `chrome.runtime.sendMessage`, `sender.id`-Validierung |
| Background → Content | `chrome.tabs.sendMessage`, nur nach TRIGGER_AUTOFILL |
| Extern | Kein `externally_connectable` — Seiten-Scripts ausgeschlossen |

### DOM-Sicherheit
| Pattern | Status |
|---|---|
| `innerHTML` + Variable | ✅ Komplett eliminiert |
| `textContent` für User-Daten | ✅ Konsequent umgesetzt |
| Origin-Check vor `.click()` | ✅ `findTrustedLink()` mit `new URL().origin` |
| CSP | ✅ `script-src 'self'` im Manifest |

### Session-Management
| Feature | Implementierung |
|---|---|
| Service-Worker-Restart-Sicherheit | `chrome.storage.session` — überlebt SW-Neustart |
| Konfigurierbares Timeout | 30 Min / 60 Min / 2h / 8h / Browser-Session |
| Auto-Extend | Session verlängert sich bei jeder Nutzung |
| Manuelles Lock | 🔒-Button im Popup, sofortiger `chrome.storage.session`-Clear |

---

## Vollständige Findings-Historie aller Audits

| Version | Schwere | Finding | Status |
|---|---|---|---|
| v1.0 | 🔴 Kritisch | DOM-Hijack via `findLinkByHref` | ✅ Behoben |
| v1.0 | 🟠 Hoch | Plaintext Passwort + TOTP in `chrome.storage.local` | ✅ Behoben |
| v1.0 | 🟠 Hoch | Kein CSP im Manifest | ✅ Behoben |
| v1.0 | 🟡 Mittel | TOTP Counter-Poisoning bei fehlgeschlagenem Submit | ✅ Behoben |
| v1.0 | 🟡 Mittel | OTP-Heuristic: blinder Single-Input-Fallback | ✅ Behoben |
| v1.0 | 🟡 Mittel | `base32Decode` in öffentlicher TOTP-API | ✅ Behoben |
| v1.0 | 🟢 Niedrig | `autofill`-Default ON ohne Konfiguration | ✅ Behoben |
| v1.0 | 🟢 Niedrig | Google Fonts Datenschutz-Leak | ✅ Behoben |
| v1.0 | 🟢 Niedrig | `intToBytes` mit Float-Arithmetik | ✅ Behoben |
| v1.5 | 🔴 Kritisch | Service Worker Spontan-Lock (In-Memory-Session) | ✅ Behoben |
| v1.5 | 🟠 Hoch | Autofill ignorierte Toggle-Zustand | ✅ Behoben |
| v1.5 | 🟡 Mittel | Autologin unabhängig von Autofill-State | ✅ Behoben |
| v1.6.3 | 🟠 Hoch | `innerHTML` mit `e.message` in `showStatus` | ✅ Behoben |
| v1.6.3 | 🟡 Mittel | Statischer PBKDF2-Salt (Precomputed-Angriff) | ✅ Behoben |
| v1.6.3 | 🟡 Mittel | `parseInt()` ohne Radix | ✅ Behoben |
| v1.6.3 | 🟢 Niedrig | `confirm()` für Datenlöschung | ✅ Behoben |
| v1.6.3 | 🟢 Niedrig | Kein `sender.id`-Check in Background | ✅ Behoben |
| v1.6.5 | 🔴 Bug | `TOAST_ICONS` TDZ-Crash (temporal dead zone) | ✅ Behoben |
| v1.6.5 | 🔴 Bug | Autologin-Feldname-Mismatch in SET_SESSION | ✅ Behoben |
| v1.6.6 | 🟡 Mittel | `innerHTML`+Variable in Confirm-Widgets | ✅ Behoben |
| v1.6.6 | 🟢 Niedrig | Doppelte `showInlineConfirm`-Deklaration | ✅ Behoben |
| **v1.6.7** | ℹ️ FP | HMAC-SHA1 (RFC-konform) | — False Positive |
| **v1.6.7** | ℹ️ FP | `localStorage` für Theme (unkritisch) | — False Positive |

---

## Abschlussurteil

**HRW MFA Autofill v1.6.7 ist für den privaten Einsatz freigegeben.**

Das Addon hat über 7 Entwicklungsiterationen und 3 vollständige Security-Audits einen hohen Sicherheitsreifegrad erreicht. Alle 21 echten Findings wurden behoben. Die verbleibenden 2 Semgrep-Meldungen sind verifizierte False Positives ohne Handlungsbedarf.

Die Architektur folgt durchgängig dem Prinzip **Defence in Depth**: CSP im Manifest, Origin-validierte DOM-Navigation, AES-256-GCM mit zufälligem Salt und IV, `chrome.storage.session` für Laufzeit-Credentials, konsequente Trennung von `textContent` und `innerHTML`, und explizite `sender.id`-Prüfung im Background-Worker.
