// SPOKE NUMBERING, JERRY'S CONVENTION (Nov 13 2026), behind the flag SPOKE_NUMBERING_JERRY=on (default OFF).
// With the flag OFF everything is byte for byte what it was (the existing order-sheet and spoke-numbering tests keep passing untouched). With the flag ON only the sheet's spoke numbers
// (and its numbering label / version) change: the high-tension numbers stay on the same spokes, the low-tension side is renumbered, 2:1 wheels are not touched, emails and notes carry
// no spoke numbers and stay identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NUMBERING, NUMBERING_JERRY, NUMBERING_FLAG, jerryNumberingOn, numberingFor, spokeNumber, numberSpokes } from '../_lib/spoke-numbering.js';
import { geometry } from '../_lib/studio-geometry.js';
import { buildOrderSheet } from '../_lib/order-sheet.js';
import { findSystemBuildRecipe, systemWheels } from '../_lib/system-build.js';
import { findStandardStudioRecipe } from '../_lib/standard-build.js';
import { SYSTEM_SAMPLES, STANDARD_STUDIO_SAMPLES } from '../samples/index.js';
import { runCalculationEngine } from '../api/index.js';
import { runWebhook, createMock, loadSample, loadMockShopify } from './helpers/webhook-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466-numbering-jerry.json'), 'utf8'));
const goldenV1 = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466-numbering.json'), 'utf8'));
const order1466 = () => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const AT = '2026-11-13T12:00:00.000Z';
const ON = { [NUMBERING_FLAG]: 'on' };
const wheels1466 = () => { const o = order1466(); return systemWheels(findSystemBuildRecipe(o).recipe, null, o); };
const geomOf = (w) => geometry({ wheels: { [w.position]: w.config } })[w.position];
const norm = (a) => ((a % 360) + 360) % 360;
const HIGH = { front: 'rotor', rear: 'drive' };

// An independent derivation that physically "flips the wheel": it does not use _lib/spoke-numbering.js.
function byFlipping(position, geom) {
  const high = HIGH[position], low = high === 'rotor' ? 'drive' : 'rotor';
  const a = (p) => norm(high === 'rotor' ? 360 - p.rim : p.rim);                      // the rim hole as seen from the high-tension face, clockwise from 12, valve at 180
  const res = {};
  geom[high].map((p, i) => ({ i, d: norm(a(p) - 180) })).sort((x, y) => x.d - y.d).forEach((p, idx) => { res[high + p.i] = 2 + 2 * idx; });
  const flipped = geom[low].map((p, i) => ({ i, d: norm(norm(360 - a(p)) - 180) })).sort((x, y) => x.d - y.d); // the same holes in the flipped view: clockwise distance from the valve
  [flipped[0], ...flipped.slice(1).reverse()].forEach((p, idx) => { res[low + p.i] = 1 + 2 * idx; });              // 1 = first to the left of the valve, then counter-clockwise
  return res;
}

test('flag: only the exact word "on" (any case, spaces ignored) switches Jerry\'s convention on; everything else, and no variable at all, is OFF', () => {
  assert.equal(jerryNumberingOn({}), false);
  assert.equal(jerryNumberingOn(undefined), false);
  for (const v of ['on', 'ON', ' On ']) assert.equal(jerryNumberingOn({ [NUMBERING_FLAG]: v }), true, v);
  for (const v of ['off', '', '1', 'true', 'yes', 'onn', 'no']) assert.equal(jerryNumberingOn({ [NUMBERING_FLAG]: v }), false, v);
  assert.equal(numberingFor({}), NUMBERING); assert.equal(numberingFor(ON), NUMBERING_JERRY);
  assert.equal(NUMBERING_FLAG, 'SPOKE_NUMBERING_JERRY');
  assert.equal(process.env[NUMBERING_FLAG], undefined, 'this test run does not have the flag set');
});

test('settings: version 2, provisional, the rule is written in the settings object and version 1 is untouched', () => {
  assert.equal(NUMBERING.version, 1); assert.equal(NUMBERING.label, 'numbering version 1, provisional');
  assert.equal(NUMBERING_JERRY.version, 2); assert.equal(NUMBERING_JERRY.status, 'provisional'); assert.match(NUMBERING_JERRY.label, /version 2/); assert.match(NUMBERING_JERRY.label, /provisional/);
  assert.deepEqual(NUMBERING_JERRY.highSide, { front: 'rotor', rear: 'drive' }); assert.deepEqual(NUMBERING_JERRY.first, { high: 2, low: 1 });
  assert.match(NUMBERING_JERRY.rule, /spoke 2 is the first spoke to the left of the valve/); assert.match(NUMBERING_JERRY.rule, /counter-clockwise/);
});

