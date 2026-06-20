# 📖 Markdown Reader

App simplu pentru citit fișiere `.md` randate (preview), nu cod brut.
Funcționează pe **MacBook** și **Android** — același cod (PWA, web app instalabil).

## Funcții

**Bază**
- Sidebar care se ascunde / afișează (buton `☰` / `✕`)
- Import **folder** întreg (recursiv) sau **fișiere** individuale
- Drag & drop fișiere direct în fereastră
- **Tree view** cu foldere imbricate, colapsabile
- Temă light / dark (buton `🌓`, se ține minte)

**Citit**
- **Cuprins (TOC)** generat din heading-uri, cu scroll-spy (buton `¶`)
- **Syntax highlight** la blocuri de cod (highlight.js)
- **Math** LaTeX inline `$...$` și bloc `$$...$$` (KaTeX)
- **Diagrame Mermaid** (```mermaid)
- **Imagini locale** relative din folder (`![](img/x.png)`)
- **Linkuri interne** între fișiere `.md` (navighează în app)
- Buton **copy** la fiecare bloc de cod
- Task lists `- [ ]` / `- [x]`
- Control **mărime text** (`A− / A+`) și **lățime citire** (`⇔`)
- **Export PDF / Print** (buton `⎙`)

**Navigare / căutare**
- Căutare după **nume** fișier sau în **conținut** (toggle `🔤`/`📄`)
- **Quick open** fuzzy cu `Cmd/Ctrl+P` (buton `⌕`), cu fișiere recente

**Persistență / offline**
- **Reține sesiunea**: la redeschidere încarcă ultimul folder + fișierul activ
  (IndexedDB — text + imagini)
- **Live reload** pe desktop (Electron): re-citește de pe disc când fișierele
  se schimbă; buton `↻ Refresh`
- Funcționează **offline** (service worker)
- Instalabil ca aplicație pe Mac și Android

## Rulare pe MacBook

App-ul are nevoie de un server local (service worker nu merge pe `file://`).

```sh
cd markdown-file-reader
python3 -m http.server 8765
```

Deschide în browser: <http://localhost:8765>

Apoi: meniul browser → **Install / Add to Dock** ca să-l ai ca aplicație separată.

> Fără server (doar deschis `index.html` direct) merge citirea markdown,
> dar fără instalare/offline.

## Rulare pe Android

Trebuie servit de undeva accesibil de telefon. Două variante:

1. **Aceeași rețea WiFi ca Mac-ul:**
   - Pornește serverul pe Mac (vezi mai sus)
   - Află IP-ul Mac-ului: `ipconfig getifaddr en0`
   - Pe telefon deschide `http://<IP-MAC>:8765`
2. **Hosting gratuit** (recomandat pentru folosire reală): pune folderul pe
   GitHub Pages / Netlify / Cloudflare Pages. Necesită HTTPS pentru PWA install.

În Chrome pe Android: meniul `⋮` → **Add to Home screen** → devine app.

## Structură

```
www/                  codul web (sursă unică pentru toate platformele)
  index.html          UI
  styles.css          stiluri + temă + responsive + print
  app.js              logică (import, render, tree, search, TOC, quick-open…)
  manifest.json       metadata PWA
  sw.js               service worker (offline, runtime cache)
  icon.svg            iconiță
  vendor/             marked, DOMPurify, highlight.js, KaTeX, Mermaid (offline)
  sample/             fișiere exemplu (md + imagine + mermaid + math)
electron/             shell desktop (main.js + preload.js → fs, watch, dialog)
android/              proiect Capacitor (+ plugin SAF FolderPicker.java)
capacitor.config.json
package.json          scripts: dmg / apk / cap:sync
```

## Note tehnice

- Render: `marked` → `DOMPurify` (sanitizare) → highlight.js + KaTeX + Mermaid
- Linkurile externe se deschid în browserul sistemului
- Extensii md: `.md .markdown .mdown .mkd .txt`; imagini: `png jpg gif svg webp bmp avif`
- Totul rulează local; niciun fișier nu pleacă de pe device
- **Folder pe Android**: plugin nativ SAF (`ACTION_OPEN_DOCUMENT_TREE`) care
  citește recursiv md + imagini și le trimite în WebView (nu `webkitdirectory`,
  care nu merge pe Android)
- **Folder pe desktop**: Electron citește direct de pe disc (preload IPC) →
  live reload prin `fs.watch`

## Aplicații native (APK + DMG)

App-ul e împachetat în două shell-uri native peste același cod web (`www/`):
- **Android (APK)** via Capacitor
- **macOS (DMG)** via Electron

### Artefacte gata construite

```
dist/MarkdownReader-debug.apk     <- instalează pe tabletă Android
dist/MarkdownReader-1.0.0.dmg     <- instalează pe MacBook (Apple Silicon)
```

### Instalare APK pe tabletă

1. Copiază `MarkdownReader-debug.apk` pe tabletă (USB / Drive / email).
2. Setări → Securitate → permite **instalare din surse necunoscute** pentru
   aplicația prin care deschizi fișierul (ex. Files / Chrome).
3. Deschide APK-ul → Install.

> APK e **debug-signed** (cheie debug). Bun pentru uz personal. Pentru Play
> Store ai nevoie de release build semnat cu keystore propriu.

### Instalare DMG pe MacBook

1. Dublu-click `MarkdownReader-1.0.0.dmg` → trage app-ul în Applications.
2. Prima pornire: Gatekeeper avertizează (app nesemnat de developer Apple).
   **Click-dreapta pe app → Open → Open**. Sau:
   `xattr -dr com.apple.quarantine "/Applications/Markdown Reader.app"`

> DMG e doar pentru **Apple Silicon (arm64)**. Pentru Intel se rebuild-uiește.

## Import folder pe Android — ACUM MERGE ✅

Butonul **Folder** pe tabletă deschide selectorul nativ Android (SAF), alegi un
dosar și aplicația citește recursiv toate fișierele `.md` + imaginile.
Verificat pe emulator: folder cu subfoldere + imagine + mermaid + math se
randează corect în app.

> Notă: pe Android sesiunea (text + imagini) e reținută în IndexedDB, deci la
> redeschidere vezi din nou ce ai importat. Ca să prinzi modificări noi de pe
> disc, reimportă folderul. (Live reload automat e doar pe desktop.)

## Rebuild din surse

Necesar: Node, Android SDK (`~/Library/Android/sdk`), JDK 17, Xcode.

```sh
npm install

# macOS DMG
npm run dmg            # -> dist-mac/

# Android APK (JDK 17 obligatoriu — JDK 24 nu merge cu Gradle)
export JAVA_HOME="$HOME/.jdks/jdk-17.0.19+10/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
npm run apk           # -> android/app/build/outputs/apk/debug/

# după modificări în www/ — re-sincronizează în Android:
npm run cap:sync
```

> Note:
> - Gradle din Capacitor (8.2.1) **nu** suportă Java 24. Folosește JDK 17.
>   Instalat user-local (fără sudo) din tarball Adoptium la `~/.jdks/`.
> - Pluginul SAF e în `android/app/src/main/java/com/marian/markdownreader/`
>   (`FolderPicker.java`, înregistrat în `MainActivity.java`); dependența
>   `androidx.documentfile` e deja în `android/app/build.gradle`.
> - Codul web e în `www/` (sursă unică); Electron și Capacitor îl împachetează
>   amândouă. După edit în `www/`, pentru APK rulează `npm run cap:sync`.
