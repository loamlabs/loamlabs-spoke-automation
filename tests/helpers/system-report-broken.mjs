// _lib/system-report.js with buildSystemReport replaced by a function that throws (loaded through helpers/loader.mjs for "breakSystemReport=1").
export * from '../../_lib/system-report.js';
export async function buildSystemReport() { throw new Error('simulated report failure'); }
