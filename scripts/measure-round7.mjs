// Round 7 timing: runs the whole webhook path locally for (a) a large Standard keyed wheel set (36h/36h, 6 spoke colors per wheel, Studio images) and (b) a System
// bundle set, with Shopify and Resend replaced by fakes that each wait DELAY ms (default 300; one wait per call, REST and SDK). The images are rendered for real.
//   node scripts/measure-round7.mjs [delayMs=300] [runs=5]
// Prints the total webhook wall time and the image render time on its own (the PNG rendering only, called directly), per run, then min / median / max.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { runWebhook, createMock, loadMockShopify, loadSample } from '../tests/helpers/webhook-harness.mjs';
import { svgToPng } from '../_lib/wheel-png.js';
import { findSystemBuildRecipe } from '../_lib/system-build.js';
import { findStandardStudioRecipe } from '../_lib/standard-build.js';
import { buildSystemReport } from '../_lib/system-report.js';
import { buildStandardAdditions } from '../_lib/standard-report.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DELAY = Number(process.argv[2] || 300), RUNS = Number(process.argv[3] || 5);
const INDEX = path.join(root, 'api', 'index.js');

// Reuse the sample generator for the big Standard order: its source is run with the output pointed at a temp folder and one more sample appended.
async function bigStandardOrder() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r7-gen-'));
  let src = fs.readFileSync(path.join(root, 'scripts', 'make-sample-payloads.mjs'), 'utf8');
  src = src.replace(/const outSystem = [^\n]*\n/, `const outSystem = ${JSON.stringify(path.join(tmp, 'system'))}, outStandard = ${JSON.stringify(path.join(tmp, 'standard'))};\n`)
    .replace(/fs\.rmSync\(outSystem[^\n]*\n/, `fs.mkdirSync(outSystem, { recursive: true }); fs.mkdirSync(outStandard, { recursive: true });\n`)
    .replace(/console\.log\('wrote samples[^\n]*\n/, '');
  src += `
const SIX_F = { drive: { Black: 4, Silver: 4, 'Flamingo Pink': 4, 'Mallard Green': 2, 'Martin Purple': 2, 'Robin Red': 2 }, rotor: { Black: 4, Silver: 4, 'Flamingo Pink': 2, 'Mallard Green': 4, 'Martin Purple': 2, 'Robin Red': 2 } };
stdKeyedOrder('std-big-36-36-six-colors', {
  orderNumber: 91099, buildType: 'Wheel Set', brake: '6-Bolt', description: 'Measurement only: 36h/36h wheel set, 6 spoke colors per wheel',
  wheels: {
    front: { total: 36, cross: 3, pcd: 58, base: 'Black', counts: SIX_F, rim: { v: 1001, p: 101, ...STEEL_RIM }, hub: { v: 1002, p: 102, color: 'Black', ...STEEL_HUB('front') }, spokes: STEEL_SPOKES(1003) },
    rear: { total: 36, cross: 3, pcd: 58, base: 'Black', counts: SIX_F, rim: { v: 1004, p: 101, ...STEEL_RIM }, hub: { v: 1005, p: 104, color: 'Black', ...STEEL_HUB('rear') }, spokes: STEEL_SPOKES(1006) }
  }
});
`;
  const gen = path.join(root, 'scripts', '.tmp-measure-gen.mjs');
  fs.writeFileSync(gen, src);
  try { await import(pathToFileURL(gen).href); } finally { fs.rmSync(gen, { force: true }); }
  const order = JSON.parse(fs.readFileSync(path.join(tmp, 'standard', 'std-big-36-36-six-colors.json'), 'utf8'));
  const mockData = JSON.parse(fs.readFileSync(path.join(tmp, 'standard', 'mock-shopify.json'), 'utf8'));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { order, mockData };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (a) => `min ${Math.min(...a).toFixed(0)} / median ${med(a).toFixed(0)} / max ${Math.max(...a).toFixed(0)} ms`;

async function measure(label, { order, mockData, kind }) {
  const env = { SYSTEM_CUSTOMER_EMAIL: 'on' };
  const total = [], render = [], counts = [];
  for (let i = 0; i < RUNS + 1; i++) {                       // the first run warms the code (not counted)
    const mock = createMock(mockData || loadMockShopify());
    const inner = mock.fetch; let calls = 0;
    mock.fetch = async (url, init) => { calls++; await sleep(DELAY); return inner(url, init); };
    const t0 = performance.now();
    const r = await runWebhook(INDEX, 'orders/create', order, { mock, env, sdkDelayMs: DELAY });
    const t = performance.now() - t0;
    // the image rendering alone, same order, real renderer, timed per image
    let rt = 0, imgs = 0;
    const timed = async (svg, w) => { const s = performance.now(); const p = await svgToPng(svg, w); rt += performance.now() - s; imgs++; return p; };
    if (kind === 'system') await buildSystemReport({ recipe: findSystemBuildRecipe(order).recipe, orderData: order, renderPng: timed });
    else await buildStandardAdditions({ recipe: findStandardStudioRecipe(order).recipe, orderData: order, renderPng: timed });
    if (i > 0) { total.push(t); render.push(rt); }
    counts.push({ status: r.status, calls, emails: r.emails.length, images: imgs, attachmentsKB: Math.round((r.emails.flatMap((e) => e.attachments || []).reduce((s, a) => s + a.content.length * 0.75, 0)) / 1024) });
  }
  const last = counts[counts.length - 1];
  console.log(`\n${label}\n  status ${last.status}, ${last.emails} email(s), ${last.images} images rendered, ${last.calls} fake network calls (each ${DELAY} ms), attachments ${last.attachmentsKB} KB\n  total webhook wall time : ${fmt(total)}\n  image rendering alone   : ${fmt(render)}\n  everything else         : about ${(med(total) - med(render)).toFixed(0)} ms (of which fake waits are ${last.calls} x ${DELAY} ms if they ran one after another = ${last.calls * DELAY} ms)`);
}

console.log(`machine: ${os.cpus()[0].model.trim()}, ${os.cpus().length} threads, ${(os.totalmem() / 1e9).toFixed(0)} GB, ${os.platform()} ${os.release()}, node ${process.version}; runs: ${RUNS} (+1 warm-up)`);
const big = await bigStandardOrder();
await measure('Standard keyed wheel set, 36h/36h, 6 spoke colors per wheel (customer email on)', { ...big, kind: 'standard' });
await measure('System bundle wheel set (hydra2 front custom + rear solid, customer email on)', { order: loadSample('system', 'hydra2-bundle-front-custom-rear-solid'), kind: 'system' });
