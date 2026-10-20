// What the bot remembers on this Mac (outside the repo, in ~/.jobbot/state):
// per site: jobs handled, applications per day, Needs you jobs to recheck;
// across sites: every company and role applied to, for the crossSite rule;
// every run's summary, for npm run status.
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOBBOT, istToday } from './util.mjs';

const dir = join(JOBBOT, 'state');
mkdirSync(dir, { recursive: true });
const read = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);

export function siteState(site, { dryRun }) {
  const path = join(dir, `${site}.json`);
  const s = read(path, { handled: {}, days: {} });
  s.needs ||= {};
  s.crossWait ||= {};
  return {
    data: s,
    appliedToday: () => (s.days[istToday()] || []).length,
    markApplied(key) { (s.days[istToday()] ||= []).push(key); s.handled[key] = 'applied'; },
    save() { if (!dryRun) writeFileSync(path, JSON.stringify(s, null, 2)); },
  };
}

// Company + role applied anywhere: { "<company>|<role>": { site, date, jobLink } }
const appliedPath = join(dir, 'applied-anywhere.json');
export const appliedAnywhere = () => read(appliedPath, {});
export function recordApplied(key, entry, { dryRun }) {
  if (dryRun) return;
  const all = appliedAnywhere();
  all[key] ||= entry;
  writeFileSync(appliedPath, JSON.stringify(all, null, 2));
}

const runsPath = join(dir, 'runs.jsonl');
export function recordRun(summary, { dryRun }) {
  if (!dryRun) appendFileSync(runsPath, JSON.stringify(summary) + '\n');
}
export function readRuns() {
  if (!existsSync(runsPath)) return [];
  return readFileSync(runsPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}
