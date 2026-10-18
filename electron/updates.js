// Updating is optional: dependency, network or installer failures must never
// prevent the local file tools from opening.
function createUpdater(load, report = () => {}) {
  let engine = null;
  let state = { status: 'idle', version: '', percent: 0, error: '' };
  const fail = error => {
    state = { ...state, status: 'error', error: String(error?.message || error) };
    report(error);
  };
  const updater = {
    enabled: false,
    state: () => ({ ...state }),
    init(enabled) {
      if (!enabled || engine) return;
      try {
        const candidate = load();
        candidate.autoDownload = false;
        // Install only after the user explicitly chooses Restart and install.
        candidate.autoInstallOnAppQuit = false;
        candidate.on('error', fail);
        candidate.on('update-available', info => { state = { status: 'available', version: info.version, percent: 0, error: '' }; });
        candidate.on('update-not-available', () => { state = { status: 'none', version: '', percent: 0, error: '' }; });
        candidate.on('download-progress', info => { state = { ...state, status: 'downloading', percent: info.percent || 0 }; });
        candidate.on('update-downloaded', info => { state = { status: 'ready', version: info.version, percent: 100, error: '' }; });
        engine = candidate;
        updater.enabled = true;
      } catch (error) { fail(error); }
    },
    async check() {
      if (!engine) return;
      try { await engine.checkForUpdates(); } catch (error) { fail(error); }
    },
    async download() {
      if (!engine) return;
      state = { status: 'downloading', version: state.version, percent: 0, error: '' };
      try { await engine.checkForUpdates(); await engine.downloadUpdate(); } catch (error) { fail(error); }
    },
    apply() {
      if (!engine || state.status !== 'ready') return;
      setImmediate(() => { try { engine.quitAndInstall(); } catch (error) { fail(error); } });
    },
  };
  return updater;
}
module.exports = { createUpdater };
