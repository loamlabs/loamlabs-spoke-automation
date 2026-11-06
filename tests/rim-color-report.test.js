// RIM-COLOR: a hub-choice order (rule name ends with the rim color, or _build.specs.rimColor) names the rim color in the note and the builder email;
// every other order - including a Silver rim without those signs - is byte-identical to before. Lengths and stock never change.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, createMock } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock, preconfiguredBuild } from './helpers/preconfigured-order.mjs';
import { rimColorOf, rimColorPolicy, rimLabel } from '../_lib/rim-color.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const run = (order) => runWebhook(INDEX, 'orders/create', order, { mock: createMock(preconfiguredMock()) });
const html = (r) => r.emails.map((e) => e.html).join('\n');
const withColor = (color, specs = {}) => {
  const b = preconfiguredBuild();
  for (const k of ['frontRim', 'rearRim']) b.components[k] = { ...b.components[k], variantTitle: `700c / 24h / ${color}`, selectedOptions: b.components[k].selectedOptions.map((o) => (o.name === 'Color' ? { ...o, value: color } : o)) };
  b.specs = { ...b.specs, ...specs };
  return b;
};
const FRONT = 'Test Rim 40 GR 700c Carbon Rim - 700c', REAR = 'Test Rim 44 GR 700c Carbon Rim - 700c';

test('helpers: rimColorOf reads the Color option; the policy needs the flag or a rule name ending with that color', () => {
  const rim = { title: 'R', selectedOptions: [{ name: 'Size', value: '29"' }, { name: 'Color', value: 'Silver' }] };
  assert.equal(rimColorOf(rim), 'Silver'); assert.equal(rimColorOf({ title: 'R', selectedOptions: [] }), null); assert.equal(rimColorOf(null), null);
  const props = (rule) => [{ name: '_Preconfigured_Rule', value: rule }];
  assert.equal(rimColorPolicy({ specs: {} }, props('A + B 15x110/12x148 Silver')).show(rim), true);
  assert.equal(rimColorPolicy({ specs: {} }, props('A + B 15x110/12x148 silver')).show(rim), true, 'case does not matter');
  assert.equal(rimColorPolicy({ specs: {} }, props('A + B 15x110/12x148 Black')).show(rim), false, 'rule names another color');
  assert.equal(rimColorPolicy({ specs: {} }, props('Silverstone master')).show(rim), false, 'only a whole last word');
  assert.equal(rimColorPolicy({ specs: {} }, []).show(rim), false);
  assert.equal(rimColorPolicy({ specs: { rimColor: 'Silver' } }, []).show(rim), true, 'explicit flag');
  assert.equal(rimColorPolicy({ specs: { rimColor: 'Silver' } }, []).show({ title: 'R', selectedOptions: [] }), false, 'no color on the rim, nothing to print');
  assert.equal(rimLabel(rim, rimColorPolicy({ specs: { rimColor: 'x' } }, [])), 'R - 29" - Silver');
  assert.equal(rimLabel(rim, null), 'R - 29"');
});

test('hub-choice Silver order (rule name ends "Silver"): both rim lines, note and builder email, say Silver; lengths, inventory and everything else are the Black order\'s', async () => {
  const silver = await run(preconfiguredOrder({ rule: 'Test hub-choice 15x110/12x148 Silver', build: withColor('Silver') }));
  const black = await run(preconfiguredOrder({ rule: 'Test hub-choice 15x110/12x148 Black', build: withColor('Black') }));
  assert.equal(silver.status, 200);
  assert.ok(silver.note.includes(`Rim: ${FRONT} - Silver`) && silver.note.includes(`Rim: ${REAR} - Silver`));
  assert.ok(html(silver).includes(`${FRONT} - Silver`) && html(silver).includes(`${REAR} - Silver`));
  assert.ok(black.note.includes(`Rim: ${FRONT} - Black`), 'a Black hub-choice order says Black');
  // the only difference between the two orders is the color word
  assert.equal(silver.note.replaceAll('Silver', 'Black'), black.note);
  assert.equal(html(silver).replaceAll('Silver', 'Black'), html(black));
  assert.deepEqual(silver.inventoryAdjustments, black.inventoryAdjustments);
  assert.equal(silver.emails[0].subject, black.emails[0].subject);
});

test('every other order is byte-identical to today: a Silver rim with an ordinary rule, no rule, or a rule that names another color prints no color', async () => {
  const base = await run(preconfiguredOrder());
  for (const [name, order] of [['ordinary rule + Silver rim', preconfiguredOrder({ build: withColor('Silver') })], ['no rule + Silver rim', preconfiguredOrder({ rule: null, build: withColor('Silver') })],
    ['rule names Black, rim Silver', preconfiguredOrder({ rule: 'Hub choice Black', build: withColor('Silver') })]]) {
    const r = await run(order);
    assert.equal(r.note, base.note, name); assert.equal(html(r), html(base), name); assert.equal(/ - (Silver|Black)\b/.test(r.note), false, name);
  }
  assert.ok(base.note.includes(`Rim: ${FRONT}\n`), 'the existing line is unchanged');
});

test('_build.specs.rimColor is the explicit flag: the color is printed whatever the rule is called', async () => {
  const r = await run(preconfiguredOrder({ build: withColor('Silver', { rimColor: 'Silver' }) }));
  assert.ok(r.note.includes(`Rim: ${FRONT} - Silver`) && html(r).includes(`${REAR} - Silver`));
});
