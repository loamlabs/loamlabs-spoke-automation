// RIM-COLOR: the spoke report names the rim as "<product> - <size>" and never its color, so a Silver DT Swiss FR 571 read exactly like a Black one.
// Hub-choice products (rim with two or more colors) now put the rim color in the rim line - but ONLY for those orders, so every other report stays byte-identical.
// An order is a "rim color" order when
//   - its _build carries specs.rimColor (a non-empty text; the explicit flag the builder / page may write), or
//   - its _Preconfigured_Rule line property (the rule name) ends with the rim's own color, which is how the hub-choice tool names its rules
//     ("LoamLabs DT Swiss FR 571 + Industry Nine Hydra2 15x110/12x148 Silver").
// Pure functions, no network.

/** The Color option of a rim component ("Silver"), or null. */
export function rimColorOf(rim) {
  if (!rim || typeof rim !== 'object') return null;
  const opt = Array.isArray(rim.selectedOptions) ? rim.selectedOptions.find((o) => o && o.name === 'Color') : null;
  const v = opt && typeof opt.value === 'string' ? opt.value.trim() : '';
  return v || null;
}

const prop = (props, name) => {
  const p = Array.isArray(props) ? props.find((x) => x && x.name === name) : null;
  return p && typeof p.value === 'string' ? p.value.trim() : '';
};

/**
 * Does this order's report name the rim color?
 * @param {object} buildRecipe the parsed _build
 * @param {Array<{name:string,value:string}>} lineProperties the wheel line item's properties
 * @returns {{ show: (rim: object) => boolean }}
 */
export function rimColorPolicy(buildRecipe, lineProperties) {
  const flag = buildRecipe && buildRecipe.specs && typeof buildRecipe.specs.rimColor === 'string' ? buildRecipe.specs.rimColor.trim() : '';
  const rule = prop(lineProperties, '_Preconfigured_Rule').toLowerCase();
  return {
    show(rim) {
      const color = rimColorOf(rim);
      if (!color) return false;
      if (flag) return true;
      return rule !== '' && rule.endsWith(` ${color.toLowerCase()}`);
    }
  };
}

/** "<product> - <size>" plus " - <color>" when the policy says so. */
export function rimLabel(rim, policy) {
  const size = Array.isArray(rim.selectedOptions) ? rim.selectedOptions.find((o) => o && o.name === 'Size') : null;
  let label = size && size.value ? `${rim.title} - ${size.value}` : rim.title;
  if (policy && typeof policy.show === 'function' && policy.show(rim)) label += ` - ${rimColorOf(rim)}`;
  return label;
}
