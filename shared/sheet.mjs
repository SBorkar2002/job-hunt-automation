// Talks to the Google Sheet through the Apps Script web app. In dry run it only prints.
// Network blips (for example right after the Mac wakes) get retries; rows that still
// can't be sent wait in a local queue and go out on the next run, so nothing is lost.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import './config.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const queueDir = join(os.homedir(), '.jobbot', 'state');
const queuePath = join(queueDir, 'pending-rows.json');
const readQueue = () => (existsSync(queuePath) ? JSON.parse(readFileSync(queuePath, 'utf8')) : []);
const writeQueue = q => { mkdirSync(queueDir, { recursive: true }); writeFileSync(queuePath, JSON.stringify(q, null, 2)); };

async function call(action, tab, job) {
  const url = process.env.SHEET_URL, secret = process.env.SHEET_SECRET;
  if (!url || !secret) throw new Error('Missing SHEET_URL or SHEET_SECRET in .env');
  let lastErr;
  for (const wait of [0, 5000, 15000, 30000]) {
    if (wait) await sleep(wait);
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify({ secret, action, tab, job }), redirect: 'follow' });
      const data = await res.json();
      if (!data.ok) throw new Error(`Sheet ${action} failed: ${data.error}`);
      return data;
    } catch (err) {
      lastErr = err;
      if (/bad secret|unknown tab|unknown action/.test(err.message)) break;
    }
  }
  throw lastErr;
}

// Sends rows left over from earlier runs. Keeps any that still fail.
async function flushQueue() {
  const q = readQueue();
  if (!q.length) return;
  const left = [];
  for (const item of q) {
    try { await call('add', item.tab, item.job); } catch { left.push(item); }
  }
  writeQueue(left);
}

// If the Sheet can't be reached, say "not logged" and let the local state stop repeats.
export async function alreadyLogged(tab, jobLink, { dryRun } = {}) {
  if (dryRun && !process.env.SHEET_URL) return false;
  try { return (await call('has', tab, { jobLink })).has; }
  catch (err) { console.log(`  (Sheet check skipped: ${err.message})`); return false; }
}

export async function logRow(tab, job, { dryRun } = {}) {
  if (dryRun) {
    console.log(`  [dry run] would log to ${tab}: ${job.action} | ${job.company} | ${job.role} | ${job.notes || ''}`);
    return false;
  }
  await flushQueue();
  try { return (await call('add', tab, job)).added; }
  catch (err) {
    writeQueue([...readQueue(), { tab, job }]);
    console.log(`  (Sheet unreachable, row saved to send next run: ${err.message})`);
    return false;
  }
}

// Changes an existing row (found by job link). Needs the 'update' action in Tracker.gs.
export async function updateRow(tab, job, { dryRun } = {}) {
  if (dryRun) {
    console.log(`  [dry run] would update ${tab} row: ${job.jobLink} -> ${job.status || job.action}`);
    return false;
  }
  try { return (await call('update', tab, job)).updated; }
  catch (err) { console.log(`  (Sheet update failed, will retry next run: ${err.message})`); return false; }
}
