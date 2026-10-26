// I9-SYSTEM: LENGTH-CALC HOOK guard. Fails loudly if the hook's signature or contract changes, because _lib/system-report.js and the
// email/order-note wiring rely on exactly this shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mod from '../_lib/system-lengths.js';

const SAMPLE_INPUT = {
  position: 'rear', hubModel: 'Solix', erd: 568, spokeHoleDiameter: null,
  flangeDiameter: { left: 40, right: 52 }, flangeOffset: { left: 33, right: 20 },
  cross: { left: 1.4, right: 3.5 }, spokes: { left: 8, right: 16 }
};

test('calculateSystemSpokeLengths keeps its signature: one argument, named export', () => {
  assert.equal(typeof mod.calculateSystemSpokeLengths, 'function', 'export calculateSystemSpokeLengths is missing');
  assert.equal(mod.calculateSystemSpokeLengths.name, 'calculateSystemSpokeLengths');
  assert.equal(mod.calculateSystemSpokeLengths.length, 1, 'calculateSystemSpokeLengths(wheel) must take exactly one argument');
});

test('contract: returns null (method pending) or { left, right } numbers in mm', () => {
  const r = mod.calculateSystemSpokeLengths(SAMPLE_INPUT);
  if (r === null) return; // today
  assert.equal(typeof r, 'object');
  assert.ok(Number.isFinite(r.left) && Number.isFinite(r.right), 'left/right must be finite numbers (mm)');
  assert.ok(r.left > 100 && r.left < 400 && r.right > 100 && r.right < 400, 'lengths must be plausible spoke lengths');
});

test('the module keeps its documented exports and the grep-able markers', () => {
  for (const name of ['calculateSystemSpokeLengths', 'SYSTEM_LENGTHS_PENDING_TEXT', 'SYSTEM_SPOKE_ALLOWANCE_MM', 'SYSTEM_SPOKE_ROUNDING', 'SYSTEM_EFFECTIVE_CROSS_ADJUST']) {
    assert.ok(name in mod, `export ${name} is missing`);
  }
  assert.equal(mod.SYSTEM_LENGTHS_PENDING_TEXT, 'Spoke lengths for System hubs: not calculated (method pending)');
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_lib', 'system-lengths.js'), 'utf8');
  assert.ok(src.includes('// I9-SYSTEM: LENGTH-CALC HOOK'), 'marker comment removed');
  assert.ok(src.includes('I9-SYSTEM: TODO allowance mm'), 'TODO allowance marker removed');
});
