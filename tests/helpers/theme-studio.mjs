// Reads the theme's Spoke Color Studio source for the drift tests and the fixture script.
//
// The theme folder is a working checkout that other agents switch branches in, so by default the Studio is read from a git REF of that repo, not
// from whatever happens to be checked out:
//   LOAM_THEME_DIR   the theme-dev folder (default: ../loamlabs-system-builder/theme-dev next to this repo)
//   LOAM_THEME_REF   the git ref to read assets/spoke-studio.js and the golden file from. Default: commit 4308879 (the Studio with autoValvePhase that this repo's
//                    vendored geometry is synced to; pinned to a commit id, not a branch). Use LOAM_THEME_REF=agent-a-standard-studio to see how far the theme has moved on (the drift test
//                    then fails until the geometry is re-synced). 'worktree' reads the working-tree files instead. If the ref does not exist (for example the branch was
//                    merged and deleted) it falls back to the working tree and says so in `origin`.
//   LOAM_THEME_DIR=skip  -> everything here returns null (the tests that need the theme skip).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_THEME_REF = '4308879';

export function themeDir() {
  if (process.env.LOAM_THEME_DIR === 'skip') return null;
  return path.resolve(process.env.LOAM_THEME_DIR || path.resolve(here, '..', '..', '..', 'loamlabs-system-builder', 'theme-dev'));
}

function git(dir, args) { return execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).toString(); }

// { dir, ref, commit, origin, read(relPath) -> string } or null when the theme is skipped. Throws when the theme folder is missing.
export function themeSource() {
  const dir = themeDir();
  if (!dir) return null;
  if (!fs.existsSync(path.join(dir, 'assets', 'spoke-studio.js'))) throw new Error(`theme file not found at ${dir}. Set LOAM_THEME_DIR to the theme-dev folder (or LOAM_THEME_DIR=skip).`);
  const ref = process.env.LOAM_THEME_REF || DEFAULT_THEME_REF;
  let commit = null;
  if (ref !== 'worktree') { try { commit = git(dir, ['rev-parse', '--short', `${ref}^{commit}`]).trim(); } catch (e) { commit = null; } }
  if (commit) return { dir, ref, commit, origin: `git ${ref} @ ${commit}`, read: (rel) => git(dir, ['show', `${ref}:${rel.replace(/\\/g, '/')}`]) };
  let head = 'unknown';
  try { head = git(dir, ['rev-parse', '--short', 'HEAD']).trim(); } catch (e) { /* not a git checkout */ }
  const why = ref === 'worktree' ? 'worktree requested' : `ref "${ref}" not found`;
  return { dir, ref: 'worktree', commit: head, origin: `working tree of ${dir} (HEAD ${head}; ${why})`, read: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8') };
}

// The theme's own LoamStudio object, loaded the way the theme's tests load it (vm sandbox with a stub window).
export function loadStudio(src = themeSource()) {
  if (!src) return null;
  const window = {};
  vm.runInNewContext(src.read('assets/spoke-studio.js'), { window, console });
  return window.LoamStudio;
}

// The theme's golden geometry file ({ name: geometry }) at the same ref, or null when absent there.
export function loadGolden(src = themeSource()) {
  if (!src) return null;
  try { return JSON.parse(src.read('tests/fixtures/spoke-studio-geometry-non-24h-2to1.json')); } catch (e) { return null; }
}
