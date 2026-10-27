// I9-SYSTEM: regenerates the geometry fixtures from the THEME's LoamStudio.geometry (never from the backend copy):
//   tests/fixtures/studio-geometry.json            the System sandbox wheels
//   tests/fixtures/studio-geometry-standard.json   the 38 Standard wheels (compact)
// Usage: node scripts/update-geometry-fixture.mjs                       (reads the theme commit 63330f2 of ../loamlabs-system-builder/theme-dev; set LOAM_THEME_REF to sync a newer one)
//        LOAM_THEME_DIR=<theme-dev folder> LOAM_THEME_REF=<git ref | worktree> node scripts/update-geometry-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SANDBOX_WHEELS, STANDARD_WHEELS } from '../tests/fixtures/sandbox-wheels.js';
import { themeSource, loadStudio } from '../tests/helpers/theme-studio.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = themeSource();
if (!src) { console.error('LOAM_THEME_DIR=skip: nothing to do'); process.exit(1); }
const Studio = loadStudio(src);
const plain = (o) => JSON.parse(JSON.stringify(o));
const make = (wheels) => Object.fromEntries(Object.entries(wheels).map(([name, cfg]) => [name, plain(Studio.geometry(cfg))]));
const dir = path.join(here, '..', 'tests', 'fixtures');
fs.writeFileSync(path.join(dir, 'studio-geometry.json'), JSON.stringify(make(SANDBOX_WHEELS), null, 1) + '\n');
fs.writeFileSync(path.join(dir, 'studio-geometry-standard.json'), JSON.stringify(make(STANDARD_WHEELS)) + '\n');
console.log(`wrote geometry fixtures from ${src.origin}`);
