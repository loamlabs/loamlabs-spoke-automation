// I9-SYSTEM: the backend's vendored lacing geometry (_lib/studio-geometry.js) must equal the theme's LoamStudio.geometry, for the System wheels AND the
// Standard wheels. Run with: npm test
//
// The theme's Studio is read from a git REF of the theme repo (default: commit 4308879, pinned by id; LOAM_THEME_REF=<branch> shows newer theme work that is not synced yet); see
// tests/helpers/theme-studio.mjs for LOAM_THEME_DIR / LOAM_THEME_REF. When the theme is not there the live tests FAIL on purpose (set LOAM_THEME_DIR=skip
// to run only the fixture comparisons), so a drift can never pass unnoticed.
// tests/fixtures/studio-geometry.json and studio-geometry-standard.json are snapshots of the theme's output; regenerate them with
//   node scripts/update-geometry-fixture.mjs
// after an intentional lacing change in the theme (and port the change into _lib/studio-geometry.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geometry } from '../_lib/studio-geometry.js';
import { SANDBOX_WHEELS, GOLDEN_WHEELS, STANDARD_WHEELS, STANDARD_AUTO_WHEELS } from './fixtures/sandbox-wheels.js';
import { themeSource, loadStudio, loadGolden } from './helpers/theme-studio.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', name), 'utf8'));
const plain = (o) => JSON.parse(JSON.stringify(o));
const skipLive = process.env.LOAM_THEME_DIR === 'skip';

test('vendored geometry equals the committed snapshot of the theme geometry (System sandbox wheels)', () => {
  const fixture = readFixture('studio-geometry.json');
  for (const [name, cfg] of Object.entries(SANDBOX_WHEELS)) {
    assert.ok(fixture[name], `fixture is missing wheel "${name}"; run node scripts/update-geometry-fixture.mjs`);
    assert.deepEqual(plain(geometry(cfg)), fixture[name], `geometry drifted from the fixture for ${name}`);
  }
});

test('vendored geometry equals the committed snapshot of the theme geometry (all 38 Standard wheels, without and with autoValvePhase)', () => {
  const fixture = readFixture('studio-geometry-standard.json');
  assert.equal(Object.keys(STANDARD_WHEELS).length, 38);
  assert.equal(Object.keys(STANDARD_AUTO_WHEELS).length, 38);
  for (const [name, cfg] of Object.entries({ ...STANDARD_WHEELS, ...STANDARD_AUTO_WHEELS })) {
    assert.ok(fixture[name], `fixture is missing wheel "${name}"; run node scripts/update-geometry-fixture.mjs`);
    assert.deepEqual(plain(geometry(cfg)), fixture[name], `geometry drifted from the fixture for ${name}`);
  }
});

test('vendored geometry equals the LIVE theme LoamStudio.geometry (System sandbox wheels)', (t) => {
  if (skipLive) { t.skip('LOAM_THEME_DIR=skip'); return; }
  const src = themeSource(), Studio = loadStudio(src);
  for (const [name, cfg] of Object.entries(SANDBOX_WHEELS)) assert.deepEqual(plain(geometry(cfg)), plain(Studio.geometry(cfg)), `geometry drifted from the theme (${src.origin}) for ${name}`);
});

test('vendored geometry equals the LIVE theme LoamStudio.geometry for every Standard wheel: front and rear, 20/24/28/32/36 holes, crossing 0 to 4, with autoValvePhase on and off', (t) => {
  if (skipLive) { t.skip('LOAM_THEME_DIR=skip'); return; }
  const src = themeSource(), Studio = loadStudio(src);
  for (const [name, cfg] of Object.entries({ ...STANDARD_WHEELS, ...STANDARD_AUTO_WHEELS })) assert.deepEqual(plain(geometry(cfg)), plain(Studio.geometry(cfg)), `geometry drifted from the theme (${src.origin}) for ${name}`);
});

test('vendored geometry equals the theme golden file for every wheel except the Solix 24h 2:1 pair, and for the 38 Standard wheels', (t) => {
  if (skipLive) { t.skip('LOAM_THEME_DIR=skip'); return; }
  const src = themeSource(), golden = loadGolden(src);
  assert.ok(golden, `theme golden file not found at ${src.origin}`);
  for (const [name, cfg] of Object.entries(GOLDEN_WHEELS)) assert.deepEqual(plain(geometry(cfg)), golden[name], `${name}: geometry differs from the theme golden file (${src.origin})`);
  assert.deepEqual(Object.keys(GOLDEN_WHEELS).sort(), Object.keys(golden).filter((k) => !k.startsWith('std-')).sort(), 'the golden file and GOLDEN_WHEELS list the same non-Standard wheels');
  const stdInGolden = Object.keys(golden).filter((k) => k.startsWith('std-'));
  if (stdInGolden.length) { // the golden file of the Standard branch pins the same 38 wheels, plus the 38 std-auto-* (autoValvePhase) ones
    assert.deepEqual(stdInGolden.sort(), [...Object.keys(STANDARD_WHEELS), ...Object.keys(STANDARD_AUTO_WHEELS)].sort(), 'the golden file and STANDARD_WHEELS / STANDARD_AUTO_WHEELS list the same Standard wheels');
    for (const [name, cfg] of Object.entries({ ...STANDARD_WHEELS, ...STANDARD_AUTO_WHEELS })) assert.deepEqual(plain(geometry(cfg)), golden[name], `${name}: geometry differs from the theme golden file (${src.origin})`);
  }
});

test('geometry sanity: one spoke per rim hole, spoke arrays sized like the Studio value (System and Standard)', () => {
  for (const cfg of [...Object.values(SANDBOX_WHEELS), ...Object.values(STANDARD_WHEELS), ...Object.values(STANDARD_AUTO_WHEELS)]) {
    const g = geometry(cfg);
    for (const [w, sides] of Object.entries(g)) {
      const want = cfg.wheels[w];
      assert.equal(sides.drive.length, want.drive.n);
      assert.equal(sides.rotor.length, want.rotor.n);
      const idx = [...sides.drive, ...sides.rotor].map((p) => p.rimIndex);
      assert.equal(new Set(idx).size, want.rimHoles, `${w}: one spoke per rim hole`);
    }
  }
});

test('radial (crossing 0): every spoke runs straight out, its hub hole at the angle of its own rim hole; a crossing of 1 or more is not radial', () => {
  for (const [name, cfg] of Object.entries(STANDARD_WHEELS)) {
    const [w] = Object.keys(cfg.wheels), g = geometry(cfg)[w], radial = cfg.wheels[w].drive.cross === 0;
    for (const side of ['drive', 'rotor']) {
      const straight = g[side].every((p) => Math.abs(p.hub - p.rim) < 1e-9);
      assert.equal(straight, radial, `${name} ${side}: radial = ${radial}`);
    }
  }
  assert.equal(geometry({ wheels: { front: { erd: 600, rimHoles: 24, drive: { n: 12, pcd: 58, cross: 0 }, rotor: { n: 12, pcd: 58, cross: 0 } } } }).front.drive.length, 12);
});
