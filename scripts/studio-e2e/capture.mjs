// I9-SYSTEM: records what the REAL Spoke Color Studio saves and draws, for tests/studio-e2e.test.js.
//   node scripts/studio-e2e/capture.mjs            (theme at ../loamlabs-system-builder/theme-dev, or LOAM_THEME_DIR)
// Starts a local server (http://127.0.0.1:8777/) that serves harness.html and the theme's assets/spoke-studio.{js,css}. Open the URL in any browser
// (the page runs by itself, paints each wheel through the Studio's own buttons, and posts the result back); the script then writes
// tests/fixtures/studio-e2e-capture.json and exits. Wheel numbers come from the backend's own wheelConfigFor() for the sample orders, so the Studio and
// the email renderer are fed the same wheel.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findSystemBuildRecipe, wheelConfigFor } from '../../_lib/system-build.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const themeDir = path.resolve(process.env.LOAM_THEME_DIR || path.join(root, '..', 'loamlabs-system-builder', 'theme-dev'));
const port = Number(process.env.PORT || 8777);
const outFile = path.join(root, 'tests', 'fixtures', 'studio-e2e-capture.json');
const COLORS = ['Black', 'Blue', 'Bronze', 'Gold', 'Green', 'Lime', 'Orange', 'Pink', 'Purple', 'Red', 'Silver', 'Turquoise'];

const sample = (name) => JSON.parse(fs.readFileSync(path.join(root, 'samples', 'system', name + '.json'), 'utf8'));
function jobsFor(sampleName, pos, label, kinds) {
  const order = sample(sampleName), recipe = findSystemBuildRecipe(order).recipe;
  const cfg = wheelConfigFor(recipe, pos, null);
  const hubColor = recipe.components[pos + 'Hub'].selectedOptions.find((o) => o.name === 'Color').value;
  const wheel = { hubName: cfg.hubName, hubColor, erd: cfg.erd, rimHoles: cfg.rimHoles, drive: cfg.drive, rotor: cfg.rotor };
  const high = pos === 'front' ? 'rotor' : 'drive', low = pos === 'front' ? 'drive' : 'rotor';
  const base = { sample: sampleName, position: pos, hubModel: cfg.hubName, config: { wheels: { [pos]: wheel } }, highSide: high, lowSide: low };
  const out = [];
  if (kinds.includes('pairs')) out.push({ ...base, id: `${label}-pattern-2x1-or-2x2`, description: 'Studio pattern button "2 x 2" (2 x 1 on 2:1 wheels), accent Orange, base Black', ops: [{ op: 'accent', name: 'Orange' }, { op: 'pattern', id: 'pairs' }] });
  if (kinds.includes('quarter')) out.push({ ...base, id: `${label}-pattern-every-3rd-or-4th`, description: 'Studio pattern button "Every 4th" (Every 3rd on 2:1 wheels), accent Lime, base Black', ops: [{ op: 'accent', name: 'Lime' }, { op: 'pattern', id: 'quarter' }] });
  if (kinds.includes('distinct')) {
    const ops = [];
    let i = 0;
    for (const side of ['drive', 'rotor']) for (let k = 0; k < cfg[side].n; k++) { ops.push({ op: 'accent', name: COLORS[1 + (i++ % 11)] }, { op: 'paint', side, k }); }
    out.push({ ...base, id: `${label}-every-spoke-painted`, description: 'every spoke painted one by one through the Studio (11 colors cycling over drive then rotor spokes by index k)', ops });
  }
  return out;
}
const jobs = [
  ...jobsFor('solix-24h-wheelset-multicolor', 'front', 'solix24-front', ['pairs', 'quarter', 'distinct']),
  ...jobsFor('solix-24h-wheelset-multicolor', 'rear', 'solix24-rear', ['pairs', 'quarter', 'distinct']),
  ...jobsFor('hydra2-wheelset-32f-32r', 'front', 'hydra2-front32', ['pairs', 'distinct']),
  ...jobsFor('hydra2-wheelset-32f-32r', 'rear', 'hydra2-rear32', ['pairs', 'distinct']),
  ...jobsFor('hydra2-front-28h-only', 'front', 'hydra2-front28', ['pairs', 'distinct'])
];

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'text/plain') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  if (req.method === 'GET' && url.pathname === '/') return send(200, fs.readFileSync(path.join(here, 'harness.html')), 'text/html');
  if (req.method === 'GET' && url.pathname === '/jobs.json') return send(200, JSON.stringify(jobs), 'application/json');
  if (req.method === 'GET' && /^\/theme\/assets\/spoke-studio\.(js|css)$/.test(url.pathname)) {
    const f = path.join(themeDir, 'assets', path.basename(url.pathname));
    return fs.existsSync(f) ? send(200, fs.readFileSync(f), types[path.extname(f)]) : send(404, 'no such theme file');
  }
  if (req.method === 'POST' && (url.pathname === '/save' || url.pathname === '/error')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (url.pathname === '/error') { console.error('harness error:\n' + body); send(200, 'noted'); setTimeout(() => process.exit(1), 200); return; }
      const studioJs = fs.readFileSync(path.join(themeDir, 'assets', 'spoke-studio.js'));
      let commit = 'unknown';
      try { commit = execFileSync('git', ['-C', themeDir, 'rev-parse', '--short', 'HEAD']).toString().trim(); } catch (e) { /* not a git checkout */ }
      const capture = { generatedBy: 'scripts/studio-e2e/capture.mjs', themeCommit: commit, studioJsSha1: crypto.createHash('sha1').update(studioJs).digest('hex'), ...JSON.parse(body) };
      fs.writeFileSync(outFile, JSON.stringify(capture) + '\n');
      console.log(`wrote ${outFile} (${capture.results.length} captures, theme ${commit})`);
      send(200, 'saved');
      setTimeout(() => process.exit(0), 200);
    });
    return;
  }
  send(404, 'not found');
});
server.listen(port, '127.0.0.1', () => console.log(`open http://127.0.0.1:${port}/ in a browser (${jobs.length} jobs); theme ${themeDir}`));
