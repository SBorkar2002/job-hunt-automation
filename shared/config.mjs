// Loads shared settings, the local .env and private answers. Nothing here prints private values.
import { readFileSync, existsSync } from 'node:fs';
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
export const profileDir = site => join(os.homedir(), '.jobbot', 'profiles', site);

export function noteFor(job, site) {
  const portfolio = `${config.portfolio}/?ref=${config.sites[site].ref}`;
  return config.note.text
    .replaceAll('{company}', job.company || 'there')
    .replaceAll('{role}', job.role || 'design')
    .replaceAll('{portfolio}', portfolio);
}
