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
import { config, answers, profileDir, noteFor, noteVersion, ROOT } from '../shared/config.mjs';
import { fits, payTopLpa } from '../shared/filters.mjs';
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
  opportunities: 'https://www.instahyre.com/candidate/opportunities/?matching=true',
};

// Text patterns, not CSS paths, so small redesigns don't break the script.
// Marked provisional until checked against the logged-in page with --inspect.
const TEXT = {
  apply: /^\s*(apply|apply now|interested|i'?m interested)\s*$/i,
  submit: /^\s*(submit|apply|send|send application|confirm)\s*$/i,
  done: /application (sent|submitted)/i,
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
// The Opportunities page loads its list from candidate_matching as JSON. Each object has
// employer.company_name and job { id, title, locations, opportunity_url }. There is no posted
// date, so newer job ids (higher numbers) go first.
const feed = new Map();
function collectFeed(url, body) {
  if (!/candidate_opportunities\/candidate_matching\?/.test(url) || !Array.isArray(body?.objects)) return;
  for (const o of body.objects) {
    const j = o.job || {};
    if (!j.id || j.is_active === false || j.is_internship) continue;
    feed.set(String(j.id), {
      id: String(j.id),
      role: (j.title || j.candidate_title || '').trim(),
      company: (o.employer?.company_name || j.hiring_company_name || '').trim(),
      location: j.locations || '',
      jobLink: j.opportunity_url ? `https://www.instahyre.com${j.opportunity_url}` : '',
    });
  }
}

const readJobs = () => [...feed.values()].sort((x, y) => Number(y.id) - Number(x.id));

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
      const note = noteFor(job, SITE);
      if (!note) return `Form asks for a note and the ${job.track} note isn't approved yet`;
      await el.fill(note);
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
  await page.goto(job.jobLink, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await snapshot(page, `job-${counts.found}`);

  const why = await blocked(page);
  if (why) return { stop: why };

  // The job page shows experience like "1-5 Years" and sometimes pay. Recheck fit with both.
  const header = (await page.locator('body').innerText()).slice(0, 1500);
  const exp = header.match(/(\d+)\s*-\s*(\d+)\s*Years/i);
  if (exp) job.minYears = Number(exp[1]);
  job.payTop = payTopLpa(header);
  job.payChecked = true;
  const fit = fits(job);
  if (!fit.ok) return fit.needs ? { needs: fit.reason } : { skip: fit.reason };

  // The visible "Apply now" is a button inside a link that catches the mouse, so we trigger the button itself.
  const apply = page.getByRole('button', { name: TEXT.apply }).first();
  if (!(await apply.count())) return { needs: 'No Apply or Interested button found' };

  // A link that leaves Instahyre means the company's own site.
  const href = await apply.getAttribute('href').catch(() => null);
  if (href && !/instahyre\.com/.test(new URL(href, page.url()).host)) {
    return { needs: `Applies on the company site: ${new URL(href, page.url()).href}` };
  }

  if (DRY) return { dry: true };

  const popup = page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null);
  await apply.dispatchEvent('click');
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

  // Proven 20 Oct: Instahyre shows "Application sent!" and the Apply now button disappears.
  const text = await page.locator('body').innerText();
  const stillThere = await page.getByRole('button', { name: TEXT.apply }).count();
  if (!TEXT.done.test(text) && stillThere) return { needs: 'Clicked apply but could not confirm it went through. Please check' };
  return { applied: true };
}

// ---------- run ----------
log(`\n=== ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} ===`);
log(`Instahyre run: ${DRY ? 'DRY RUN (applies to nothing, logs nothing)' : 'LIVE'}${INSPECT ? ' + inspect' : ''}`);
log(`Applied today: ${appliedToday()} of ${dailyCap}`);

const ctx = await chromium.launchPersistentContext(profileDir(SITE), { channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 } });
const page = ctx.pages()[0] || await ctx.newPage();
page.on('response', async r => {
  if (!/json/.test(r.headers()['content-type'] || '')) return;
  try { collectFeed(r.url(), await r.json()); } catch {}
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
    const jobs = readJobs();
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

      job.track = fit.track;
      log(`  fits: ${label} (${fit.track})`);
      const result = await applyTo(page, job);
      const row = { ...job, note: noteVersion(job), resume: config.resumeVersion, postedAt: job.postedAt || '' };

      if (result.skip) { counts.skipped++; const k = /pay/.test(result.skip) ? 'pay' : 'experience'; skips[k] = (skips[k] || 0) + 1; log(`  skip: ${label} (${result.skip})`); await page.goto(URLS.opportunities, { waitUntil: 'domcontentloaded' }); continue; }
      if (result.stop) { log(`STOP: ${result.stop}`); await needsYou(row, result.stop); break; }
      if (result.needs) { await needsYou(row, result.needs); state.handled[key] = 'needs you'; }
      if (result.dry) { log(`  [dry run] would apply. Note if a form asks: ${noteFor(job, SITE) ? `"${noteFor(job, SITE)}"` : `(${job.track} note not approved yet)`}`); }
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
  log(/closed/.test(err.message) ? 'STOP: the bot window was closed during the run' : `ERROR: ${err.message}`);
  process.exitCode = 1;
} finally {
  log(`\nDone. Found ${counts.found}, skipped ${counts.skipped}, applied ${counts.applied}, needs you ${counts.needsYou}.`);
  for (const [why, n] of Object.entries(skips)) log(`  skipped ${n}: ${why}`);
  await ctx.close().catch(() => {});
}
