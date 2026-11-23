// EMAIL-HOLE-ROW: the builder email's "Hub Dimensions" table shows the "Spoke Hole Diameter" row for Hook Flange hubs as well as Classic Flange hubs
// (Hook Flange lengths use the hole diameter since PR #22). Display only: same wording and number format, the value the engine used (a blank, missing or
// non-numeric hole diameter shows the 2.6 default), the Straight Pull table (Spoke Offset rows, no hole row) is unchanged, and no length, note line or rule changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, createMock } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMetafields, preconfiguredMock, PRE } from './helpers/preconfigured-order.mjs';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const text = (h) => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

async function run(hubType, hole) {
  const mf = preconfiguredMetafields();
  for (const id of [PRE.frontHub, PRE.rearHub]) {
    mf[id] = { ...mf[id], hub_type: hubType };
    if (hole === undefined) delete mf[id].hub_spoke_hole_diameter; else mf[id].hub_spoke_hole_diameter = hole;
    if (hubType !== 'Straight Pull') { mf[id].hub_flange_diameter_left = '44.0'; mf[id].hub_flange_diameter_right = '44.0'; }
  }
  const r = await runWebhook(INDEX, 'orders/create', preconfiguredOrder({ rule: null }), { mock: createMock(preconfiguredMock(mf)) });
  return { r, email: text(r.emails.map((e) => e.html).join('\n')) };
}
const rows = (email) => [...email.matchAll(/Spoke Hole Diameter ([^ ]+) mm/g)].map((m) => m[1]);

test('Hook Flange hub: the "Spoke Hole Diameter" row is in the email table (front and rear), same wording and format as Classic Flange', async () => {
  const { r, email } = await run('Hook Flange', '2.5');
  assert.ok(r.emails.length >= 1 && !r.logs.some(([t]) => t === 'error'), 'order calculated, no error');
  assert.deepEqual(rows(email), ['2.5', '2.5'], 'one row per wheel');
  assert.ok(/Hub Type Hook Flange PCD \(L\/R\) 44 mm \/ 44 mm Flange Offset \(L\/R\) [\d.]+ mm \/ [\d.]+ mm Spoke Hole Diameter 2\.5 mm/.test(email), 'the row sits right after the flange offset row');
  const classic = await run('Classic Flange', '2.5');
  assert.deepEqual(rows(classic.email), ['2.5', '2.5'], 'Classic Flange unchanged');
});

test('Hook Flange hub: a hole diameter of "-", blank or missing shows the 2.6 default the engine used', async () => {
  for (const hole of ['-', '', undefined, 'n/a']) { const { email } = await run('Hook Flange', hole); assert.deepEqual(rows(email), ['2.6', '2.6'], `hole ${JSON.stringify(hole)}`); }
});

test('Hook Flange hub: the value is printed as the Classic Flange row prints it (3.0 shows as "3 mm"), and the order note has no hole line (unchanged)', async () => {
  const hook = await run('Hook Flange', '3.0'), classic = await run('Classic Flange', '3.0');
  assert.deepEqual(rows(hook.email), ['3', '3']); assert.deepEqual(rows(classic.email), ['3', '3']);
  assert.ok(hook.r.note && !/Spoke Hole/.test(hook.r.note));
});

test('Straight Pull hub: no "Spoke Hole Diameter" row, the Spoke Offset row is still there', async () => {
  const { email } = await run('Straight Pull', '2.6');
  assert.deepEqual(rows(email), [], 'no hole row');
  assert.ok(/Hub Type Straight Pull/.test(email) && /Spoke Offset \(L\/R\)/.test(email));
});
