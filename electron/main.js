const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server');

let win, srv;

const appRoot = () => app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');
const binDir  = () => app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'resources', 'bin');

async function create() {
  const { port, server } = await startServer(appRoot(), binDir());
  srv = server;
  win = new BrowserWindow({
    width: 1180, height: 840, minWidth: 720, minHeight: 560,
    title: 'Junk Drawer', backgroundColor: '#23262b', show: false,
    webPreferences: { contextIsolation: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://127.0.0.1:${port}/index.html`);
  // open real external links (LinkedIn, X) in the system browser, not the app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(create);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) create(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('quit', () => { try { srv && srv.close(); } catch {} });
