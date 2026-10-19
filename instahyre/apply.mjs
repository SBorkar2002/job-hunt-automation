// Instahyre applier. Runs on this Mac in the bot's own Chrome profile (log in first: npm run instahyre:login).
//
//   npm run instahyre:dry       read jobs, decide, log nothing, apply to nothing (default)
//   npm run instahyre:inspect   also save page text, screenshots and job data to instahyre/debug/
//   npm run instahyre:live      apply for real, up to the daily cap
//   add -- --limit 1            apply to at most one job this run
//
// Flow: open Opportunities > logged in? > CAPTCHA? > list jobs > already done? > fits? > cap left?
//       > open job > Apply or Interested > fill any form from saved answers > submit > log row.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { config, answers, profileDir, noteFor, ROOT } from '../shared/config.mjs';
import { fits } from '../shared/filters.mjs';
import { alreadyLogged, logRow } from '../shared/sheet.mjs';

const SITE = 'instahyre';
const { tab: TAB, dailyCap, minGapSeconds } = config.sites[SITE];
const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const INSPECT = args.includes('--inspect');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
const DRY = !LIVE;

const URLS = {
  opportunities: 'https://www.instahyre.com/candidate/opportunities/',
};

// Text patterns, not CSS paths, so small redesigns don't break the script.
// Marked provisional until checked against the logged-in page with --inspect.
const TEXT = {
  view: /^\s*view\s*$/i,
  apply: /^\s*(apply|apply now|interested|i'?m interested)\s*$/i,
  submit: /^\s*(submit|apply|send|send application|confirm)\s*$/i,
  done: /(applied|application (sent|submitted)|you have applied)/i,
  captcha: /(verify you are human|are you a robot|captcha|unusual traffic)/i,
};

// Form labels we can answer. Anything else that is required means "Needs you".
const FIELDS = [
  { re: /phone|mobile/i, value: () => answers.phone },
  { re: /e-?mail/i, value: () => answers.email },
  { re: /notice/i, value: () => answers.noticePeriod },
  { re: /current.*(ctc|salary|compensation)/i, value: () => answers.currentCtc },
  { re: /expected.*(ctc|salary|compensation)/i, value: () => answers.expectedCtc },
  { re: /(join|start).*date|earliest/i, value: () => answers.earliestStart },
  { re: /relocat/i, value: () => answers.relocate },
  { re: /portfolio|website|link/i, value: () => `${config.portfolio}/?ref=${config.sites[SITE].ref}` },
];

// ---------- local state: daily cap and jobs already handled ----------
const stateDir = join(os.homedir(), '.jobbot', 'state');
const statePath = join(stateDir, `${SITE}.json`);
mkdirSync(stateDir, { recursive: true });
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { handled: {}, days: {} };
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const appliedToday = () => (state.days[today] || []).length;
const saveState = () => { if (!DRY) writeFileSync(statePath, JSON.stringify(state, null, 2)); };

const debugDir = join(ROOT, 'instahyre', 'debug');
if (INSPECT) mkdirSync(debugDir, { recursive: true });

const counts = { found: 0, skipped: 0, applied: 0, needsYou: 0 };
const skips = {};
const log = (...a) => console.log(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pause = () => sleep((minGapSeconds + Math.random() * minGapSeconds) * 1000);

async function snapshot(page, name) {
  if (!INSPECT) return;
  await page.screenshot({ path: join(debugDir, `${name}.png`), fullPage: true });
  writeFileSync(join(debugDir, `${name}.txt`), await page.locator('body').innerText());
  log(`  saved instahyre/debug/${name}.png and .txt`);
}

async function blocked(page) {
  if (/\/login/.test(page.url())) return 'Logged out. Run npm run instahyre:login';
  const frames = page.frames().map(f => f.url()).join(' ');
  if (/recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(frames)) return 'CAPTCHA shown. Finish it by hand';
  const text = await page.locator('body').innerText().catch(() => '');
  if (TEXT.captcha.test(text)) return 'Bot check shown. Finish it by hand';
  return null;
}

async function needsYou(job, reason) {
  counts.needsYou++;
  log(`  NEEDS YOU: ${job.company || '?'} | ${job.role || '?'} | ${reason}`);
  await logRow(TAB, { ...job, action: 'Needs you', status: 'Needs you', notes: reason }, { dryRun: DRY });
}

// ---------- reading jobs ----------
// Instahyre loads opportunities as JSON. We keep any job-like objects it sends,
// and fall back to reading the cards on screen.
const seenJson = [];
function collectJson(body) {
  const walk = (v, depth = 0) => {
    if (!v || depth > 6) return;
    if (Array.isArray(v)) return v.forEach(x => walk(x, depth + 1));
    if (typeof v === 'object') {
      const keys = Object.keys(v).join(' ');
      if (/(designation|title|job_title)/i.test(keys) && /(employer|company)/i.test(keys)) seenJson.push(v);
      Object.values(v).forEach(x => walk(x, depth + 1));
    }
  };
  walk(body);
}

function fromJson(o) {
  const pick = (...ks) => { for (const k of ks) { const v = k.split('.').reduce((a, p) => a?.[p], o); if (v) return v; } return ''; };
  const loc = pick('locations', 'location', 'job.locations');
  return {
    id: String(pick('id', 'job.id', 'opportunity_id')),
    role: pick('designation', 'title', 'job_title', 'job.designation', 'job.title'),
    company: pick('employer.company_name', 'employer.name', 'company_name', 'company.name', 'employer'),
    location: Array.isArray(loc) ? loc.map(l => l.name || l).join(', ') : String(loc || ''),
    jobLink: pick('public_url', 'url', 'job.public_url') || '',
    postedAt: pick('created_at', 'posted_at', 'job.created_at') || '',
  };
}

async function readJobs(page) {
  const jobs = seenJson.map(fromJson).filter(j => j.role && j.company);
  if (jobs.length) return dedupe(jobs);

  // Fallback: each card that has a View button.
  const cards = page.getByRole('button', { name: TEXT.view });
  const n = await cards.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i).locator('xpath=ancestor::*[self::div or self::li][string-length(normalize-space()) > 30][1]');
    const lines = (await card.innerText().catch(() => '')).split('\n').map(s => s.trim()).filter(Boolean);
    out.push({ id: `card-${i}-${lines.slice(0, 2).join('|')}`, role: lines[0] || '', company: lines[1] || '', location: lines.find(l => /,|remote|bangalore|bengaluru|mumbai/i.test(l)) || '', cardIndex: i });
  }
  return out;
}

