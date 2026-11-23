// EXTRALITE-ESTIMATE (Jerry, Nov 23): the 22 Extralite hub variants whose geometry is estimated from the maker's drawing are flagged "CHECK BEFORE BUILDING" in the order note and the
// builder email (a row in the wheel's key inputs and a "Hub note" at the top). The list is data/extralite-source/ESTIMATED_EXTRALITE_HUB_GEOMETRY.csv (Backend 2's file, byte for byte),
// turned into _lib/estimated-extralite-hubs.js by scripts/generate-extralite-estimated-hubs.mjs. Lengths, stock, subject and recipients do not change; every other hub is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ESTIMATED_HUB_VARIANTS, ESTIMATED_HUB_SENTENCE, ESTIMATED_HUB_SOURCE } from '../_lib/estimated-extralite-hubs.js';
import { estimatedHubLine, hubInputsExtras } from '../_lib/hub-order-lines.js';
import { runWebhook, createMock } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock, preconfiguredMetafields, preconfiguredBuild, PRE } from './helpers/preconfigured-order.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(here, '..', 'api', 'index.js');
const CSV = path.join(here, '..', 'data', 'extralite-source', 'ESTIMATED_EXTRALITE_HUB_GEOMETRY.csv');
const SENTENCE = "Extralite hub geometry is estimated from the maker's drawing, not measured: verify; may be up to 4 mm long (round lengths UP until measured)";
const IDS = Object.keys(ESTIMATED_HUB_VARIANTS);
const gid = (id) => `gid://shopify/ProductVariant/${id}`;
const LINE = /CHECK BEFORE BUILDING: Extralite hub geometry is estimated from the maker's drawing/;

function csvIds(text) { // every variant id of the CSV (first column of each line, quoted)
  return [...new Set(text.split('\n').slice(1).map((l) => (/^"(\d+)"/.exec(l) || [])[1]).filter(Boolean))];
}

test('the list: the CSV in the repo is the one the module was generated from (checksum), 22 variants, one sentence on every line, byte for byte', () => {
  const buf = fs.readFileSync(CSV);
  assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), ESTIMATED_HUB_SOURCE.sha256, 'run scripts/generate-extralite-estimated-hubs.mjs after changing the CSV');
  assert.equal(buf.includes('\r'), false, 'no CRLF conversion');
  const text = buf.toString('utf8');
  assert.deepEqual(csvIds(text).sort(), IDS.slice().sort());
  assert.equal(IDS.length, 22); assert.equal(ESTIMATED_HUB_SOURCE.variants, 22);
  assert.equal(ESTIMATED_HUB_SENTENCE, SENTENCE);
  const lines = text.split('\n').slice(1).filter(Boolean);
  assert.equal(lines.length, ESTIMATED_HUB_SOURCE.lines);
  for (const l of lines) assert.ok(l.includes(SENTENCE), 'every line carries the warning sentence');
  const titles = new Set(Object.values(ESTIMATED_HUB_VARIANTS).map((v) => v.title));
  assert.equal(titles.size, 6, 'the six Extralite masters');
  assert.ok([...titles].every((t) => t.startsWith('Extralite ')));
});

test('estimatedHubLine: the line for exactly those 22 variants (id or gid), nothing for any other hub', () => {
  for (const id of IDS) {
    for (const v of [id, gid(id), Number(id)]) {
      const line = estimatedHubLine(v);
      assert.ok(line && LINE.test(line), `variant ${id}`);
      assert.ok(line.includes(SENTENCE) && line.includes('before ordering spokes'));
    }
    assert.equal(hubInputsExtras({ variantId: gid(id), title: 'Extralite X', variantTitle: '24h / Black / 12x100mm' }, undefined).hubEstimate, estimatedHubLine(id));
  }
  for (const other of ['68065359462708', '8065359462707', '168065359462707', '51702600859955', '68064447562035', '51484533031219', PRE.frontHub, PRE.rearHub, 'gid://shopify/Product/15502334198067', '', null, undefined, 'abc'])
    assert.equal(estimatedHubLine(other), null, String(other));
  assert.equal('hubEstimate' in hubInputsExtras({ variantId: PRE.rearHub, title: 'Test Hub', variantTitle: '24h / Black' }, undefined), false, 'no key at all for another hub');
});

