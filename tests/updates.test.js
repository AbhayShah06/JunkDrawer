const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater } = require('../electron/updates');

test('updater dependency failure is nonfatal and file tools can keep starting', async () => {
  const updater = createUpdater(() => { throw new Error('updater unavailable'); });
  assert.doesNotThrow(() => updater.init(true));
  assert.equal(updater.enabled, false);
  assert.match(updater.state().error, /updater unavailable/);
  await updater.check(); await updater.download(); updater.apply();
});

test('development never loads the optional updater', () => {
  const updater = createUpdater(() => { assert.fail('must not load'); });
  updater.init(false);
  assert.equal(updater.enabled, false);
});

test('network rejection and emitted updater errors remain recoverable', async () => {
  const engine = new EventEmitter();
  engine.checkForUpdates = async () => { throw new Error('offline'); };
  const updater = createUpdater(() => engine);
  updater.init(true);
  await updater.check();
  assert.equal(updater.state().status, 'error');
  assert.equal(engine.autoInstallOnAppQuit, false);
  assert.doesNotThrow(() => engine.emit('error', new Error('invalid update metadata')));
  engine.emit('update-available', { version: '1.5.2' });
  assert.equal(updater.state().status, 'available');
});

test('installation requires a fully downloaded update and catches installer failure', async () => {
  const engine = new EventEmitter(); let installs = 0;
  engine.quitAndInstall = () => { installs++; throw new Error('installer unavailable'); };
  const updater = createUpdater(() => engine); updater.init(true);
  updater.apply(); await new Promise(setImmediate); assert.equal(installs, 0);
  engine.emit('update-downloaded', { version: '1.5.2' });
  updater.apply(); await new Promise(setImmediate);
  assert.equal(installs, 1); assert.match(updater.state().error, /installer unavailable/);
});
