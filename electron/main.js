const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server');

let win, srv;

const appRoot = () => app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');
// Packaged: electron-builder's per-platform extraResources copies resources/bin/<os> -> Resources/bin.
// Dev (npm start): point at the same per-platform source folder so bundled-binary lookup works locally too.
const devBinSub = process.platform === 'win32' ? 'win' : 'mac';
const binDir  = () => app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'resources', 'bin', devBinSub);

async function create() {
  // Don't nag about updates while developing (npm start) — only the packaged app checks.
  process.env.JD_DEV = app.isPackaged ? '' : '1';
  const { port, server } = await startServer(appRoot(), binDir());
  srv = server;
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

app.whenReady().then(create);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) create(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('quit', () => { try { srv && srv.close(); } catch {} });
