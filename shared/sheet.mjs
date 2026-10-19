// Talks to the Google Sheet through the Apps Script web app. In dry run it only prints.
import './config.mjs';

async function call(action, tab, job) {
  const url = process.env.SHEET_URL, secret = process.env.SHEET_SECRET;
  if (!url || !secret) throw new Error('Missing SHEET_URL or SHEET_SECRET in .env');
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ secret, action, tab, job }), redirect: 'follow' });
  const data = await res.json();
  if (!data.ok) throw new Error(`Sheet ${action} failed: ${data.error}`);
  return data;
}

export async function alreadyLogged(tab, jobLink, { dryRun } = {}) {
  if (dryRun && !process.env.SHEET_URL) return false;
  return (await call('has', tab, { jobLink })).has;
}

export async function logRow(tab, job, { dryRun } = {}) {
  if (dryRun) {
    console.log(`  [dry run] would log to ${tab}: ${job.action} | ${job.company} | ${job.role} | ${job.notes || ''}`);
    return false;
  }
  return (await call('add', tab, job)).added;
}
