// I9-SYSTEM: the sample System orders as importable data (static imports so Vercel bundles the JSON with api/test-system-email.js).
// Real wheel combinations only. Regenerate the JSON files with: node scripts/make-sample-payloads.mjs
import solix24 from './system/solix-24h-wheelset-multicolor.json' with { type: 'json' };
import hydraSet28f32r from './system/hydra2-wheelset-28f-32r.json' with { type: 'json' };
import hydraSet32f32r from './system/hydra2-wheelset-32f-32r.json' with { type: 'json' };
import hydraFront28 from './system/hydra2-front-28h-only.json' with { type: 'json' };
import hydraFront32 from './system/hydra2-front-32h-only.json' with { type: 'json' };
import hydraRear32 from './system/hydra2-rear-32h-only.json' with { type: 'json' };
import solixSingle from './system/solix-single-color-front.json' with { type: 'json' };
import hydraRearAllDifferent from './system/hydra2-rear-32h-all-different.json' with { type: 'json' };
import solixFrontCustomRearSolid from './system/solix-24h-wheelset-front-custom-rear-solid.json' with { type: 'json' };

export const SYSTEM_SAMPLES = {
  'solix-24h-wheelset-multicolor': solix24,
  'hydra2-wheelset-28f-32r': hydraSet28f32r,
  'hydra2-wheelset-32f-32r': hydraSet32f32r,
  'hydra2-front-28h-only': hydraFront28,
  'hydra2-front-32h-only': hydraFront32,
  'hydra2-rear-32h-only': hydraRear32,
  'solix-single-color-front': solixSingle,
  'hydra2-rear-32h-all-different': hydraRearAllDifferent,
  'solix-24h-wheelset-front-custom-rear-solid': solixFrontCustomRearSolid
};
