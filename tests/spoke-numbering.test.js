// ORDER-SHEET: the spoke numbering lives in ONE place (_lib/spoke-numbering.js). The golden test reproduces Jerry's provisional table of order #1466 (front 28h, rear 32h) spoke for spoke.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NUMBERING, spokeNumber, numberSpokes } from '../_lib/spoke-numbering.js';
import { geometry } from '../_lib/studio-geometry.js';
import { findSystemBuildRecipe, systemWheels } from '../_lib/system-build.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466-numbering.json'), 'utf8'));
const order = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466.json'), 'utf8'));
const wheels1466 = () => systemWheels(findSystemBuildRecipe(order).recipe, null, order);
const geomOf = (w) => geometry({ wheels: { [w.position]: w.config } })[w.position];

test('settings: version 1, provisional, and the rule is written down in the one settings object', () => {
  assert.equal(NUMBERING.version, 1);
  assert.equal(NUMBERING.status, 'provisional');
  assert.equal(NUMBERING.label, 'numbering version 1, provisional');
  assert.deepEqual(NUMBERING.highSide, { front: 'rotor', rear: 'drive' });
  assert.deepEqual(NUMBERING.first, { high: 2, low: 1 });
  assert.match(NUMBERING.rule, /even numbers/i);
});

test('golden: order #1466 front 28h and rear 32h get exactly the numbers, sides and colors of the provisional table', () => {
  for (const w of wheels1466()) {
    const table = golden[w.position];
    assert.equal(table.length, w.total, `${w.position}: the table has one row per spoke`);
    const list = numberSpokes({ position: w.position, geom: geomOf(w), colors: w.colors });
    assert.deepEqual(list.map((s) => [s.number, s.side, s.color]), table, `${w.position}: spoke table`);
  }
});

test('golden: the high-tension and low-tension lists of #1466 (front: rotor even / drive odd; rear: drive even / rotor odd)', () => {
  const [front, rear] = wheels1466();
  const fl = numberSpokes({ position: 'front', geom: geomOf(front), colors: front.colors });
  assert.deepEqual(fl.filter((s) => s.high).map((s) => `${s.number} ${s.color}`).slice(0, 4), ['2 Bronze', '4 Black', '6 Bronze', '8 Black']);
  assert.ok(fl.filter((s) => s.high).every((s) => s.side === 'rotor' && s.number % 2 === 0));
  assert.ok(fl.filter((s) => !s.high).every((s) => s.side === 'drive' && s.number % 2 === 1));
  const rl = numberSpokes({ position: 'rear', geom: geomOf(rear), colors: rear.colors });
  assert.ok(rl.filter((s) => s.high).every((s) => s.side === 'drive' && s.number % 2 === 0));
  assert.deepEqual(rl.filter((s) => !s.high).map((s) => `${s.number} ${s.color}`).slice(0, 4), ['1 Bronze', '3 Black', '5 Bronze', '7 Black']);
});

test('properties on every 1:1 wheel: numbers are 1..N once each, high side even, low side odd, spoke 1 and spoke 2 are the first spokes left of the valve', () => {
  for (const pos of ['front', 'rear']) for (const n of [12, 14, 16, 18]) for (const cross of [0, 2, 3]) {
    const cfg = { erd: 600, rimHoles: 2 * n, drive: { n, pcd: 50, cross }, rotor: { n, pcd: 50, cross } };
    const geom = geometry({ wheels: { [pos]: cfg } })[pos];
    const list = numberSpokes({ position: pos, geom, colors: { drive: Array(n).fill('x'), rotor: Array(n).fill('x') } });
    assert.deepEqual(list.map((s) => s.number), Array.from({ length: 2 * n }, (_, i) => i + 1), `${pos} ${n} ${cross}`);
    const high = NUMBERING.highSide[pos];
    assert.ok(list.every((s) => (s.side === high) === (s.number % 2 === 0)), `${pos} ${n}: high side is even`);
    // spoke 1 and 2 are the closest spokes clockwise from the valve as seen from their own face
    const dist = (s, side) => { const rim = geom[side][s.k].rim; const seen = side === 'rotor' ? (360 - rim) % 360 : rim; return (((seen - 180) % 360) + 360) % 360; };
    for (const side of ['drive', 'rotor']) {
      const mine = list.filter((s) => s.side === side), first = mine[0];
      assert.ok(mine.every((s) => dist(first, side) <= dist(s, side) + 1e-9), `${pos} ${side}: the first number is the first spoke from the valve`);
    }
  }
});

test('2:1 wheels (unequal sides): not covered by the odd/even rule, so each side is numbered 1, 2, 3 ... by itself and says which side', () => {
  const cfg = { erd: 600, rimHoles: 24, drive: { n: 16, pcd: 50, cross: 3 }, rotor: { n: 8, pcd: 50, cross: 3 } };
  const geom = geometry({ wheels: { rear: cfg } }).rear;
  const list = numberSpokes({ position: 'rear', geom, colors: { drive: Array(16).fill('a'), rotor: Array(8).fill('b') } });
  assert.deepEqual(list.filter((s) => s.side === 'drive').map((s) => s.number), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual(list.filter((s) => s.side === 'rotor').map((s) => s.number), Array.from({ length: 8 }, (_, i) => i + 1));
  assert.equal(list.find((s) => s.side === 'drive' && s.number === 3).text, 'Drive 3');
  assert.ok(list.every((s) => s.high === null));
});

test('bad input never throws: a missing geometry, a bad index, an unknown side give number null', () => {
  const geom = geometry({ wheels: { front: { erd: 600, rimHoles: 28, drive: { n: 14, pcd: 50, cross: 3 }, rotor: { n: 14, pcd: 50, cross: 3 } } } }).front;
  for (const o of [undefined, null, {}, { position: 'front', side: 'drive', k: 0 }, { position: 'front', side: 'left', k: 0, geom }, { position: 'front', side: 'drive', k: 99, geom },
    { position: 'front', side: 'drive', k: -1, geom }, { position: 'front', side: 'drive', k: 1.5, geom }, { position: 'sideways', side: 'drive', k: 0, geom },
    { position: 'front', side: 'drive', k: 0, geom: { drive: [{ rim: 'x' }], rotor: [] } }]) {
    assert.equal(spokeNumber(o).number, null, JSON.stringify(o && Object.keys(o)));
  }
  assert.deepEqual(numberSpokes(undefined), []);
});

test('the rule is in ONE file: no other source file reads the numbering settings (only labels and the version are copied onto the sheet)', () => {
  const root = path.join(here, '..');
  const files = [];
  for (const dir of ['_lib', 'api']) for (const f of fs.readdirSync(path.join(root, dir))) if (/\.(js|mjs)$/.test(f) && f !== 'spoke-numbering.js') files.push(path.join(root, dir, f));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.equal(/NUMBERING\.(first|step|highSide|valveAngle|povOfSide|unequalSides)/.test(src), false, `${path.basename(f)} must not use the numbering rule directly`);
  }
});