const dedupe = jobs => [...new Map(jobs.map(j => [j.id || j.role + j.company, j])).values()];

// ---------- applying ----------
async function fillForm(page, job) {
  const dialog = page.getByRole('dialog').last();
  const scope = (await dialog.count()) ? dialog : page;
  const inputs = scope.locator('input:visible, textarea:visible, select:visible');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    const type = (await el.getAttribute('type')) || '';
    if (/hidden|submit|button|checkbox|radio|file/i.test(type)) continue;
    if ((await el.inputValue().catch(() => '')).trim()) continue;
    const label = await el.evaluate(e => {
      const byFor = e.id && document.querySelector(`label[for="${e.id}"]`);
      return (byFor?.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.name || e.closest('label')?.innerText || '').trim();
    });
    const tag = await el.evaluate(e => e.tagName);
    if (tag === 'TEXTAREA' && /(note|message|cover|why|about)/i.test(label + ' textarea')) {
      await el.fill(noteFor(job, SITE));
      continue;
    }
    const field = FIELDS.find(f => f.re.test(label));
    const value = field?.value();
    if (value) { await el.fill(String(value)); continue; }
    const required = await el.evaluate(e => e.required || e.getAttribute('aria-required') === 'true');
    if (required) return `Form asks "${label || 'an unlabeled field'}" and there is no saved answer`;
  }
  return null;
}

async function applyTo(page, job) {
  // Open the job.
  if (job.jobLink) await page.goto(job.jobLink);
  else if (job.cardIndex != null) await page.getByRole('button', { name: TEXT.view }).nth(job.cardIndex).click();
  await page.waitForLoadState('domcontentloaded');
  await sleep(1500);
  job.jobLink = job.jobLink || page.url();
  await snapshot(page, `job-${counts.found}`);

  const why = await blocked(page);
  if (why) return { stop: why };

  const apply = page.getByRole('button', { name: TEXT.apply }).or(page.getByRole('link', { name: TEXT.apply })).first();
  if (!(await apply.count())) return { needs: 'No Apply or Interested button found' };

  // A link that leaves Instahyre means the company's own site.
  const href = await apply.getAttribute('href').catch(() => null);
  if (href && !/instahyre\.com/.test(new URL(href, page.url()).host)) {
    return { needs: `Applies on the company site: ${new URL(href, page.url()).href}` };
  }

  if (DRY) return { dry: true };

  const popup = page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null);
  await apply.click();
  const newTab = await popup;
  if (newTab) {
    const url = newTab.url();
    await newTab.close();
    return { needs: `Applies on the company site: ${url}` };
  }
  await sleep(1500);

  const formIssue = await fillForm(page, job);
  if (formIssue) {
    await page.keyboard.press('Escape');
    return { needs: formIssue };
  }
  const submit = page.getByRole('dialog').getByRole('button', { name: TEXT.submit }).first();
  if (await submit.count()) { await submit.click(); await sleep(2000); }

  const text = await page.locator('body').innerText();
  if (!TEXT.done.test(text)) return { needs: 'Clicked apply but could not confirm it went through. Please check' };
  return { applied: true };
}

