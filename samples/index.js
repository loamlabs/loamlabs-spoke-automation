// I9-SYSTEM: the sample System orders as importable data (static imports so Vercel bundles the JSON with api/test-system-email.js).
// Regenerate the JSON files with: node scripts/make-sample-payloads.mjs
import solix24 from './system/solix-24h-wheelset-multicolor.json' with { type: 'json' };
import hydra32 from './system/hydra2-32h-wheelset.json' with { type: 'json' };
import hydra28Front from './system/hydra2-28h-front-only.json' with { type: 'json' };
import solixSingle from './system/solix-single-color-front.json' with { type: 'json' };
import hydra28AllDifferent from './system/hydra2-28h-rear-all-different.json' with { type: 'json' };

export const SYSTEM_SAMPLES = {
  'solix-24h-wheelset-multicolor': solix24,
  'hydra2-32h-wheelset': hydra32,
  'hydra2-28h-front-only': hydra28Front,
  'solix-single-color-front': solixSingle,
  'hydra2-28h-rear-all-different': hydra28AllDifferent
};
