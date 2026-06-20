(() => {
  'use strict';

  // ============ State ============
  let files = [];          // { id, name, path, dir, text, rendered }
  const images = new Map(); // path -> { blob, url }
  let activeId = null;
  let folderRoot = null;    // desktop: absolute folder path for live reload
  let watchStop = null;

  const MD_RE = /\.(md|markdown|mdown|mkd|txt)$/i;
  const IMG_RE = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' };

  // ============ DOM ============
  const $ = (s) => document.querySelector(s);
  const app = $('#app');
  const content = $('#content');
  const tree = $('#tree');
  const treeWrap = $('#treeWrap');
  const results = $('#results');
  const currentName = $('#currentName');
  const fileCount = $('#fileCount');
  const filter = $('#filter');
  const searchModeBtn = $('#searchMode');
  const tocEl = $('#toc');
  const refreshBtn = $('#refreshBtn');

  const scrim = document.createElement('div');
  scrim.id = 'scrim';
  app.appendChild(scrim);

  // ============ Helpers ============
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dirname = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  const extOf = (n) => (n.split('.').pop() || '').toLowerCase();

  function resolvePath(baseDir, rel) {
    rel = rel.split('?')[0].split('#')[0];
    if (!rel || /^[a-z]+:/i.test(rel) || rel.startsWith('//')) return null;
    const parts = baseDir ? baseDir.split('/') : [];
    for (const seg of rel.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return parts.join('/');
  }

  // ============ IndexedDB (session cache) ============
  let _db = null;
  function db() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('md-reader', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'path' });
        if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'path' });
      };
      r.onsuccess = () => { _db = r.result; res(_db); };
      r.onerror = () => rej(r.error);
    });
  }
  function tx(store, mode, fn) {
    return db().then((d) => new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
    }));
  }
  // full write of the imported library — call on import / refresh / clear only
  async function persistLibrary() {
    try {
      await tx('files', 'readwrite', (s) => {
        s.clear();
        for (const f of files) s.put({ path: f.path, name: f.name, dir: f.dir, text: f.text });
      });
      await tx('images', 'readwrite', (s) => {
        s.clear();
        for (const [path, v] of images) s.put({ path, blob: v.blob });
      });
      localStorage.setItem('md-root', folderRoot || '');
    } catch (e) { /* storage may be unavailable */ }
  }
  // cheap pointer write — call on every file open
  function saveActive(path) { try { localStorage.setItem('md-active', path || ''); } catch (e) {} }
  async function loadSession() {
    const fRows = await tx('files', 'readonly', (s) => { const out = []; s.openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.push(c.value); c.continue(); } }; return out; });
    const iRows = await tx('images', 'readonly', (s) => { const out = []; s.openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.push(c.value); c.continue(); } }; return out; });
    for (const r of iRows) {
      const url = URL.createObjectURL(r.blob);
      images.set(r.path, { blob: r.blob, url });
    }
    files = fRows.map((r) => ({ id: 'f' + Math.random().toString(36).slice(2), name: r.name, path: r.path, dir: r.dir, text: r.text }));
    files.sort((a, b) => a.path.localeCompare(b.path));
  }

  // ============ Markdown render ============
  marked.setOptions({ gfm: true, breaks: false });
  try {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict',
      theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark' });
  } catch (e) {}

  function renderMd(text) {
    const raw = marked.parse(text);
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'id', 'class'] });
  }

  let mermaidSeq = 0;
  async function postProcess(file) {
    // heading ids
    const heads = [...content.querySelectorAll('h1, h2, h3')];
    const used = new Set();
    for (const h of heads) {
      let slug = (h.textContent || 'sec').toLowerCase().trim()
        .replace(/[^\wÀ-ɏ\s-]/g, '').replace(/\s+/g, '-').slice(0, 60) || 'sec';
      let s = slug, i = 1;
      while (used.has(s)) s = slug + '-' + (i++);
      used.add(s);
      h.id = s;
    }
    // rewrite local images + internal md links
    content.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:') || src.startsWith('blob:') || /^[a-z]+:/i.test(src)) return;
      const key = resolvePath(file.dir, src);
      const hit = key && images.get(key);
      if (hit) img.src = hit.url;
    });
    content.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      if (href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; return; }
      if (href.startsWith('#')) return;
      const key = resolvePath(file.dir, href);
      const target = key && files.find((f) => f.path === key);
      if (target) { a.addEventListener('click', (e) => { e.preventDefault(); openFile(target.id); }); }
    });
    // syntax highlight (skip mermaid)
    content.querySelectorAll('pre code').forEach((code) => {
      if (code.classList.contains('language-mermaid')) return;
      try { hljs.highlightElement(code); } catch (e) {}
    });
    // copy buttons
    content.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.copy-btn') || pre.querySelector('.language-mermaid')) return;
      const btn = document.createElement('button');
      btn.className = 'copy-btn'; btn.textContent = 'copy';
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(pre.innerText.replace(/copy$/, '')).then(() => {
          btn.textContent = '✓'; setTimeout(() => (btn.textContent = 'copy'), 1200);
        });
      });
      pre.appendChild(btn);
    });
    // mermaid
    const mblocks = [...content.querySelectorAll('code.language-mermaid')];
    for (const code of mblocks) {
      const pre = code.closest('pre') || code;
      const def = code.textContent;
      try {
        const { svg } = await mermaid.render('mmd' + (mermaidSeq++), def);
        const div = document.createElement('div');
        div.className = 'mermaid'; div.innerHTML = svg;
        pre.replaceWith(div);
      } catch (e) {
        const div = document.createElement('div');
        div.className = 'mermaid'; div.textContent = 'Mermaid error: ' + e.message;
        pre.replaceWith(div);
      }
    }
    // math
    try {
      renderMathInElement(content, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) {}
    buildToc();
  }

  // ============ Open file ============
  async function openFile(id) {
    const f = files.find((x) => x.id === id);
    if (!f) return;
    activeId = id;
    if (!f.rendered) f.rendered = renderMd(f.text);
    content.innerHTML = `<div class="md">${f.rendered}</div>`;
    content.scrollTop = 0;
    currentName.textContent = f.path;
    await postProcess(f);
    markActive();
    pushRecent(f.path);
    saveActive(f.path);
    if (isMobile()) setSidebar(true);
  }

  // ============ Tree view ============
  function buildTreeData() {
    const root = { name: '', dirs: new Map(), files: [] };
    for (const f of files) {
      const segs = f.path.split('/');
      const fname = segs.pop();
      let node = root;
      for (const seg of segs) {
        if (!node.dirs.has(seg)) node.dirs.set(seg, { name: seg, dirs: new Map(), files: [] });
        node = node.dirs.get(seg);
      }
      node.files.push({ name: fname, file: f });
    }
    return root;
  }

  const collapsed = new Set(JSON.parse(localStorage.getItem('md-collapsed') || '[]'));
  function saveCollapsed() { localStorage.setItem('md-collapsed', JSON.stringify([...collapsed])); }

  function renderTree() {
    tree.innerHTML = '';
    const data = buildTreeData();
    const q = filter.value.trim().toLowerCase();
    const ul = document.createElement('ul');
    renderTreeNode(data, ul, '', q);
    tree.appendChild(ul);
    fileCount.textContent = `${files.length} files`;
  }
  function renderTreeNode(node, ul, prefix, q) {
    const dirNames = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b));
    for (const dn of dirNames) {
      const child = node.dirs.get(dn);
      const path = prefix ? prefix + '/' + dn : dn;
      const sub = document.createElement('ul');
      renderTreeNode(child, sub, path, q);
      // hide empty dirs when filtering
      if (q && !sub.children.length) continue;
      const li = document.createElement('li');
      li.className = 'folder';
      const row = document.createElement('div');
      row.className = 'node-row';
      const isCol = collapsed.has(path) && !q;
      row.innerHTML = `<span class="twirl">${isCol ? '▸' : '▾'}</span><span class="nm">📁 ${escapeHtml(dn)}</span>`;
      row.addEventListener('click', () => {
        if (collapsed.has(path)) collapsed.delete(path); else collapsed.add(path);
        saveCollapsed(); renderTree();
      });
      if (isCol) sub.classList.add('collapsed');
      li.appendChild(row); li.appendChild(sub);
      ul.appendChild(li);
    }
    const fileItems = node.files.sort((a, b) => a.name.localeCompare(b.name));
    for (const it of fileItems) {
      if (q && !it.file.path.toLowerCase().includes(q)) continue;
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'node-row file-row';
      row.dataset.id = it.file.id;
      if (it.file.id === activeId) row.classList.add('active');
      row.innerHTML = `<span class="twirl"></span><span class="nm">📄 ${escapeHtml(it.name)}</span>`;
      row.addEventListener('click', () => openFile(it.file.id));
      li.appendChild(row);
      ul.appendChild(li);
    }
  }
  function markActive() {
    tree.querySelectorAll('.file-row').forEach((r) => r.classList.toggle('active', r.dataset.id === activeId));
  }

  // ============ Content search ============
  function runContentSearch(q) {
    results.innerHTML = '';
    if (!q) { results.innerHTML = '<div class="res-empty">Type to search in content…</div>'; return; }
    const ql = q.toLowerCase();
    let total = 0;
    for (const f of files) {
      const lc = f.text.toLowerCase();
      let idx = lc.indexOf(ql);
      if (idx < 0) continue;
      let count = 0; let i = idx; while (i >= 0) { count++; i = lc.indexOf(ql, i + ql.length); }
      total++;
      const start = Math.max(0, idx - 30);
      const snip = f.text.slice(start, idx + q.length + 40);
      const item = document.createElement('div');
      item.className = 'res-item';
      const safe = escapeHtml(snip).replace(new RegExp(escapeReg(escapeHtml(q)), 'ig'), (m) => `<mark>${m}</mark>`);
      item.innerHTML = `<div class="res-file">📄 ${escapeHtml(f.name)} · ${count}</div><div class="res-snip">…${safe}…</div>`;
      item.addEventListener('click', () => { openFile(f.id).then(() => highlightInContent(q)); });
      results.appendChild(item);
    }
    if (!total) results.innerHTML = '<div class="res-empty">No results.</div>';
  }
  const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function highlightInContent(q) {
    if (!q) return;
    const ql = q.toLowerCase();
    const md = content.querySelector('.md');
    if (!md) return;
    const walker = document.createTreeWalker(md, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (!n.nodeValue.toLowerCase().includes(ql)) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (p.closest('pre, code, .mermaid, script, style')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const targets = []; let node;
    while ((node = walker.nextNode())) targets.push(node);
    let first = null;
    for (const t of targets) {
      const frag = document.createDocumentFragment();
      const txt = t.nodeValue; let last = 0; const low = txt.toLowerCase(); let i;
      while ((i = low.indexOf(ql, last)) >= 0) {
        frag.appendChild(document.createTextNode(txt.slice(last, i)));
        const m = document.createElement('mark'); m.className = 'find'; m.textContent = txt.slice(i, i + q.length);
        frag.appendChild(m); if (!first) first = m;
        last = i + q.length;
      }
      frag.appendChild(document.createTextNode(txt.slice(last)));
      t.parentNode.replaceChild(frag, t);
    }
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ============ TOC + scrollspy ============
  let tocLinks = [];
  function buildToc() {
    const heads = [...content.querySelectorAll('h1, h2, h3')];
    if (heads.length < 2) { tocEl.innerHTML = ''; tocLinks = []; return; }
    tocEl.innerHTML = '<div class="toc-title">Contents</div>';
    tocLinks = heads.map((h) => {
      const a = document.createElement('a');
      a.textContent = h.textContent;
      a.href = '#' + h.id;
      a.className = 'lvl-' + h.tagName[1];
      a.addEventListener('click', (e) => { e.preventDefault(); h.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      tocEl.appendChild(a);
      return { a, h };
    });
  }
  content.addEventListener('scroll', () => {
    if (!tocLinks.length || tocEl.hidden) return;
    let cur = tocLinks[0];
    for (const l of tocLinks) {
      if (l.h.getBoundingClientRect().top - content.getBoundingClientRect().top <= 60) cur = l; else break;
    }
    tocLinks.forEach((l) => l.a.classList.toggle('active', l === cur));
  });

  // ============ Import ============
  async function addFileObjects(fileObjs) {
    const reads = [];
    for (const f of fileObjs) {
      const path = f.webkitRelativePath || f.name;
      if (IMG_RE.test(f.name)) {
        if (!images.has(path)) images.set(path, { blob: f, url: URL.createObjectURL(f) });
        continue;
      }
      if (!MD_RE.test(f.name)) continue;
      if (files.some((x) => x.path === path)) continue;
      reads.push(f.text().then((text) => ({
        id: 'f' + Math.random().toString(36).slice(2),
        name: f.name, path, dir: dirname(path), text,
      })));
    }
    const added = await Promise.all(reads);
    files.push(...added);
    files.sort((a, b) => a.path.localeCompare(b.path));
    afterImport();
  }

  function afterImport() {
    renderTree();
    if (filter.value && searchModeBtn.dataset.mode === 'content') runContentSearch(filter.value);
    persistLibrary();
    if (!activeId && files.length) openFile(files[0].id);
  }

  // native (Android SAF) + desktop (Electron) bridges
  function nativeFolder() {
    const C = window.Capacitor;
    if (!C) return null;
    if (C.Plugins && C.Plugins.FolderPicker) return C.Plugins.FolderPicker;
    if (C.registerPlugin) { try { return C.registerPlugin('FolderPicker'); } catch (e) {} }
    return null;
  }
  function b64ToBytes(b64) {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function b64ToBlob(b64, mime) {
    return new Blob([b64ToBytes(b64)], { type: mime || 'application/octet-stream' });
  }

  async function importFolder() {
    if (window.desktopFS) {
      const r = await window.desktopFS.pickFolder();
      if (!r) return;
      ingestNative(r.items); folderRoot = r.root; startWatch();
      refreshBtn.hidden = false; return;
    }
    const np = nativeFolder();
    if (np) {
      try {
        const r = await np.pickFolder();
        if (r && r.items) ingestNative(r.items);
      } catch (e) { alert('Folder cancelled or error: ' + e.message); }
      return;
    }
    $('#folderInput').click();
  }

  // items: [{path, kind:'md'|'img', text?, base64?, mime?}]
  function ingestNative(items) {
    for (const it of items) {
      if (it.kind === 'img' || IMG_RE.test(it.path)) {
        if (!images.has(it.path) && it.base64) {
          const blob = b64ToBlob(it.base64, it.mime || MIME[extOf(it.path)]);
          images.set(it.path, { blob, url: URL.createObjectURL(blob) });
        }
        continue;
      }
      if (files.some((x) => x.path === it.path)) continue;
      let text = it.text;
      if (text == null && it.base64) { try { text = new TextDecoder().decode(b64ToBytes(it.base64)); } catch (e) { text = ''; } }
      files.push({ id: 'f' + Math.random().toString(36).slice(2), name: it.path.split('/').pop(), path: it.path, dir: dirname(it.path), text: text || '' });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    afterImport();
  }

  function startWatch() {
    if (!window.desktopFS || !window.desktopFS.watch || !folderRoot) return;
    if (watchStop) { try { watchStop(); } catch (e) {} }
    watchStop = window.desktopFS.watch(folderRoot, async () => {
      const r = await window.desktopFS.readFolder(folderRoot);
      if (!r) return;
      // refresh texts in place, keep active
      const activePath = files.find((f) => f.id === activeId)?.path;
      files = []; images.forEach((v) => URL.revokeObjectURL(v.url)); images.clear();
      ingestNative(r.items);
      const again = files.find((f) => f.path === activePath);
      if (again) openFile(again.id);
    });
  }

  $('#importFolder').addEventListener('click', importFolder);
  $('#importFiles').addEventListener('click', () => $('#filesInput').click());
  $('#folderInput').addEventListener('change', (e) => { addFileObjects([...e.target.files]); e.target.value = ''; });
  $('#filesInput').addEventListener('change', (e) => { addFileObjects([...e.target.files]); e.target.value = ''; });

  refreshBtn.addEventListener('click', async () => {
    if (window.desktopFS && folderRoot) {
      const r = await window.desktopFS.readFolder(folderRoot);
      if (r) { const ap = files.find((f) => f.id === activeId)?.path; files = []; images.forEach((v) => URL.revokeObjectURL(v.url)); images.clear(); ingestNative(r.items); const a = files.find((f) => f.path === ap); if (a) openFile(a.id); }
    }
  });

  $('#clearAll').addEventListener('click', async () => {
    files = []; activeId = null;
    images.forEach((v) => URL.revokeObjectURL(v.url)); images.clear();
    folderRoot = null; if (watchStop) { try { watchStop(); } catch (e) {} }
    renderTree(); runContentSearch('');
    currentName.textContent = 'No file open';
    content.innerHTML = '<div class="empty-state"><h1>📖 Markdown Reader</h1><p>Import a <b>folder</b> or <b>files</b>.</p></div>';
    tocEl.innerHTML = '';
    try { await tx('files', 'readwrite', (s) => s.clear()); await tx('images', 'readwrite', (s) => s.clear()); } catch (e) {}
    localStorage.removeItem('md-active'); localStorage.removeItem('md-root');
  });

  // drag & drop
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files.length) addFileObjects([...e.dataTransfer.files]);
  });

  // ============ Search box (name vs content) ============
  function applySearch() {
    const mode = searchModeBtn.dataset.mode;
    if (mode === 'content') {
      treeWrap.hidden = true; results.hidden = false;
      runContentSearch(filter.value.trim());
    } else {
      treeWrap.hidden = false; results.hidden = true;
      renderTree();
    }
  }
  filter.addEventListener('input', applySearch);
  searchModeBtn.addEventListener('click', () => {
    const next = searchModeBtn.dataset.mode === 'name' ? 'content' : 'name';
    searchModeBtn.dataset.mode = next;
    searchModeBtn.textContent = next === 'content' ? '📄' : '🔤';
    filter.placeholder = next === 'content' ? 'Search in text…' : 'Search file…';
    applySearch();
  });

  // ============ Sidebar / mobile ============
  const isMobile = () => window.matchMedia('(max-width: 720px)').matches;
  function setSidebar(hidden) { app.classList.toggle('sidebar-hidden', hidden); }
  if (isMobile()) setSidebar(true);
  $('#openSidebar').addEventListener('click', () => setSidebar(false));
  $('#closeSidebar').addEventListener('click', () => setSidebar(true));
  scrim.addEventListener('click', () => setSidebar(true));

  // ============ Settings: theme / font / width / toc ============
  function applyTheme(t) {
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    $('#hlTheme').href = t === 'light' ? 'vendor/hl/github.min.css' : 'vendor/hl/github-dark.min.css';
    try { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: t === 'light' ? 'default' : 'dark' }); } catch (e) {}
    localStorage.setItem('md-theme', t || '');
  }
  applyTheme(localStorage.getItem('md-theme') || '');
  $('#toggleTheme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? '' : 'light';
    applyTheme(cur);
    const f = files.find((x) => x.id === activeId);
    if (f) { f.rendered = null; openFile(f.id); }
  });

  let fontSize = parseInt(localStorage.getItem('md-font') || '16', 10);
  function applyFont() { document.documentElement.style.setProperty('--md-size', fontSize + 'px'); localStorage.setItem('md-font', fontSize); }
  applyFont();
  $('#fontUp').addEventListener('click', () => { fontSize = Math.min(28, fontSize + 1); applyFont(); });
  $('#fontDown').addEventListener('click', () => { fontSize = Math.max(11, fontSize - 1); applyFont(); });

  if (localStorage.getItem('md-wide') === '1') app.classList.add('wide');
  $('#toggleWide').addEventListener('click', (e) => {
    app.classList.toggle('wide');
    e.currentTarget.classList.toggle('on', app.classList.contains('wide'));
    localStorage.setItem('md-wide', app.classList.contains('wide') ? '1' : '0');
  });

  const tocBtn = $('#toggleToc');
  function applyToc(open) { tocEl.hidden = !open; tocBtn.classList.toggle('on', open); localStorage.setItem('md-toc', open ? '1' : '0'); }
  applyToc(localStorage.getItem('md-toc') === '1');
  tocBtn.addEventListener('click', () => applyToc(tocEl.hidden));

  $('#printBtn').addEventListener('click', () => window.print());

  // ============ Recent + Quick open ============
  let recent = JSON.parse(localStorage.getItem('md-recent') || '[]');
  function pushRecent(path) {
    recent = [path, ...recent.filter((p) => p !== path)].slice(0, 20);
    localStorage.setItem('md-recent', JSON.stringify(recent));
  }
  const qoOverlay = $('#qoOverlay');
  const qoInput = $('#qoInput');
  const qoList = $('#qoList');
  let qoItems = [], qoSel = 0;
  function openQuick() {
    if (!files.length) return;
    qoOverlay.hidden = false; qoInput.value = ''; renderQuick(''); qoInput.focus();
  }
  function closeQuick() { qoOverlay.hidden = true; }
  function renderQuick(q) {
    const ql = q.toLowerCase();
    let list;
    if (!ql) {
      const recentFiles = recent.map((p) => files.find((f) => f.path === p)).filter(Boolean);
      const rest = files.filter((f) => !recent.includes(f.path));
      list = [...recentFiles, ...rest];
    } else {
      list = files.filter((f) => f.path.toLowerCase().includes(ql))
        .sort((a, b) => a.name.toLowerCase().indexOf(ql) - b.name.toLowerCase().indexOf(ql));
    }
    qoItems = list.slice(0, 50); qoSel = 0;
    qoList.innerHTML = '';
    qoItems.forEach((f, i) => {
      const li = document.createElement('li');
      if (i === 0) li.classList.add('sel');
      li.innerHTML = `<span class="qo-name">${escapeHtml(f.name)}</span> <span style="opacity:.55">${escapeHtml(f.dir)}</span>`;
      li.addEventListener('click', () => { openFile(f.id); closeQuick(); });
      qoList.appendChild(li);
    });
  }
  function moveSel(d) {
    qoSel = Math.max(0, Math.min(qoItems.length - 1, qoSel + d));
    [...qoList.children].forEach((li, i) => li.classList.toggle('sel', i === qoSel));
    qoList.children[qoSel]?.scrollIntoView({ block: 'nearest' });
  }
  qoInput.addEventListener('input', () => renderQuick(qoInput.value));
  qoInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    else if (e.key === 'Enter') { const f = qoItems[qoSel]; if (f) { openFile(f.id); closeQuick(); } }
    else if (e.key === 'Escape') closeQuick();
  });
  qoOverlay.addEventListener('click', (e) => { if (e.target === qoOverlay) closeQuick(); });
  $('#quickOpen').addEventListener('click', openQuick);
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); openQuick(); }
    if (e.key === 'Escape' && !qoOverlay.hidden) closeQuick();
  });

  // expose ingest for native bridges (Android plugin / Electron preload may call directly)
  window.mdReader = { ingestNative, addFileObjects, openFile, get files() { return files; } };

  // ============ Service worker ============
  // Only on http(s) (web / Capacitor). On file:// (Electron) a SW breaks
  // navigation (fetch of file:// yields no Response), so skip + clean up.
  if ('serviceWorker' in navigator) {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    } else {
      navigator.serviceWorker.getRegistrations?.().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    }
  }

  // ============ Init / restore ============
  (async function init() {
    try {
      const savedRoot = localStorage.getItem('md-root');
      if (window.desktopFS && savedRoot) {
        const r = await window.desktopFS.readFolder(savedRoot);
        if (r && r.items && r.items.length) { folderRoot = savedRoot; ingestNative(r.items); startWatch(); refreshBtn.hidden = false; }
        else await loadSession();
      } else {
        await loadSession();
      }
    } catch (e) { /* ignore */ }
    renderTree();
    if (searchModeBtn.dataset.mode === 'content') applySearch();
    const ap = localStorage.getItem('md-active');
    const target = ap && files.find((f) => f.path === ap);
    if (target) openFile(target.id);
    else if (files.length) { /* leave empty state until click */ }
  })();
})();
