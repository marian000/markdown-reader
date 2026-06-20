const { app, BrowserWindow, Menu, shell, dialog, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const MD_RE = /\.(md|markdown|mdown|mkd|txt)$/i;
const IMG_RE = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' };
const SKIP_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.trash']);

let mainWin = null;
let watcher = null;

// recursively read a folder into { root, items: [{path, kind, text|base64, mime}] }
async function readFolderTree(root) {
  const base = path.basename(root);
  const items = [];
  async function walk(dir, rel) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (ent.name.startsWith('.') && ent.isDirectory()) continue;
      if (SKIP_DIRS.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      const relPath = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) {
        await walk(abs, relPath);
      } else if (MD_RE.test(ent.name)) {
        try { items.push({ path: base + '/' + relPath, kind: 'md', text: await fsp.readFile(abs, 'utf8') }); } catch (e) {}
      } else if (IMG_RE.test(ent.name)) {
        try {
          const buf = await fsp.readFile(abs);
          items.push({ path: base + '/' + relPath, kind: 'img', base64: buf.toString('base64'), mime: MIME[ent.name.split('.').pop().toLowerCase()] });
        } catch (e) {}
      }
    }
  }
  await walk(root, '');
  return { root, items };
}

function setupWatch(root) {
  if (watcher) { try { watcher.close(); } catch (e) {} watcher = null; }
  try {
    let timer = null;
    watcher = fs.watch(root, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('fs-change'); }, 250);
    });
  } catch (e) { /* recursive watch unsupported -> skip */ }
}

function registerIpc() {
  ipcMain.handle('pickFolder', async () => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths.length) return null;
    const root = r.filePaths[0];
    const data = await readFolderTree(root);
    setupWatch(root);
    return data;
  });
  ipcMain.handle('readFolder', async (_e, root) => {
    if (!root) return null;
    try { await fsp.access(root); } catch (e) { return null; }
    return readFolderTree(root);
  });
  ipcMain.handle('watch', (_e, root) => { if (root) setupWatch(root); });
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 480,
    minHeight: 400,
    backgroundColor: '#1e1e2e',
    title: 'Markdown Reader',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWin.loadFile(path.join(__dirname, '..', 'www', 'index.html'));

  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

app.whenReady().then(async () => {
  // Desktop loads from file:// and never needs a service worker. A stale SW
  // (from an older build) intercepts the navigation and blanks the window, so
  // wipe any SW storage before creating the window. Self-heals broken installs.
  try { await session.defaultSession.clearStorageData({ storages: ['serviceworkers'] }); } catch (e) {}

  const template = [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
