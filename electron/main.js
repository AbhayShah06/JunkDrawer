const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('./server');
const { createUpdater } = require('./updates');
const {createFileInbox,selectedPaths,createDesktopIntegration}=require('./desktop-integration');
const fileInbox=createFileInbox();
const desktopIntegration=createDesktopIntegration({app,shell});

let win, srv;

// Resolve the optional updater only after the local window is ready.
const updater = createUpdater(() => require('electron-updater').autoUpdater, error => {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'update-errors.log'), `${new Date().toISOString()} ${error?.stack || error}\n`);
  } catch {}
});
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
  desktopIntegration.init();
  fileInbox.queue(selectedPaths(process.argv));
  // Don't nag about updates while developing (npm start) — only the packaged app checks.
  process.env.JD_DEV = app.isPackaged ? '' : '1';

  const { port, server } = await startServer(appRoot(), binDir(), updater, fileInbox,
    path.join(app.getPath('userData'), 'models'), desktopIntegration); // download-on-first-use models (whisper) live outside the app dir so updates don't re-download them
  srv = server;

  win = new BrowserWindow({
    width: 1180, height: 840, minWidth: 720, minHeight: 560,
    title: 'Junk Drawer', backgroundColor: '#f7f8fa', show: false,
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
  win.once('ready-to-show', () => {
    win.show();
    updater.init(app.isPackaged && process.platform === 'win32');
    if (updater.enabled) void updater.check();
  });
  // The app needs no web permissions (camera/mic/geolocation/notifications/etc.). Deny every
  // permission request outright so untrusted file content can never prompt for or gain one.
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
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

// Keep one utility window per user.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => { fileInbox.queue(selectedPaths(argv)); if (win) { if(win.isMinimized())win.restore();win.show();win.focus(); } });
  app.whenReady().then(create).catch(error => {
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'startup-errors.log'), String(error?.stack || error) + '\n'); } catch {}
    dialog.showErrorBox('Junk Drawer could not start', String(error?.message || error));
    app.quit();
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) create(); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('quit', () => { try { srv && srv.close(); } catch {} });