// ---------- run ----------
log(`Instahyre run: ${DRY ? 'DRY RUN (applies to nothing, logs nothing)' : 'LIVE'}${INSPECT ? ' + inspect' : ''}`);
log(`Applied today: ${appliedToday()} of ${dailyCap}`);

const ctx = await chromium.launchPersistentContext(profileDir(SITE), { channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 } });
const page = ctx.pages()[0] || await ctx.newPage();
page.on('response', async r => {
  if (!/json/.test(r.headers()['content-type'] || '')) return;
  try { collectJson(await r.json()); } catch {}
  if (INSPECT && /instahyre\.com\/api/.test(r.url())) {
    try { writeFileSync(join(debugDir, `api-${Date.now()}.json`), JSON.stringify({ url: r.url(), body: await r.json() }, null, 2)); } catch {}
  }
});

try {
  await page.goto(URLS.opportunities, { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  await snapshot(page, 'opportunities');

  const stop = await blocked(page);
  if (stop) {
    log(`STOP: ${stop}`);
    await needsYou({ company: 'Instahyre', role: '(whole site)', jobLink: URLS.opportunities }, stop);
  } else {
    const jobs = await readJobs(page);
    counts.found = jobs.length;
    log(`Found ${jobs.length} opportunities`);

    for (const job of jobs) {
      const key = job.id || `${job.company}|${job.role}`;
      const label = `${job.company} | ${job.role} | ${job.location}`;
      if (state.handled[key]) { counts.skipped++; skips['already handled'] = (skips['already handled'] || 0) + 1; continue; }
      if (job.jobLink && await alreadyLogged(TAB, job.jobLink, { dryRun: DRY })) { counts.skipped++; skips['already in Sheet'] = (skips['already in Sheet'] || 0) + 1; continue; }

      const fit = fits(job);
      if (!fit.ok) { counts.skipped++; skips[fit.reason.split(' "')[0]] = (skips[fit.reason.split(' "')[0]] || 0) + 1; log(`  skip: ${label} (${fit.reason})`); continue; }

      if (appliedToday() >= dailyCap) { log(`Daily cap of ${dailyCap} reached. Stopping.`); break; }
      if (counts.applied >= LIMIT) { log(`Limit of ${LIMIT} for this run reached. Stopping.`); break; }

      log(`  fits: ${label}`);
      const result = await applyTo(page, job);
      const row = { ...job, note: config.note.version, resume: config.resumeVersion, postedAt: job.postedAt || '' };

      if (result.stop) { log(`STOP: ${result.stop}`); await needsYou(row, result.stop); break; }
      if (result.needs) { await needsYou(row, result.needs); state.handled[key] = 'needs you'; }
      if (result.dry) { log(`  [dry run] would apply with note: "${noteFor(job, SITE)}"`); }
      if (result.applied) {
        counts.applied++;
        (state.days[today] ||= []).push(key);
        state.handled[key] = 'applied';
        await logRow(TAB, { ...row, action: 'Applied', status: 'Applied', appliedAt: new Date().toISOString() }, { dryRun: DRY });
        log(`  APPLIED: ${label}`);
      }
      saveState();
      await page.goto(URLS.opportunities, { waitUntil: 'domcontentloaded' });
      if (!DRY && (result.applied || result.needs)) await pause();
    }
  }
} catch (err) {
  log(`ERROR: ${err.message}`);
  process.exitCode = 1;
} finally {
  log(`\nDone. Found ${counts.found}, skipped ${counts.skipped}, applied ${counts.applied}, needs you ${counts.needsYou}.`);
  for (const [why, n] of Object.entries(skips)) log(`  skipped ${n}: ${why}`);
  await ctx.close();
}
