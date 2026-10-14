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
  assert.match(source, /modeTools\(\)\.slice\(0,6\)/);
  assert.match(source, /e\.key\.toLowerCase\(\)==='k'/);
  assert.doesNotMatch(source, /linear-gradient\(90deg,var\(--title1\),var\(--title2\)\)/);
});

test('workspace navigation remains discoverable and Video Studio labels project editing as planned', () => {
  for (const id of ['workspacesBtn', 'workspacesMenu', 'workspaceLaunchers', 'workspaceView', 'drawerBrowser'])
    assert.ok(source.includes(`id="${id}"`), `missing navigation surface ${id}`);
  for (const name of ['Video Studio', 'Photo Desk', 'PDF Desk', 'Audio Desk', 'Download Desk', 'Developer Bench'])
    assert.ok(source.includes(`name:'${name}'`), `missing workspace ${name}`);
  assert.match(source, /Project editing · planned/);
  assert.match(source, /This needs Video Studio because it changes multiple parts of the video/);
  assert.match(source, /Edit in Video Studio/);
  assert.match(source, /Selected video ready/);
  assert.match(source, /function leaveWorkspace\(\)/);
  assert.match(source, /const receipt=\$\('#receipt'\);receipt\.style\.display=state\.file\?'block':'none'/);
  assert.match(source, /const needsStudio=/);
  assert.match(source, /openWorkspace\('video'\)/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /async function systemProfile\(\)/);
  assert.match(source, /fetch\('\/api\/system-profile'\)/);
  assert.doesNotMatch(source, /profileLine|profile-line|wstatus|status:'(?:LIGHT|ADAPTS|MODEL)'/);
  assert.match(source, /name:'Video Studio',desc:[^\n]+cats:\['video'\]/);
});