test('golden: order #1466 numbered in Jerry\'s convention (front 28h, rear 32h) equals the table derived by physically flipping the wheel', () => {
  for (const w of wheels1466()) {
    const list = numberSpokes({ position: w.position, geom: geomOf(w), colors: w.colors, numbering: NUMBERING_JERRY });
    assert.deepEqual(list.map((s) => [s.number, s.side, s.color]), golden[w.position], `${w.position}: spoke table`);
    assert.equal(golden[w.position].length, w.total);
  }
});

test('#1466: the number-to-color table equals the provisional version-1 table (the patterns are symmetric), but the low-tension numbers sit on different spokes', () => {
  for (const w of wheels1466()) {
    assert.deepEqual(golden[w.position], goldenV1[w.position], `${w.position}: same sides and colors by number`);
    const geom = geomOf(w);
    const v1 = numberSpokes({ position: w.position, geom, colors: w.colors, numbering: NUMBERING });
    const v2 = numberSpokes({ position: w.position, geom, colors: w.colors, numbering: NUMBERING_JERRY });
    const key = (s) => `${s.side}${s.k}`; const m1 = new Map(v1.map((s) => [key(s), s.number])), m2 = new Map(v2.map((s) => [key(s), s.number]));
    const high = HIGH[w.position];
    for (const s of v1) { if (s.side === high) assert.equal(m2.get(key(s)), m1.get(key(s)), `${w.position}: high-tension spoke ${key(s)} keeps its number`); }
    assert.ok(v1.some((s) => s.side !== high && m2.get(key(s)) !== m1.get(key(s))), `${w.position}: the low-tension side is renumbered`);
    assert.equal(m2.get(`${NUMBERING_JERRY.highSide[w.position] === 'rotor' ? 'drive' : 'rotor'}${v2.find((s) => s.number === 1).k}`), 1);
  }
});

test('properties on every 1:1 wheel: matches the flip-the-wheel derivation, numbers 1..N once, high side even, low odd, and the numbers run in ONE direction around the rim', () => {
  let checked = 0;
  for (const pos of ['front', 'rear']) for (const n of [10, 12, 14, 16, 18]) for (const cross of [0, 1, 2, 3]) {
    const cfg = { erd: 600, rimHoles: 2 * n, drive: { n, pcd: 50, cross }, rotor: { n, pcd: 50, cross } };
    const geom = geometry({ wheels: { [pos]: cfg } })[pos];
    const list = numberSpokes({ position: pos, geom, colors: { drive: Array(n).fill('x'), rotor: Array(n).fill('x') }, numbering: NUMBERING_JERRY });
    assert.deepEqual(list.map((s) => s.number), Array.from({ length: 2 * n }, (_, i) => i + 1), `${pos} ${n} ${cross}: 1..N`);
    const phys = byFlipping(pos, geom);
    for (const s of list) assert.equal(s.number, phys[s.side + s.k], `${pos} ${n} cross ${cross}: ${s.side} ${s.k}`);
    const high = HIGH[pos];
    assert.ok(list.every((s) => (s.side === high) === (s.number % 2 === 0)), `${pos} ${n}: high side even, low side odd`);
    // one direction: seen from the high-tension face, going clockwise starting at spoke 1 the numbers rise by one at every step (alternating sides), no jump back
    const a = (s) => norm(high === 'rotor' ? 360 - geom[s.side][s.k].rim : geom[s.side][s.k].rim);
    const byNum = [...list].sort((x, y) => x.number - y.number);
    let wrap = 0; for (let i = 0; i < byNum.length; i++) { const cw = norm(a(byNum[(i + 1) % byNum.length]) - a(byNum[i])); assert.ok(cw > 0, `${pos} ${n}: step ${i + 1}->${i + 2} is clockwise`); wrap += cw; }
    assert.ok(Math.abs(wrap - 360) < 1e-6, `${pos} ${n}: one full turn in total`);
    // spoke 2 is the first high-tension spoke after the valve, spoke 1 is the low-tension spoke just before it
    const dist = (s) => norm(a(s) - 180);
    const s2 = byNum[1], s1 = byNum[0];
    assert.ok(list.filter((s) => s.side === high).every((s) => dist(s2) <= dist(s) + 1e-9), `${pos} ${n}: spoke 2 is the first high-tension spoke clockwise of the valve`);
    assert.ok(list.filter((s) => s.side !== high).every((s) => dist(s1) >= dist(s) - 1e-9), `${pos} ${n}: spoke 1 is the last low-tension spoke before the valve`);
    checked++;
  }
  assert.equal(checked, 40);
});

