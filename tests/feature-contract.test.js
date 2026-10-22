const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const categories = new Set(['image', 'pdf', 'doc', 'video', 'audio', 'web', 'data', 'arc', 'weird', 'dev']);

function registeredTools() {
  const starts = [];
  const marker = 'add({';
  let at = source.indexOf(marker);
  while (at !== -1) {
    starts.push(at);
    at = source.indexOf(marker, at + marker.length);
  }
  return starts.map((start, index) => {
    const end = starts[index + 1] || source.indexOf('/* ---- workflow modes', start);
    const block = source.slice(start, end > start ? end : source.length);
    const read = key => {
      const match = new RegExp(`\\b${key}:'([^']*)'`).exec(block);
      return match && match[1];
    };
    return {
      name: read('nm'),
      category: read('cat'),
      description: read('ds'),
      details: read('more'),
      block,
    };
  });
}

test('every registered UI feature has a complete, unique contract', () => {
  const tools = registeredTools();
  assert.ok(tools.length >= 40, `expected the full tool catalog, found only ${tools.length}`);
  const names = new Set();
  for (const tool of tools) {
    assert.ok(tool.name, 'a registered feature is missing its name');
    assert.ok(!names.has(tool.name), `duplicate feature name: ${tool.name}`);
    names.add(tool.name);
    assert.ok(categories.has(tool.category), `${tool.name} has an unknown category: ${tool.category}`);
    assert.ok(tool.description && tool.description.length >= 8, `${tool.name} needs a useful short description`);
    assert.ok(tool.details && tool.details.length >= 20, `${tool.name} needs usage/error guidance`);
    assert.match(tool.block, /\b(kinds|input):/, `${tool.name} does not declare its accepted input`);
    assert.match(tool.block, /\b(run|custom|mode):/, `${tool.name} has no execution path`);
  }
});

test('all three UI execution paths catch feature failures', () => {
  // File, text, and URL workflows are the shared choke points for every registered tool.
  assert.match(source, /try\{ await t\.run\(fileOrFiles,get\(\)\); \}catch\(e\)\{ fail\(e\); \}/);
  assert.match(source, /try\{ await t\.run\(ta\.value, get\(\)\); \}catch\(e\)\{ fail\(e\); \}/);
  assert.match(source, /renderUrl\(t\)[\s\S]*?catch\(e\)\{[^}]*fail\(e\)/);
});

test('the friendly error layer covers core failure families', () => {
  for (const signal of [
    'password', 'invalid data', 'unexpected token', 'tool-failed',
    'ytdlp-missing', 'ffmpeg-missing', 'no qr',
  ]) {
    assert.ok(source.toLowerCase().includes(signal), `missing friendly handling for ${signal}`);
  }
});

test('the home screen exposes drawers instead of hiding the catalog', () => {
  assert.match(source, /id="drawerBrowser"/);
  assert.match(source, /function renderDrawerBrowser\(selected\)/);
  assert.ok(source.includes("task('Convert files'"));
  assert.ok(source.includes("task('Make files smaller'"));
  assert.ok(source.includes('id="integrationHome"'));
  assert.match(source, /e\.key\.toLowerCase\(\)==='k'/);
  assert.doesNotMatch(source, /linear-gradient\(90deg,var\(--title1\),var\(--title2\)\)/);
});

test('file tools replace editor and viewer entry points', () => {
  assert.doesNotMatch(source, /function openVideoStudio|function openViewer|openWorkspace\(/);
  for (const name of ['Convert Video', 'Convert Audio', 'Convert Unknown Media', 'Batch Convert Media']) assert.ok(source.includes("nm:'"+name+"'"));
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));
  assert.equal(pkg.build.fileAssociations,undefined);
});
