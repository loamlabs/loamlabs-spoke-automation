// Round 8 timing: the webhook answers first and the work continues after the answer (Vercel waitUntil). Runs the whole handler locally for (a) a large
// Standard keyed wheel set (36h/36h, 6 spoke colors per wheel, Studio images) and (b) a System bundle set, with Shopify and Resend replaced by fakes that each wait
// DELAY ms (default 300; REST and SDK; images rendered for real). Reports time to the ANSWER and time until all the background work finished.
//   node scripts/measure-round8.mjs [delayMs=300] [runs=5] [answer-first|inline]      ("inline" = no waitUntil: work first, answer after, i.e. before round 8)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { runWebhook, createMock, loadMockShopify, loadSample } from '../tests/helpers/webhook-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DELAY = Number(process.argv[2] || 300), RUNS = Number(process.argv[3] || 5), MODE = process.argv[4] || 'answer-first';
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

async function measure(label, { order, mockData }) {
  const env = { SYSTEM_CUSTOMER_EMAIL: 'on' };
  const reply = [], done = [], atReplyInfo = [];
  let calls = 0, last = null;
  for (let i = 0; i < RUNS + 1; i++) {                       // the first run warms the code (not counted)
    const mock = createMock(mockData || loadMockShopify());
    const inner = mock.fetch; calls = 0;
    mock.fetch = async (url, init) => { calls++; await sleep(DELAY); return inner(url, init); };
    const r = await runWebhook(INDEX, 'orders/create', order, { mock, env, sdkDelayMs: DELAY, background: MODE !== 'inline' });
    last = r;
    if (i > 0) { reply.push(r.replyMs); done.push(r.doneMs); atReplyInfo.push(r.atReply); }
  }
  const ar = atReplyInfo[atReplyInfo.length - 1];
  console.log(`
${label} [${MODE === 'inline' ? 'no waitUntil: work first, answer after' : 'answer first'}]
  status ${last.status}, ${last.emails.length} email(s), ${calls} fake network calls (each ${DELAY} ms)
  time to the ANSWER       : ${fmt(reply)}
  background work finished : ${fmt(done)}
  at the answer: inventory adjustments ${ar.inventoryAdjustments}, notes ${ar.notes}, emails ${ar.restEmails + ar.sdkEmails} (at the end: ${last.inventoryAdjustments.length}, ${last.notes.length}, ${last.emails.length})`);
}

console.log(`machine: ${os.cpus()[0].model.trim()}, ${os.cpus().length} threads, ${(os.totalmem() / 1e9).toFixed(0)} GB, ${os.platform()} ${os.release()}, node ${process.version}; runs: ${RUNS} (+1 warm-up)`);
const big = await bigStandardOrder();
await measure('Standard keyed wheel set, 36h/36h, 6 spoke colors per wheel (customer email on)', { ...big });
await measure('System bundle wheel set (hydra2 front custom + rear solid, customer email on)', { order: loadSample('system', 'hydra2-bundle-front-custom-rear-solid') });
