# HRW MFA Autofill v1.6.8 — Firefox

## Installation (Temporär, für Entwicklung)

1. Firefox öffnen → `about:debugging`
2. **"Dieser Firefox"** → **"Temporäres Add-on laden"**
3. `manifest.json` aus dem Ordner `hrw-mfa-addon-firefox/` auswählen
4. Add-on erscheint in der Toolbar

> **Hinweis:** Temporäre Add-ons werden beim Firefox-Neustart entfernt.
> Für dauerhafte Installation ohne Signierung: Firefox Developer Edition oder
> Nightly mit `xpinstall.signatures.required = false` in `about:config`.

## Permanente Installation (ohne Signierung)

1. Firefox Developer Edition oder Nightly installieren
2. `about:config` → `xpinstall.signatures.required` → `false`
3. Add-on als `.zip` packen → in `.xpi` umbenennen
4. `about:addons` → Zahnrad → "Add-on aus Datei installieren"

## Unterschiede zur Edge/Chrome-Version

| Feature | Edge/Chrome | Firefox |
|---|---|---|
| Manifest | MV3 | MV2 |
| Background | Service Worker | Background Page |
| `storage.session` | Nativ | Polyfill (in-memory, kein Disk-Write) |
| Session-Persistenz bei Neustart | ✅ SW-safe | ❌ Nur solange Background-Page läuft |

## Safari

Safari erfordert macOS + Xcode mit dem `safari-web-extension-converter`:
```bash
xcrun safari-web-extension-converter /pfad/zu/hrw-mfa-addon-firefox/ \
  --app-name "HRW MFA Autofill" --bundle-identifier de.hrw.mfa-autofill
```
Anschließend in Xcode öffnen, signieren und in Safari laden.
