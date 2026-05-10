# HRW MFA Autofill v1.4
**Privates Browser-Addon** für Microsoft Edge / Chrome  
Automatisiert den Login (inkl. TOTP-MFA) für HS Ruhr West.

---

## Sicherheitsmerkmale

| Feature | Details |
|---|---|
| AES-256-GCM Verschlüsselung | Passwort + TOTP-Secret PIN-verschlüsselt |
| PBKDF2 Key Derivation | 200.000 Iterationen, SHA-256 |
| Kein Plaintext in Storage | Nur verschlüsselte Blobs gespeichert |
| Origin-validierte Navigation | Kein DOM-Hijack möglich |
| TOTP Replay-Schutz | Doppelverwendung eines Codes verhindert |
| Kein externer Server | Vollständig lokal (Web Crypto API) |
| CSP im Manifest | `script-src 'self'` — kein Inline-JS |

---

## Unterstützte Dienste

| Dienst | URL | Flow |
|---|---|---|
| SSO / Shibboleth | `sso.hs-rw.de` | Login + TOTP (e#s1 / e#s2) |
| Portal HRW | `portal.hs-ruhrwest.de` | Credentials + TOTP |
| OWA (E-Mail) | `owa.hs-ruhrwest.de` | Credentials |
| CampusNet | `campusnet.hs-ruhrwest.de` | Click-through → SSO |
| DSF IdentityServer | `dsf.hs-ruhrwest.de` | Shibboleth-Button-Click |

---

## Installation

1. ZIP entpacken → Ordner `hrw-mfa-addon` ablegen
2. Edge öffnen: `edge://extensions/`
3. **Entwicklermodus** einschalten
4. **"Entpackte Erweiterung laden"** → Ordner auswählen
5. 🔒 Icon in der Toolbar anklicken

---

## Ersteinrichtung

1. **PIN festlegen** (mind. 4 Zeichen) — kann nicht wiederhergestellt werden
2. Tab **Einstellungen** → Benutzername, Passwort, TOTP-Schlüssel eingeben
3. **"Verschlüsselt speichern"** klicken
4. Optionen nach Bedarf aktivieren

### TOTP-Schlüssel finden
- In deiner Authenticator-App unter „Konto bearbeiten" → „Schlüssel" oder „Secret Key"
- Format: `JBSWY3DPEHPK3PXP` (Base32, Buchstaben A–Z und Ziffern 2–7)

### Fonts selbst hosten (DSGVO)
Das Addon lädt `Barlow` von Google Fonts. Für vollständige Offline-Nutzung und ohne externen Request:
1. `https://fonts.google.com/specimen/Barlow` → „Download family"
2. WOFF2-Dateien nach `fonts/` kopieren
3. In `popup.html` den `@import` durch lokale `@font-face` ersetzen

---

## Architektur

```
hrw-mfa-addon/
├── manifest.json        # MV3, CSP, host_permissions
├── background.js        # Service Worker — Message-Broker + Migration
├── content.js           # Autofill auf Login-Seiten
├── popup.html           # HRW-Design, PIN-Overlay, Tabs
├── popup.js             # PIN-Logic, AES-Encrypt/Decrypt, TOTP-Display
├── lib/
│   ├── crypto.js        # AES-256-GCM + PBKDF2 (Web Crypto API)
│   └── totp.js          # TOTP RFC 6238 (BigInt, kein npm)
└── icons/               # HRW-Cyan Lockscreen Icons
```

### Message-Passing-Flow
```
Login-Seite lädt
  → content.js sendet GET_CREDENTIALS an popup
  → Popup (falls offen + entsperrt) antwortet mit Plaintext-Credentials
  → content.js füllt Felder aus

Falls Popup geschlossen:
  → content.js zeigt Toast "Bitte Popup öffnen & entsperren"
  → Kein Plaintext verlässt den Popup-Kontext
```
