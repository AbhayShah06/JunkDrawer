const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('./server');
const { autoUpdater } = require('electron-updater');

let win, srv;

// Files opened from the OS ("Open with → Junk Drawer" on a PDF/Markdown/text file).
// We queue the absolute path; the local server hands its bytes to the renderer via
// /api/opened-file, which loads it into the read-only viewer.
let pendingOpenPath = null;
const OPENABLE = /\.(pdf|md|markdown|txt|text|log|csv|json)$/i;
const opener = { take: () => { const p = pendingOpenPath; pendingOpenPath = null; return p; } };
function queueOpen(p) {
  if (!p || !OPENABLE.test(p)) return;
  try { if (!fs.existsSync(p)) return; } catch { return; }
  pendingOpenPath = p;
  if (win) { try { win.focus(); win.webContents.focus(); } catch {} }
}
// On Windows the opened file arrives as a command-line argument; pick the last real, openable path.
function argvOpenPath(argv) {
  for (let i = argv.length - 1; i >= 1; i--) {
    const a = argv[i];
    if (a && !a.startsWith('-') && OPENABLE.test(a)) { try { if (fs.existsSync(a)) return a; } catch {} }
  }
  return null;
}

// ---- in-app auto-update. Windows only: electron-updater downloads the new build from
// the GitHub release and applies it on restart. macOS needs a signed app for Squirrel.Mac,
// so there it stays disabled and the renderer falls back to opening the release page.
// The renderer drives this through the local server (no preload/IPC needed). ----
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
let upState = { status: 'idle', version: '', percent: 0, error: '' };
autoUpdater.on('update-available', i => { upState = { status: 'available', version: i.version, percent: 0, error: '' }; });
autoUpdater.on('update-not-available', () => { if (upState.status === 'idle') upState.status = 'none'; });
autoUpdater.on('download-progress', p => { upState.status = 'downloading'; upState.percent = p.percent || 0; });
autoUpdater.on('update-downloaded', i => { upState = { status: 'ready', version: i.version, percent: 100, error: '' }; });
autoUpdater.on('error', e => { upState.status = 'error'; upState.error = String((e && e.message) || e); });
const updater = {
  enabled: false,                          // set true at launch on packaged Windows
  state: () => upState,
  check: async () => { try { await autoUpdater.checkForUpdates(); } catch (e) { upState.status = 'error'; upState.error = String((e && e.message) || e); } },
  download: async () => {
    upState = { status: 'downloading', version: upState.version, percent: 0, error: '' };
    try { await autoUpdater.checkForUpdates(); await autoUpdater.downloadUpdate(); }
    catch (e) { upState.status = 'error'; upState.error = String((e && e.message) || e); }
  },
  apply: () => { setImmediate(() => { try { autoUpdater.quitAndInstall(); } catch {} }); },
};

// macOS uninstall — the analogue of the Windows NSIS uninstaller (Windows already has its
// own in Add/Remove Programs). Confirms, then moves the .app to the Trash, clears the app's
// saved data, and quits. User files are never touched.
async function doUninstall() {
  const pick = dialog.showMessageBoxSync(win || undefined, {
    type: 'warning', buttons: ['Uninstall', 'Cancel'], defaultId: 1, cancelId: 1,
    message: 'Uninstall Junk Drawer?',
    detail: 'This moves Junk Drawer to the Trash and clears its saved settings. Your files are not touched.',
  });
  if (pick !== 0) return;
  try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch {}
  try {
    let p = app.getPath('exe');                 // .../Junk Drawer.app/Contents/MacOS/Junk Drawer
    const i = p.indexOf('.app/');
    if (i !== -1) p = p.slice(0, i + 4);        // trim to the .app bundle
    await shell.trashItem(p);                   // macOS allows trashing a running bundle
  } catch {}
  app.quit();
}

