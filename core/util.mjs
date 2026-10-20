// Small helpers shared by every site.
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

export const JOBBOT = join(os.homedir(), '.jobbot');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
// Sheets reads "2026-10-20 09:42:05" as a real date in any locale, in the Sheet's time zone (IST).
export const istNow = (d = new Date()) => d.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' });
export const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const istHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));

// The timer runs on the hour from 8am to 11pm IST.
export function nextRunIst() {
  const h = istHour();
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  if (h >= 23 || h < 7) {
    const d = new Date(Date.now() + (h >= 23 ? 24 : 0) * 3600 * 1000);
    const day = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return `${day} 08:00:00`;
  }
  return istNow(next).slice(0, 14) + '00:00';
}

// Same company and role on two sites should match even with small differences.
export const normCompany = s => (s || '').toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llp|technologies|technology|labs?|india)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const normRole = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(jr|junior|sr|senior)\b/g, '').replace(/\s+/g, ' ').trim();
export const jobKey = job => `${normCompany(job.company)}|${normRole(job.role)}`;

// Page captures can hold her data, so each site keeps only the newest few.
export function debugDir(site) {
  const dir = join(JOBBOT, 'debug', site);
  mkdirSync(dir, { recursive: true });
  return dir;
}
export function pruneDebug(site, keep = 12) {
  const dir = debugDir(site);
  const files = readdirSync(dir).map(f => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(keep)) unlinkSync(join(dir, f));
}
export async function capture(page, site, name) {
  const dir = debugDir(site);
  const stamp = istNow().replace(/[: ]/g, '-');
  try {
    await page.screenshot({ path: join(dir, `${stamp}-${name}.png`), fullPage: true });
    writeFileSync(join(dir, `${stamp}-${name}.txt`), await page.locator('body').innerText());
  } catch {}
  pruneDebug(site);
  return dir;
}
