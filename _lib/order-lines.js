// EMAIL-LINES: two extra lines in the key inputs of the builder email and the order note: "Freehub body: SRAM XD" (rear wheel) and "Rule: <preconfigured rule name>".
// Printed only when the value exists, so every order without them is byte-identical to before. Pure functions, no network.

// The bodies in the store (XD, XD-R, HG, HG-R, MS) by name. Anything else is printed as the store has it.
const FREEHUB_NAMES = { XD: 'SRAM XD', 'XD-R': 'SRAM XD-R', HG: 'Shimano HG', 'HG-R': 'Shimano HG-R', MS: 'Shimano MicroSpline' };

/** "SRAM XD" for components.rearComponentFreehub.variantTitle "XD"; the raw title for a body not in the list; null when there is none. */
export function freehubBodyName(buildRecipe) {
  const c = buildRecipe && buildRecipe.components && buildRecipe.components.rearComponentFreehub;
  const t = c && typeof c.variantTitle === 'string' ? c.variantTitle.trim() : '';
  if (!t) return null;
  return FREEHUB_NAMES[t.toUpperCase()] || t;
}

/** The _Preconfigured_Rule line property of the wheel line, or null. */
export function ruleNameOf(lineProperties) {
  const p = Array.isArray(lineProperties) ? lineProperties.find((x) => x && x.name === '_Preconfigured_Rule') : null;
  const v = p && typeof p.value === 'string' ? p.value.trim() : '';
  return v || null;
}

/** Put the two values on the wheels' inputs (rear gets the freehub body, both get the rule). Wheels that did not calculate have no inputs and are skipped. */
export function attachOrderLines(report, buildRecipe, lineProperties) {
  const freehub = freehubBodyName(buildRecipe), rule = ruleNameOf(lineProperties);
  if (!report) return report;
  for (const pos of ['front', 'rear']) {
    const w = report[pos];
    if (!w || !w.calculationSuccessful || !w.inputs) continue;
    if (pos === 'rear' && freehub) w.inputs.freehubBody = freehub;
    if (rule) w.inputs.ruleName = rule;
  }
  return report;
}

export const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