// ---- whole orders through the webhook (Shopify and Resend mocked) ----
const sections = (note) => { const f = note.indexOf('FRONT WHEEL'), r = note.indexOf('REAR WHEEL'); return { front: f >= 0 ? note.slice(f, r > f ? r : undefined) : '', rear: r >= 0 ? note.slice(r) : '' }; };
async function run(frontId, rearId) {
  const mf = preconfiguredMetafields(); const build = preconfiguredBuild();
  for (const [pos, id] of [['front', frontId], ['rear', rearId]]) {
    const key = pos + 'Hub'; if (!id) continue;
    mf[gid(id)] = { ...mf[PRE[key]] }; build.components[key] = { ...build.components[key], variantId: gid(id) };
  }
  const order = preconfiguredOrder({ build });
  const r = await runWebhook(INDEX, 'orders/create', order, { mock: createMock(preconfiguredMock(mf)) });
  return { r, email: r.emails.map((e) => e.html).join('\n'), text: (h) => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ') };
}
const lengthsOf = (note) => note.split('\n').filter((l) => /\(Geo\)|^\s+(Left|Right): \d+ x \d+mm|FINAL SPOKE|^(FRONT|REAR):/.test(l)).join('\n');

test('an order with an estimated Extralite hub: the note and the builder email carry the CHECK BEFORE BUILDING line on that wheel only; lengths, stock, subject and recipients are the same as for the same numbers on another hub', async () => {
  const base = await run(null, null);
  assert.equal(LINE.test(base.r.note), false); assert.equal(LINE.test(base.text(base.email)), false, 'a hub that is not on the list: no line anywhere');
  for (const id of IDS) {
    const front = /Front Hub/.test(ESTIMATED_HUB_VARIANTS[id].title);
    const { r, email, text } = await (front ? run(id, null) : run(null, id));
    assert.equal(r.status, 200); assert.equal(r.logs.some(([k]) => k === 'error'), false, id);
    const s = sections(r.note); const flagged = front ? s.front : s.rear, other = front ? s.rear : s.front;
    assert.equal((flagged.match(/CHECK BEFORE BUILDING/g) || []).length, 1, `${id}: one line in the note of its wheel`);
    assert.equal(LINE.test(other), false, `${id}: nothing on the other wheel`);
    assert.ok(flagged.includes(`  CHECK BEFORE BUILDING: ${SENTENCE}.`), 'printed under the Hub line');
    assert.ok(flagged.indexOf('  Hub:') < flagged.indexOf('CHECK BEFORE BUILDING') && flagged.indexOf('CHECK BEFORE BUILDING') < flagged.indexOf('  Spokes:'));
    const t = text(email);
    assert.equal((t.match(/CHECK BEFORE BUILDING/g) || []).length, 2, `${id}: a Hub note at the top and a Hub geometry row in the key inputs of the email`);
    assert.ok(/Hub note: (Front|Rear) hub: CHECK BEFORE BUILDING/.test(t) && /Hub geometry CHECK BEFORE BUILDING: Extralite/.test(t));
    assert.ok(t.indexOf('Hub note:') < t.indexOf('Hub geometry'), 'the notice is at the top');
    // nothing else changed: the note without the flag line equals the note of the same numbers on a hub that is not on the list; same subject, recipients, stock
    assert.equal(r.note.replace(/  CHECK BEFORE BUILDING: [^\n]*\n/, ''), base.r.note, `${id}: the rest of the note is identical`);
    assert.equal(lengthsOf(r.note), lengthsOf(base.r.note), 'lengths');
    assert.deepEqual(r.emails.map((e) => [e.subject, e.to]), base.r.emails.map((e) => [e.subject, e.to]));
    assert.equal(JSON.stringify(r.inventoryAdjustments), JSON.stringify(base.r.inventoryAdjustments), 'stock');
    assert.equal(r.emails.filter((e) => /CHECK BEFORE BUILDING/.test(e.html)).every((e) => !e.to.includes('customer@example.com')), true, 'never to the customer');
  }
});

test('both hubs of the order are Extralite: both wheels are flagged, front and rear', async () => {
  const front = IDS.find((i) => /Front Hub/.test(ESTIMATED_HUB_VARIANTS[i].title)), rear = IDS.find((i) => /Rear Hub/.test(ESTIMATED_HUB_VARIANTS[i].title));
  const { r, email, text } = await run(front, rear); const s = sections(r.note);
  assert.equal(LINE.test(s.front), true); assert.equal(LINE.test(s.rear), true);
  assert.equal((text(email).match(/Hub note:/g) || []).length, 1); assert.ok(/Front hub: CHECK BEFORE BUILDING/.test(text(email)) && /Rear hub: CHECK BEFORE BUILDING/.test(text(email)));
  assert.equal(r.emails.length, 1); assert.match(r.emails[0].subject, /Order #90301/); assert.equal(/ACTION REQUIRED/.test(r.emails[0].subject), false, 'the subject does not change');
});
