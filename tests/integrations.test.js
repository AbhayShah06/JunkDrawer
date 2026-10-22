const test = require('node:test');
const assert = require('node:assert/strict');
const { integrationCatalog, validateCatalog } = require('../electron/integrations');

test('every integration declares the baseline error checks', () => {
  const catalog = integrationCatalog();
  assert.deepEqual(validateCatalog(catalog), { ok: true });
  for (const provider of catalog.providers) {
    for (const check of ['availability', 'input', 'output', 'cancel', 'disk-space']) {
      assert.ok(provider.checks.includes(check), `${provider.id} is missing ${check}`);
    }
  }
});

test('runtime availability is reported without changing the provider contract', () => {
  const catalog = integrationCatalog({ ffmpeg: false, 'yt-dlp': true });
  assert.equal(catalog.providers.find(provider => provider.id === 'ffmpeg').available, false);
  assert.equal(catalog.providers.find(provider => provider.id === 'yt-dlp').available, true);
  assert.ok(!catalog.providers.some(provider => provider.role === 'video-editor'));
});