// Only macOS gets a custom menu (for the Uninstall item). Windows keeps its default menu.
// The standard edit/view/window roles are kept so copy-paste/shortcuts still work.
function buildAppMenu() {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' },
      { type: 'separator' },
      // only in the installed app — in dev this would trash Electron.app
      ...(app.isPackaged ? [{ label: 'Uninstall Junk Drawer…', click: () => doUninstall() }, { type: 'separator' }] : []),
      { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { role: 'quit' },
    ]},
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
}

const appRoot = () => app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');
// Packaged: electron-builder's per-platform extraResources copies resources/bin/<os> -> Resources/bin.
// Dev (npm start): point at the same per-platform source folder so bundled-binary lookup works locally too.
const devBinSub = process.platform === 'win32' ? 'win' : 'mac';
const binDir  = () => app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'resources', 'bin', devBinSub);

async function create() {
  // On macOS, offer to move out of the disk image / Downloads into /Applications on first
  // run (the Mac analogue of a clean install — keeps the app off the DMG). Relaunches if moved.
  if (process.platform === 'darwin' && app.isPackaged && !app.isInApplicationsFolder()) {
    const pick = dialog.showMessageBoxSync({
      type: 'question', buttons: ['Move to Applications', 'Not Now'], defaultId: 0, cancelId: 1,
      message: 'Move Junk Drawer to your Applications folder?',
      detail: 'Recommended — keeps the app handy so you can eject and delete the disk image.',
    });
    if (pick === 0) { try { if (app.moveToApplicationsFolder()) return; } catch {} }
  }
  buildAppMenu();
  // Don't nag about updates while developing (npm start) — only the packaged app checks.
  process.env.JD_DEV = app.isPackaged ? '' : '1';
  updater.enabled = app.isPackaged && process.platform === 'win32';
  const { port, server } = await startServer(appRoot(), binDir(), updater, opener);
  srv = server;
  // Launched by opening a file? Queue it so the renderer picks it up on first load.
  if (!pendingOpenPath) { const initial = argvOpenPath(process.argv); if (initial) pendingOpenPath = initial; }
  if (updater.enabled) updater.check();
  win = new BrowserWindow({
    width: 1180, height: 840, minWidth: 720, minHeight: 560,
    title: 'Junk Drawer', backgroundColor: '#23262b', show: false,
    icon: path.join(__dirname, '..', 'icon.ico'),
    // Pin the renderer-hardening flags explicitly so a future edit can't silently regress
    // the sandbox. The renderer processes untrusted file contents + pasted/dragged URLs.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  const appOrigin = `http://127.0.0.1:${port}`;
  win.loadURL(`${appOrigin}/index.html`);
  // Lock the main frame to our loopback origin — a stray in-page navigation (or a
  // javascript:/file: href) can't take the window off-app.
  const blockNav = (e, url) => { if (!url.startsWith(appOrigin + '/')) e.preventDefault(); };
  win.webContents.on('will-navigate', blockNav);
  win.webContents.on('will-redirect', blockNav);
  // open real external links (LinkedIn, X) in the system browser, not the app window.
  // Parse-and-allowlist the scheme: shell.openExternal hands the OS the URL, so only
  // ever pass a well-formed http/https URL (never file:, smb:, javascript:, etc.).
  win.webContents.setWindowOpenHandler(({ url }) => {
    try { const u = new URL(url); if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(url); }
    catch {}
    return { action: 'deny' };
  });
}

// The app uses no <webview> tags; forbid attaching one (defense-in-depth).
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

// Single instance: a second "Open with → Junk Drawer" should focus this window and queue
// the new file, not launch a duplicate app.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => { const p = argvOpenPath(argv); if (p) queueOpen(p); else if (win) { try { win.focus(); } catch {} } });
  app.on('open-file', (e, p) => { e.preventDefault(); queueOpen(p); });   // macOS delivers file-opens here
  app.whenReady().then(create);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) create(); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('quit', () => { try { srv && srv.close(); } catch {} });
