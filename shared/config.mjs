// Loads shared settings, the local .env and private answers. Nothing here prints private values.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const config = JSON.parse(readFileSync(join(ROOT, 'shared/config.json'), 'utf8'));

// .env holds SHEET_URL and SHEET_SECRET (git ignored).
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

// Private answers (phone, pay, notice) as JSON, git ignored.
const answersPath = join(ROOT, 'private/answers.local.json');
export const answers = existsSync(answersPath) ? JSON.parse(readFileSync(answersPath, 'utf8')) : {};

// Each site gets its own Chrome profile on this Mac, outside the repo.
// Like normal Chrome with "Continue where you left off", so a site login survives a restart.
export function profileDir(site) {
  const dir = join(os.homedir(), '.jobbot', 'profiles', site);
  const prefsPath = join(dir, 'Default', 'Preferences');
  mkdirSync(join(dir, 'Default'), { recursive: true });
  let prefs = {};
  try { prefs = JSON.parse(readFileSync(prefsPath, 'utf8')); } catch {}
  if (prefs.session?.restore_on_startup !== 1) {
    prefs.session = { ...(prefs.session || {}), restore_on_startup: 1 };
    writeFileSync(prefsPath, JSON.stringify(prefs));
  }
  return dir;
}

export function noteFor(job, site) {
  const portfolio = `${config.portfolio}/?ref=${config.sites[site].ref}`;
  return config.note.text
    .replaceAll('{company}', job.company || 'there')
    .replaceAll('{role}', job.role || 'design')
    .replaceAll('{portfolio}', portfolio);
}
