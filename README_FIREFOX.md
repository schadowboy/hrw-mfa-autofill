# HRW MFA Autofill — Firefox (v1.6.8)

## Unterschiede zur Edge/Chrome-Version

| Feature | Edge/Chrome | Firefox |
|---|---|---|
| Manifest Version | MV3 | MV2 |
| `chrome.storage.session` | Nativ | Polyfill (in-memory AES-GCM, `compat.js`) |
| Background | Service Worker | Event Page (`persistent: false`) |
| Mindestversion | Edge 109+ | Firefox 109+ |

Der `compat.js`-Polyfill emuliert `chrome.storage.session` mit einem zufälligen
In-Memory-AES-Schlüssel + verschlüsseltem `chrome.storage.local`. Sicherheitssemantik
ist identisch: Session-Daten verschwinden beim Browser-Schließen.

---

## Installation — Temporär (Entwicklung)

1. Firefox öffnen → `about:debugging` in Adressleiste
2. "Dieser Firefox" → "Temporäres Add-on laden"
3. `manifest.json` aus diesem Ordner auswählen
4. Extension erscheint in der Toolbar

> ⚠️ Temporäre Extensions werden beim Firefox-Neustart entfernt.

## Installation — Dauerhaft (Firefox ESR / Nightly)

Für dauerhafte Installation ohne Signierung:

1. `about:config` → `xpinstall.signatures.required` → `false` setzen
   *(nur in Firefox ESR oder Developer Edition möglich)*
2. Extension als `.xpi` paketieren:
   ```bash
   cd hrw-mfa-addon-firefox
   zip -r ../hrw-mfa-autofill.xpi .
   ```
3. `about:addons` → Zahnrad → "Add-on aus Datei installieren"

## Installation — Firefox Developer Edition / Nightly (empfohlen)

Firefox Developer Edition erlaubt unsignierte Extensions dauerhaft:

1. [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/) installieren
2. `about:config` → `xpinstall.signatures.required` = `false`
3. `.xpi` wie oben erstellen und installieren

---

## Kompatibilität

| Firefox | Status |
|---|---|
| Firefox 109+ (Stable) | ✅ Temporäre Installation |
| Firefox ESR 115+ | ✅ Dauerhaft (unsigned) |
| Firefox Developer Edition | ✅ Dauerhaft (unsigned) |
| Firefox Nightly | ✅ Dauerhaft (unsigned) |