test('2:1 wheels (unequal sides) are NOT changed by the flag: same numbers and the same "Drive 3" labels as version 1', () => {
  let n = 0;
  for (const [name, o] of Object.entries(SYSTEM_SAMPLES)) {
    if (!/^solix/.test(name)) continue;
    const off = buildOrderSheet({ orderData: clone(o), calculatedAt: AT, env: {} });
    const on = buildOrderSheet({ orderData: clone(o), calculatedAt: AT, env: ON });
    assert.deepEqual(on.wheels, off.wheels, name);
    assert.ok(on.wheels.every((w) => w.ratio === '2:1') && on.wheels.every((w) => /^(Drive|Rotor) \d+$/.test(w.spokes[0].text)), name);
    assert.equal(on.numberingVersion, 2, 'the header still says which convention is on'); n++;
  }
  assert.ok(n >= 4);
});

test('sheet, flag OFF (no variable, "off", or an unknown word): identical to before, version 1; flag ON: only the numbering header and the spoke numbers differ', () => {
  const base = buildOrderSheet({ orderData: order1466(), calculatedAt: AT });
  assert.equal(base.numbering.label, 'numbering version 1, provisional'); assert.equal(base.numberingVersion, 1);
  for (const env of [{}, { [NUMBERING_FLAG]: 'off' }, { [NUMBERING_FLAG]: 'yes' }]) assert.deepEqual(buildOrderSheet({ orderData: order1466(), calculatedAt: AT, env }), base, JSON.stringify(env));
  const on = buildOrderSheet({ orderData: order1466(), calculatedAt: AT, env: ON });
  assert.equal(on.numberingVersion, 2); assert.equal(on.numbering.version, 2); assert.equal(on.numbering.label, NUMBERING_JERRY.label); assert.equal(on.numbering.rule, NUMBERING_JERRY.rule); assert.equal(on.numbering.status, 'provisional');
  assert.deepEqual(Object.keys(on.numbering), Object.keys(base.numbering), 'same shape');
  const strip = (s) => { const c = clone(s); delete c.numbering; delete c.numberingVersion; for (const w of c.wheels) { for (const sp of w.spokes) { delete sp.number; delete sp.text; } for (const side of ['drive', 'rotor']) for (const it of w.lists[side]) { delete it.number; delete it.text; } } return c; };
  const a = strip(on), b = strip(base);
  for (const w of a.wheels) { w.spokes.sort((x, y) => (x.side + x.k).localeCompare(y.side + y.k)); }
  for (const w of b.wheels) { w.spokes.sort((x, y) => (x.side + x.k).localeCompare(y.side + y.k)); }
  assert.deepEqual(a.kind, b.kind);
  assert.deepEqual(a.wheels.map((w) => w.spokes.map((s) => [s.side, s.k, s.color, s.high])), b.wheels.map((w) => w.spokes.map((s) => [s.side, s.k, s.color, s.high])), 'same spokes, colors and sides');
  assert.deepEqual({ ...a, wheels: null }, { ...b, wheels: null }, 'everything outside the wheel lists is identical (lengths, order list, warnings, images)');
  assert.deepEqual(a.wheels.map((w) => ({ ...w, spokes: null, lists: null })), b.wheels.map((w) => ({ ...w, spokes: null, lists: null })), 'wheel facts, lengths, counts, images, redraw data identical');
  // the numbers on the sheet are the golden ones, and the lists are in number order
  for (const w of on.wheels) {
    assert.deepEqual(w.spokes.map((s) => [s.number, s.side, s.color]), golden[w.position], w.position);
    for (const side of ['drive', 'rotor']) { const nums = w.lists[side].map((i) => i.number); assert.deepEqual(nums, [...nums].sort((x, y) => x - y), `${w.position} ${side} list is in number order`); }
  }
});

