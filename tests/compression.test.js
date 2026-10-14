'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCompressionArgs, buildTwoPassArgs } = require('../electron/compression');

test('recommended quality preserves resolution and frame rate by omitting scaling and fps filters', () => {
  const args = buildCompressionArgs({ mode: 'quality' });
  assert.ok(args.includes('-crf'));
  assert.ok(args.includes('20'));
  assert.ok(args.includes('slow'));
  assert.ok(!args.some(arg => /scale=|fps=/.test(arg)));
});

test('fit under size creates native two-pass arguments without scaling or fps changes', () => {
  const plan = buildTwoPassArgs({ duration: 120, targetMb: 25 });
  assert.ok(plan.pass1.includes('-pass') && plan.pass1.includes('1'));
  assert.ok(plan.pass2.includes('-pass') && plan.pass2.includes('2'));
  assert.ok(plan.pass1.includes('jd-pass') && plan.pass2.includes('jd-pass'));
  assert.ok(plan.pass2.includes(`${plan.audioKbps}k`));
  assert.ok(![...plan.pass1, ...plan.pass2].some(arg => /scale=|fps=/.test(arg)));
});

test('browser fallback remains explicitly one-pass and preserves resolution/fps', () => {
  const args = buildCompressionArgs({ mode: 'size', duration: 120, targetMb: 25 });
  assert.ok(args.includes('-b:v'));
  assert.ok(!args.includes('-pass'));
  assert.ok(!args.some(arg => /scale=|fps=/.test(arg)));
});

test('compression validation rejects invalid durations, targets, and impossible low targets with structured codes', () => {
  for (const [input, code] of [
    [{ mode: 'size', duration: 0, targetMb: 20 }, 'bad-duration'],
    [{ mode: 'size', duration: 20, targetMb: NaN }, 'bad-target'],
    [{ mode: 'size', duration: 86400, targetMb: 1 }, 'target-unrealistic'],
  ]) assert.throws(() => buildCompressionArgs(input), error => error.code === code);
});
