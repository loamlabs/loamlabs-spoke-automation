// I9-SYSTEM: the backend's vendored lacing geometry (_lib/studio-geometry.js) must equal the theme's LoamStudio.geometry.
// Run with: node --test tests/
//
// The theme file is read from LOAM_THEME_DIR (default: the sibling checkout ../loamlabs-system-builder/theme-dev). When it is not
// there the test FAILS on purpose (set LOAM_THEME_DIR=skip to run only the fixture comparison), so a drift can never pass unnoticed.
// tests/fixtures/studio-geometry.json is a snapshot of the theme's output for the same wheels; regenerate it with
//   node scripts/update-geometry-fixture.mjs
// after an intentional lacing change in the theme (and port the change into _lib/studio-geometry.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { geometry } from '../_lib/studio-geometry.js';
import { SANDBOX_WHEELS, GOLDEN_WHEELS } from './fixtures/sandbox-wheels.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, 'fixtures', 'studio-geometry.json');
const themeDir = process.env.LOAM_THEME_DIR || path.resolve(here, '..', '..', 'loamlabs-system-builder', 'theme-dev');
const themeFile = path.join(themeDir, 'assets', 'spoke-studio.js');

function loadThemeStudio() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(themeFile, 'utf8'), { window, console });
  return window.LoamStudio;
}
const plain = (o) => JSON.parse(JSON.stringify(o));

test('vendored geometry equals the committed snapshot of the theme geometry (all sandbox wheels)', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  for (const [name, cfg] of Object.entries(SANDBOX_WHEELS)) {
    assert.ok(fixture[name], `fixture is missing wheel "${name}"; run node scripts/update-geometry-fixture.mjs`);
    assert.deepEqual(plain(geometry(cfg)), fixture[name], `geometry drifted from the fixture for ${name}`);
  }
});

test('vendored geometry equals the LIVE theme LoamStudio.geometry (reads the dev theme checkout)', (t) => {
  if (process.env.LOAM_THEME_DIR === 'skip') { t.skip('LOAM_THEME_DIR=skip'); return; }
  assert.ok(fs.existsSync(themeFile), `theme file not found at ${themeFile}. Set LOAM_THEME_DIR to the theme-dev folder (or LOAM_THEME_DIR=skip to run only the fixture test).`);
  const Studio = loadThemeStudio();
  for (const [name, cfg] of Object.entries(SANDBOX_WHEELS)) {
    const theirs = plain(Studio.geometry(cfg)), ours = plain(geometry(cfg));
    assert.deepEqual(ours, theirs, `geometry drifted from the theme for ${name}`);
  }
});

test('vendored geometry equals the theme golden file for every wheel except the Solix 24h 2:1 pair (those did not change)', (t) => {
  if (process.env.LOAM_THEME_DIR === 'skip') { t.skip('LOAM_THEME_DIR=skip'); return; }
  const goldenFile = path.join(themeDir, 'tests', 'fixtures', 'spoke-studio-geometry-non-24h-2to1.json');
  assert.ok(fs.existsSync(goldenFile), `theme golden file not found at ${goldenFile}`);
  const golden = JSON.parse(fs.readFileSync(goldenFile, 'utf8'));
  for (const [name, cfg] of Object.entries(GOLDEN_WHEELS)) assert.deepEqual(plain(geometry(cfg)), golden[name], `${name}: geometry differs from the theme golden file`);
  assert.deepEqual(Object.keys(GOLDEN_WHEELS).sort(), Object.keys(golden).sort(), 'the golden file and GOLDEN_WHEELS list the same wheels');
});

test('geometry sanity: one spoke per rim hole, spoke arrays sized like the Studio value', () => {
  for (const cfg of Object.values(SANDBOX_WHEELS)) {
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
