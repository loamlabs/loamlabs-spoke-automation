// I9-SYSTEM: regenerates tests/fixtures/studio-geometry.json from the THEME's LoamStudio.geometry (never from the backend copy).
// Usage: node scripts/update-geometry-fixture.mjs            (theme at ../loamlabs-system-builder/theme-dev)
//        LOAM_THEME_DIR=<theme-dev folder> node scripts/update-geometry-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { SANDBOX_WHEELS } from '../tests/fixtures/sandbox-wheels.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const themeDir = process.env.LOAM_THEME_DIR || path.resolve(here, '..', '..', 'loamlabs-system-builder', 'theme-dev');
const themeFile = path.join(themeDir, 'assets', 'spoke-studio.js');
if (!fs.existsSync(themeFile)) { console.error('theme file not found: ' + themeFile); process.exit(1); }

const window = {};
vm.runInNewContext(fs.readFileSync(themeFile, 'utf8'), { window, console });
const out = {};
for (const [name, cfg] of Object.entries(SANDBOX_WHEELS)) out[name] = JSON.parse(JSON.stringify(window.LoamStudio.geometry(cfg)));
const target = path.join(here, '..', 'tests', 'fixtures', 'studio-geometry.json');
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote ' + target + ' from ' + themeFile);