test('System sample with a 2-color pattern and a Standard Studio sample: flag ON changes only the numbers; the high-tension numbers stay on the same spokes', () => {
  const sys = SYSTEM_SAMPLES['hydra2-wheelset-32f-32r'];
  const md = (o) => new Map(Object.entries(o._sample.metafields));
  const std = STANDARD_STUDIO_SAMPLES['std-steel-front-32h-3cross-two-colors'];
  const stdSheet = (env) => { const componentData = md(std); const rec = findStandardStudioRecipe(std).recipe; return buildOrderSheet({ orderData: clone(std), componentData, buildReport: runCalculationEngine(rec, componentData), calculatedAt: AT, env }); };
  const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
  try {
    for (const [name, off, on] of [['system 2-color', buildOrderSheet({ orderData: clone(sys), calculatedAt: AT, env: {} }), buildOrderSheet({ orderData: clone(sys), calculatedAt: AT, env: ON })], ['standard studio', stdSheet({}), stdSheet(ON)]]) {
      assert.equal(off.numberingVersion, 1, name); assert.equal(on.numberingVersion, 2, name);
      for (let i = 0; i < off.wheels.length; i++) {
        const wo = off.wheels[i], wn = on.wheels[i];
        assert.deepEqual(wn.spokes.map((s) => [s.side, s.k, s.color, s.high]).sort(), wo.spokes.map((s) => [s.side, s.k, s.color, s.high]).sort(), `${name} ${wo.position}: same spokes`);
        const n = wn.spokes.map((s) => s.number).sort((x, y) => x - y); assert.deepEqual(n, Array.from({ length: n.length }, (_, j) => j + 1), `${name} ${wo.position}: 1..N`);
        const mo = new Map(wo.spokes.map((s) => [s.side + s.k, s.number])), mn = new Map(wn.spokes.map((s) => [s.side + s.k, s.number]));
        for (const s of wo.spokes) if (s.high) assert.equal(mn.get(s.side + s.k), mo.get(s.side + s.k), `${name} ${wo.position}: high-tension spoke keeps its number`);
        assert.deepEqual({ ...wn, spokes: null, lists: null }, { ...wo, spokes: null, lists: null }, `${name} ${wo.position}: lengths, counts, images unchanged`);
      }
    }
  } finally { console.log = log; console.warn = warn; }
});

test('webhook: with the flag ON in the environment the order note, the emails and the inventory are identical to flag OFF (they carry no spoke numbers)', async () => {
  const api = path.join(here, '..', 'api', 'index.js');
  const hashOf = (r) => JSON.stringify({ notes: r.notes, emails: r.restEmails.map((e) => [e.subject, e.html, (e.attachments || []).length]), sdk: r.sdkEmails.map((e) => [e.subject, e.html]), inv: r.inventoryAdjustments });
  const cases = [order1466(), loadSample('standard', 'std-nip-both-wheels-painted-both-fees')];
  const saved = process.env[NUMBERING_FLAG];
  try {
    for (const o of cases) {
      const md = o._sample && o._sample.metafields ? { ...loadMockShopify(), metafields: { ...loadMockShopify().metafields, ...o._sample.metafields } } : loadMockShopify();
      delete process.env[NUMBERING_FLAG];
      const off = await runWebhook(api, 'orders/create', clone(o), { mock: createMock(md) });
      process.env[NUMBERING_FLAG] = 'on';
      const on = await runWebhook(api, 'orders/create', clone(o), { mock: createMock(md) });
      assert.equal(hashOf(on), hashOf(off), 'notes, emails and inventory identical');
      assert.ok(off.notes.length > 0 || off.restEmails.length > 0);
    }
  } finally { if (saved === undefined) delete process.env[NUMBERING_FLAG]; else process.env[NUMBERING_FLAG] = saved; }
});

test('the default (process.env) is what the endpoint and the webhook use: ON in the environment gives version 2 without passing anything', () => {
  const saved = process.env[NUMBERING_FLAG];
  try {
    delete process.env[NUMBERING_FLAG]; assert.equal(buildOrderSheet({ orderData: order1466(), calculatedAt: AT }).numberingVersion, 1);
    process.env[NUMBERING_FLAG] = 'on'; assert.equal(buildOrderSheet({ orderData: order1466(), calculatedAt: AT }).numberingVersion, 2);
    process.env[NUMBERING_FLAG] = 'off'; assert.equal(buildOrderSheet({ orderData: order1466(), calculatedAt: AT }).numberingVersion, 1);
  } finally { if (saved === undefined) delete process.env[NUMBERING_FLAG]; else process.env[NUMBERING_FLAG] = saved; }
});

test('bad data never throws: unusable spokes get number null under Jerry\'s convention too', () => {
  assert.deepEqual(spokeNumber({ position: 'front', side: 'drive', k: 0, geom: null, numbering: NUMBERING_JERRY }), { number: null, text: null, high: null });
  const geom = { drive: [{ rim: 'x' }, { rim: 10 }], rotor: [{ rim: 20 }, { rim: 30 }] };
  assert.equal(spokeNumber({ position: 'front', side: 'drive', k: 0, geom, numbering: NUMBERING_JERRY }).number, null);
  assert.equal(spokeNumber({ position: 'middle', side: 'drive', k: 0, geom: { drive: [{ rim: 1 }], rotor: [{ rim: 2 }] }, numbering: NUMBERING_JERRY }).number, null);
});
