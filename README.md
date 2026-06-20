# 📖 Markdown Reader

A simple app for reading `.md` files as rendered preview (not raw code).
Runs on **macOS**, **Android**, and any browser — one web codebase, wrapped
natively for desktop and mobile.

## Features

**Basics**
- Hideable sidebar (`☰` / `✕`)
- Import a whole **folder** (recursive) or individual **files**
- Drag & drop files into the window
- **Tree view** with nested, collapsible folders
- Light / dark theme (`🌓`, remembered)

**Reading**
- **Table of contents** generated from headings, with scroll-spy (`¶`)
- **Syntax highlighting** for code blocks (highlight.js)
- **LaTeX math**, inline `$...$` and block `$$...$$` (KaTeX)
- **Mermaid diagrams** (```mermaid)
- **Local images** referenced relatively from the folder (`![](img/x.png)`)
- **Internal links** between `.md` files (navigate inside the app)
- **Copy** button on every code block
- Task lists `- [ ]` / `- [x]`
- **Font size** (`A− / A+`) and **reading width** (`⇔`) controls
- **Export PDF / Print** (`⎙`)

**Navigation / search**
- Search by file **name** or in **content** (toggle `🔤`/`📄`)
- **Quick open** fuzzy finder with `Cmd/Ctrl+P` (`⌕`), with recent files

**Persistence / offline**
- **Remembers the session**: reopens the last folder + active file on launch
  (IndexedDB — text + images)
- **Live reload** on desktop (Electron): re-reads from disk when files change;
  `↻ Refresh` button
- Works **offline** (service worker)
- Installable as an app on Mac and Android

## Run in the browser (any platform)

The app needs a local server (the service worker does not work over `file://`).

```sh
cd markdown-file-reader
python3 -m http.server 8765
```

Open <http://localhost:8765/www/index.html> in a browser.
Then use the browser menu → **Install / Add to Home screen** to keep it as an app.

## Native apps (APK + DMG)

The web code in `www/` is wrapped by two native shells:
- **Android (APK)** via Capacitor
- **macOS (DMG)** via Electron

### Install the APK (Android tablet/phone)

1. Copy the APK to the device (USB / Drive / email).
2. Settings → Security → allow **install from unknown sources** for the app you
   open the file with (e.g. Files / Chrome).
3. Open the APK → Install.

> The APK is **debug-signed** (debug key). Fine for personal use. For the Play
> Store you need a release build signed with your own keystore.

On the tablet, the **Folder** button opens the native Android picker (SAF); pick
a folder and the app reads all `.md` files + images recursively.

### Install the DMG (macOS, Apple Silicon)

1. Double-click the DMG → drag the app into Applications.
2. First launch: Gatekeeper warns (app not signed by an Apple developer).
   **Right-click the app → Open → Open**. Or:
   `xattr -dr com.apple.quarantine "/Applications/Markdown Reader.app"`

> The DMG is **Apple Silicon (arm64)** only. For Intel, rebuild.

## Project structure

```
www/                  web code (single source for all platforms)
  index.html          UI
  styles.css          styles + theme + responsive + print
  app.js              logic (import, render, tree, search, TOC, quick-open…)
  manifest.json       PWA metadata
  sw.js               service worker (offline, runtime cache)
  icon.svg            icon
  vendor/             marked, DOMPurify, highlight.js, KaTeX, Mermaid (offline)
  sample/             sample files (md + image + mermaid + math)
electron/             desktop shell (main.js + preload.js → fs, watch, dialog)
android/              Capacitor project (+ SAF FolderPicker.java plugin)
capacitor.config.json
package.json          scripts: dmg / apk / cap:sync
```

## Technical notes

- Render pipeline: `marked` → `DOMPurify` (sanitize) → highlight.js + KaTeX + Mermaid
- External links open in the system browser
- Markdown extensions: `.md .markdown .mdown .mkd .txt`; images: `png jpg gif svg webp bmp avif`
- Everything runs locally; no file leaves the device
- **Folder on Android**: a native SAF plugin (`ACTION_OPEN_DOCUMENT_TREE`) reads
  markdown + images recursively and feeds them to the WebView (not
  `webkitdirectory`, which is unsupported on Android)
- **Folder on desktop**: Electron reads directly from disk (preload IPC) →
  live reload via `fs.watch`

## Build from source

Requirements: Node, Android SDK, JDK 17, Xcode.

```sh
npm install

# macOS DMG
npm run dmg            # -> dist-mac/

# Android APK (JDK 17 required — JDK 24 does not work with Gradle)
export JAVA_HOME="$HOME/.jdks/jdk-17.0.19+10/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
npm run apk           # -> android/app/build/outputs/apk/debug/

# after editing www/ — re-sync into the Android project:
npm run cap:sync
```

> Notes:
> - The Gradle bundled with Capacitor (8.2.1) does **not** support Java 24. Use JDK 17.
> - The SAF plugin lives in `android/app/src/main/java/com/marian/markdownreader/`
>   (`FolderPicker.java`, registered in `MainActivity.java`); the
>   `androidx.documentfile` dependency is already in `android/app/build.gradle`.
> - Web code lives in `www/` (single source); Electron and Capacitor both wrap it.
>   After editing `www/`, run `npm run cap:sync` for the APK.

## License

MIT
