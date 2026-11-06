// EMAIL-LINES: the builder email's key inputs and the order note gain "Freehub body: <name>" (rear wheel) and "Rule: <rule name>" (both wheels),
// only when the order has the value. Nothing else changes: lengths, stock and the subject are the same with and without them.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, createMock } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock, preconfiguredBuild } from './helpers/preconfigured-order.mjs';
import { freehubBodyName, ruleNameOf } from '../_lib/order-lines.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const run = (order) => runWebhook(INDEX, 'orders/create', order, { mock: createMock(preconfiguredMock()) });
const html = (r) => r.emails.map((e) => e.html).join('\n');
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const withFreehub = (variantTitle, build = preconfiguredBuild()) => { build.components.rearComponentFreehub = { variantId: 'gid://shopify/ProductVariant/9199', title: 'Test Freehub', variantTitle, price: 0 }; return build; };
const side = (note, pos) => note.split(`${pos.toUpperCase()} WHEEL\n`)[1].split('\nREAR WHEEL')[0];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripText = (n) => n.replace(/^ {2}Freehub body: .*\n/gm, '').replace(/^ {2}Rule: .*\n/gm, '');
const stripHtml = (h) => h.replace(/\n *<tr><td>(Freehub body|Rule)<\/td><td>[^<]*<\/td><\/tr>/g, '');

test('helpers: plain freehub names for XD / HG / MS, any other body as the store has it, nothing when there is none; the rule name from the line property', () => {
  const fh = (t) => ({ components: { rearComponentFreehub: { variantTitle: t } } });
  assert.equal(freehubBodyName(fh('XD')), 'SRAM XD'); assert.equal(freehubBodyName(fh('HG')), 'Shimano HG'); assert.equal(freehubBodyName(fh('MS')), 'Shimano MicroSpline');
  assert.equal(freehubBodyName(fh('N3W')), 'N3W'); assert.equal(freehubBodyName(fh(' xd ')), 'SRAM XD');
  assert.equal(freehubBodyName(fh('')), null); assert.equal(freehubBodyName({ components: {} }), null); assert.equal(freehubBodyName(null), null); assert.equal(freehubBodyName(fh(7)), null);
  assert.equal(ruleNameOf([{ name: '_Preconfigured_Rule', value: ' A + B ' }]), 'A + B'); assert.equal(ruleNameOf([{ name: 'x', value: 'y' }]), null);
  assert.equal(ruleNameOf([{ name: '_Preconfigured_Rule', value: '  ' }]), null); assert.equal(ruleNameOf(undefined), null);
});

test('an order WITHOUT a freehub body and WITHOUT a rule prints neither line, in the note or the email; the key inputs are the old five rows', async () => {
  const r = await run(preconfiguredOrder({ rule: null }));
  assert.equal(r.status, 200);
  assert.equal(/Freehub body|Rule:/.test(r.note), false); assert.equal(/Freehub body|<td>Rule<\/td>/.test(html(r)), false);
  assert.ok(html(r).includes('<tr><td>Hub</td><td>Test Hub 240 SP Front Hub - Centerlock - 12x100mm</td></tr>\n                <tr><td>Spokes</td>'), 'Hub row directly followed by the Spokes row');
});

test('a rule and an XD body: rear wheel gets both lines, front wheel only the Rule; note and email carry the same text; lengths, stock and subject do not change', async () => {
  const plain = await run(preconfiguredOrder({ rule: null }));
  const rule = 'LoamLabs Reserve 30|DH Mullet + Industry Nine Hydra2 15x110/12x148';
  const r = await run(preconfiguredOrder({ rule, build: withFreehub('XD') }));
  const rear = side(r.note, 'rear'), front = side(r.note, 'front');
  assert.ok(rear.includes('  Hub: Test Hub 240 EXP SP Rear Hub - Centerlock - 12x142mm\n  Freehub body: SRAM XD\n  Spokes:'), 'freehub line sits under the hub');
  assert.ok(rear.includes(`  Target Tension: 115 kgf\n  Rule: ${rule}\n  --- Calculated Lengths ---`), 'rule line ends the key inputs');
  assert.equal(front.includes('Freehub body'), false); assert.ok(front.includes(`  Rule: ${rule}\n`));
  const t = text(html(r));
  assert.ok(t.includes('Freehub body SRAM XD'), 'email: freehub row'); assert.equal((t.match(new RegExp(escapeRe(`Rule ${rule}`), 'g')) || []).length, 2, 'email: a rule row per wheel');
  assert.equal(stripText(r.note), plain.note); assert.equal(stripHtml(html(r)), html(plain));
  assert.deepEqual(r.inventoryAdjustments, plain.inventoryAdjustments); assert.equal(r.emails[0].subject, plain.emails[0].subject);
});

test('HG and MS print their names; a body the list does not know prints as the store has it; the Rule is escaped in the email', async () => {
  for (const [vt, name] of [['HG', 'Shimano HG'], ['MS', 'Shimano MicroSpline'], ['XD-R', 'SRAM XD-R'], ['HG-R', 'Shimano HG-R'], ['N3W', 'N3W']]) assert.ok((await run(preconfiguredOrder({ rule: null, build: withFreehub(vt) }))).note.includes(`  Freehub body: ${name}\n`), vt);
  const r = await run(preconfiguredOrder({ rule: 'A & B <x>' }));
  assert.ok(html(r).includes('<td>A &amp; B &lt;x&gt;</td>') && !html(r).includes('<td>A & B <x></td>')); assert.ok(r.note.includes('  Rule: A & B <x>\n'));
});

// the hub-choice builds of the cart line replay (fixture numbers here; the real-store numbers are in AGENT_BACKEND1_EMAIL_LINES_REPORT.md)
const HUB_CHOICE = [
  ['Reserve Mullet, Hydra2, A', 'LoamLabs Reserve 30|DH Mullet + Industry Nine Hydra2 15x110/12x148'],
  ['Reserve 29/29, Project321, A', 'LoamLabs Reserve 30|DH + Project321 G3 6-Lock 15x110/12x148'],
  ['Reserve 29/29, e*thirteen, B', 'LoamLabs Reserve 30|DH + e*thirteen 15x110/12x157'],
  ['FR 571 Mullet, Hydra2, A, Silver', 'LoamLabs DT Swiss FR 571 Mullet + Industry Nine Hydra2 15x110/12x148 Silver']
];
test('hub-choice builds (three Reserve, one Silver FR 571): "Freehub body: SRAM XD" on the rear wheel and the full rule name on both wheels', async () => {
  for (const [label, rule] of HUB_CHOICE) {
    const build = withFreehub('XD');
    const silver = /Silver$/.test(rule);
    if (silver) for (const k of ['frontRim', 'rearRim']) build.components[k] = { ...build.components[k], selectedOptions: build.components[k].selectedOptions.map((o) => (o.name === 'Color' ? { ...o, value: 'Silver' } : o)) };
    const r = await run(preconfiguredOrder({ rule, build }));
    assert.ok(side(r.note, 'rear').includes('  Freehub body: SRAM XD\n'), label); assert.equal(side(r.note, 'front').includes('Freehub body'), false, label);
    assert.equal((r.note.match(new RegExp(`  Rule: ${escapeRe(rule)}\\n`, 'g')) || []).length, 2, label);
    if (silver) assert.ok(r.note.includes(' - Silver\n'), `${label}: the rim color line (RIM-COLOR) still prints`);
  }
});
