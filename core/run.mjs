// The shared runner. Every site plugs in its five parts (login, jobs, details, apply, isApplied);
// everything else lives here once: filters, Sheet, caps and pacing, the Needs you recheck,
// the same-job-on-two-sites rule, the start-of-run check, and the run summary.
//
//   node core/run.mjs <site>              dry run: reads and decides, applies to nothing, writes nothing
//   node core/run.mjs <site> --inspect    dry run plus page captures in ~/.jobbot/debug/<site>/
//   node core/run.mjs <site> --live       applies for real, up to the site's daily cap
//   node core/run.mjs <site> --live --limit 1
//   node core/run.mjs <site> --login      opens the bot's Chrome for her to log in once
//
// Flow: open job list > logged in? bot check? page as expected? > recheck Needs you jobs
//   > for each job: done before? fits? cap left? applied on another site? > job page fits?
//   > apply > Sheet row > Runs row and Health line.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, profileDir } from '../shared/config.mjs';
import { fits } from '../shared/filters.mjs';
import { alreadyLogged, logRow, updateRow, logRun, lookup, notify } from '../shared/sheet.mjs';
import { siteState, appliedAnywhere, recordApplied, recordRun } from './state.mjs';
import { sleep, istNow, nextRunIst, jobKey, capture, debugDir, pruneDebug } from './util.mjs';

const [siteName, ...args] = process.argv.slice(2);
const site = (await import(`../sites/${siteName}.mjs`)).default;
const { tab: TAB, dailyCap, perRunCap = Infinity, minGapSeconds } = config.sites[site.name];
const LIVE = args.includes('--live');
const DRY = !LIVE;
const INSPECT = args.includes('--inspect');
const limitAt = args.indexOf('--limit');
const LIMIT = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
// --only <job id>: one job she asked for by name. Filters are skipped for it (caps and safety checks are not).
const onlyAt = args.indexOf('--only');
const ONLY = onlyAt >= 0 ? String(args[onlyAt + 1]) : null;
const log = (...a) => console.log(...a);

// ---------- login ----------
// Sites that sign in with Google open in plain Chrome (not driven by the bot), because Google
// refuses sign-in in a browser a script controls. She logs in herself and quits Chrome;
// the bot then reuses that saved login (same profile, same Mac keychain).
if (args.includes('--login') && site.plainLogin) {
  const { spawn } = await import('node:child_process');
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [`--user-data-dir=${profileDir(site.name)}`, '--no-first-run', '--no-default-browser-check', site.loginUrl], { stdio: 'ignore' });
  log(`Log in to ${site.label} in the Chrome window that opened (Google sign-in works here).`);
  log('When you see your name or photo on the site, quit that Chrome with Cmd + Q.');
  await new Promise(resolve => chrome.on('exit', resolve));
  log('Chrome closed. Checking the login after a restart...');
  await sleep(2000);
}

// Sites logged in through plain Chrome store cookies locked with the Mac's real keychain,
// so the bot's Chrome must use the real keychain too (Playwright's default is a stand-in).
const ctx = await chromium.launchPersistentContext(profileDir(site.name), {
  channel: 'chrome', headless: false, viewport: args.includes('--login') ? null : { width: 1280, height: 900 },
  ...(site.plainLogin ? { ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'] } : {}),
});
const page = ctx.pages()[0] || await ctx.newPage();

if (args.includes('--login') && site.plainLogin) {
  await page.goto(site.listUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const ok = await site.isLoggedIn(page);
  await ctx.close().catch(() => {});
  log(ok ? 'Logged in and saved. The login survived a Chrome restart.' : `Still logged out after a restart. Run npm run ${site.name}:login again.`);
  process.exit(0);
}

if (args.includes('--login')) {
  await page.goto(site.loginUrl);
  log(`Log in to ${site.label} in the window that opened. It closes by itself once you are in.`);
  const loggedIn = page.waitForURL(u => site.loggedIn(u.href), { timeout: 15 * 60 * 1000 }).then(() => true).catch(() => false);
  const closed = new Promise(resolve => page.on('close', () => resolve(false)));
  const ok = await Promise.race([loggedIn, closed]);
  if (ok) await page.waitForTimeout(4000);
  await ctx.close().catch(() => {});
  log(ok ? 'Logged in and saved.' : `Window closed before login finished. Run npm run ${site.name}:login again.`);
  process.exit(0);
}

// ---------- run ----------
const state = siteState(site.name, { dryRun: DRY });
const s = state.data;
const summary = {
  runAt: istNow(), site: site.label, mode: DRY ? 'dry run' : 'live',
  seen: 0, matched: 0, applied: 0, needsYou: 0, youApplied: 0,
  needsTop: '', skipped: {}, nearMisses: [], errors: [], health: 'OK',
  appliedToday: state.appliedToday(), cap: dailyCap, nextRun: nextRunIst(config.sites[site.name].runMinute || 0, config.schedule.runHours),
};
const skip = (reason, label) => {
  summary.skipped[reason] = (summary.skipped[reason] || 0) + 1;
  if (label) log(`  skip: ${label}`);
};
const pause = () => sleep((minGapSeconds + Math.random() * minGapSeconds) * 1000);

site.watch(page);
if (INSPECT) {
  page.on('response', async r => {
    if (!/json/.test(r.headers()['content-type'] || '') || !r.url().includes(new URL(site.listUrl).host)) return;
    try { writeFileSync(join(debugDir(site.name), `api-${Date.now()}.json`), JSON.stringify({ url: r.url(), body: await r.json() }, null, 2)); } catch {}
  });
}

async function blocked() {
  if (site.loggedOut(page.url())) return { health: 'Login expired', msg: `Logged out. Run npm run ${site.name}:login` };
  const frames = page.frames().map(f => f.url()).join(' ');
  const text = await page.locator('body').innerText().catch(() => '');
  if (/recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(frames) || /(verify you are human|are you a robot|unusual traffic)/i.test(text)) {
    return { health: 'Bot check', msg: 'A bot check (CAPTCHA) appeared. Open the site yourself and finish it' };
  }
  return null;
}

async function needsYou(job, reason) {
  summary.needsYou++;
  summary.needsTop ||= reason;
  log(`  NEEDS YOU: ${job.company} | ${job.role} | ${reason}`);
  await logRow(TAB, { ...job, action: 'Needs you', status: 'Needs you', notes: [job.notes, reason].filter(Boolean).join(' · ') }, { dryRun: DRY });
}

// Fills the plain-words Sheet columns for a job.
const rowFor = job => {
  const sent = site.sent(job);
  return {
    ...job,
    resume: sent.resume,
    note: sent.note,
    notes: [ONLY && 'Applied on your request, outside the filters', `track: ${job.track}`, job.experience, job.pay ? `pay ${job.pay.split('•')[0].trim()}` : job.payTop != null && `pay up to ${job.payTop} LPA`].filter(Boolean).join(' · '),
  };
};

// Same company and role already applied to on another site? Returns null to go ahead,
// or a reason to hold off (and logs the row once so the Sheet explains it).
async function crossSiteHold(job, key) {
  const prior = appliedAnywhere()[key];
  if (!prior || prior.site === site.label) return null;
  const { mode = 'after-days', days = 7 } = config.crossSite || {};
  if (mode === 'always') return null;
  const since = (Date.now() - new Date(prior.date.replace(' ', 'T') + '+05:30')) / 864e5;
  const note = `Already applied via ${prior.site} on ${prior.date.slice(0, 10)}`;
  if (mode === 'after-days' && since >= days) {
    const rows = await lookup(job.company, job.role);
    if (rows === null) return `${note}; could not check for a reply yet`;
    if (rows.some(r => /Replied|Interview|Offer|Rejected/.test(r.status))) { s.handled[job.id] = 'replied elsewhere'; return `${note}, and they replied there`; }
    return null; // no reply after the wait: apply here too
  }
  if (!s.crossWait[key]) {
    s.crossWait[key] = { jobId: job.id };
    const after = mode === 'after-days' ? `. Applies here after ${days} days if no reply` : '';
    await logRow(TAB, { ...job, action: 'Skipped', status: 'Skipped', resume: 'None', note: 'None', notes: note + after }, { dryRun: DRY });
  }
  if (mode === 'once') s.handled[job.id] = 'applied elsewhere';
  return note;
}

let stop = false;
try {
  log(`\n=== ${summary.runAt} IST · ${site.label} · ${DRY ? 'DRY RUN (applies to nothing, writes nothing)' : 'LIVE'}${INSPECT ? ' + inspect' : ''} ===`);
  log(`Applied today: ${summary.appliedToday} of ${dailyCap}`);

  const jobs = await site.jobs(page);
  if (INSPECT) await capture(page, site.name, 'list');
  const block = await blocked();
  const changed = !block && await site.check(page);
  if (block || changed) {
    summary.health = block ? block.health : /^SITE: /.test(changed) ? 'Site error' : `Needs fix: ${changed}`;
    summary.errors.push(block ? block.msg : changed.replace(/^SITE: /, ''));
    await capture(page, site.name, 'start-check');
    log(`STOP: ${block ? block.msg : changed}`);
    stop = true;
  }

  if (!stop) {
    summary.seen = jobs.length;
    log(`Found ${jobs.length} jobs`);

    // New messages from companies: email her (the site may not).
    if (site.messages) {
      const convos = await site.messages(page);
      if (convos === null) summary.errors.push('Could not read Messages');
      s.seenMessages ||= {};
      for (const c of convos || []) {
        if (c.mine || s.seenMessages[c.id]) continue;
        log(`  NEW MESSAGE: ${c.company} (${c.from}): ${c.body.slice(0, 80)}`);
        if (!DRY && await notify({ site: site.label, company: c.company, from: c.from, body: c.body, sentAt: c.sentAt ? istNow(c.sentAt) : '', link: 'https://wellfound.com/jobs/messages' })) s.seenMessages[c.id] = istNow();
        summary.newMessages = (summary.newMessages || 0) + 1;
      }
      state.save();
    }

    // Needs you jobs: did she apply herself?
    for (const j of jobs) if (s.handled[j.id] === 'needs you' && !s.needs[j.id] && j.jobLink) s.needs[j.id] = { jobLink: j.jobLink, company: j.company, role: j.role };
    for (const [id, j] of Object.entries(s.needs)) {
      if (!(await site.isApplied(page, j))) continue;
      const ok = await updateRow(TAB, { jobLink: j.jobLink, action: 'Applied', status: 'Applied', appliedAt: istNow(), notes: 'You applied yourself (time is when the bot noticed)' }, { dryRun: DRY });
      log(`  you applied: ${j.company} | ${j.role}${ok ? ' (row updated)' : ''}`);
      if (ok) {
        delete s.needs[id]; s.handled[id] = 'applied by you'; summary.youApplied++;
        recordApplied(jobKey(j), { site: site.label, date: istNow(), jobLink: j.jobLink, by: 'you' }, { dryRun: DRY });
      }
    }

    for (const job of ONLY ? jobs.filter(j => j.id === ONLY) : jobs) {
      const label = `${job.company} | ${job.role} | ${job.location}`;
      const key = jobKey(job);
      if (s.handled[job.id]) { skip('done before'); continue; }
      if (job.jobLink && !s.crossWait[key] && await alreadyLogged(TAB, job.jobLink, { dryRun: DRY })) { skip('already in Sheet'); continue; }

      const fit = ONLY ? { ok: true, track: fits(job, site.name).track || 'product' } : fits(job, site.name);
      if (!fit.ok) {
        const reason = fit.reason.startsWith('title') ? 'title' : fit.reason.split(' ')[0];
        skip(reason, `${label} (${fit.reason})`);
        if (reason === 'title' && /design|artist|illustrat|creative|ux|ui\b|visual|brand|motion|animat/i.test(job.role)) summary.nearMisses.push(job.role);
        continue;
      }
      if (state.appliedToday() >= dailyCap) { log(`Daily cap of ${dailyCap} reached.`); break; }
      if (summary.applied >= LIMIT) { log(`Limit of ${LIMIT} for this run reached.`); break; }
      if (summary.applied >= perRunCap) { log(`${perRunCap} applied this run; the rest wait for the next run.`); break; }

      job.track = fit.track;
      // She skipped this company and role before (on any site): never bring it back.
      const known = DRY ? null : await lookup(job.company, job.role);
      if (known && known.some(r => r.tab === 'Skipped')) { s.handled[job.id] = 'skipped by you'; skip('you skipped it before', `${label} (you skipped it before)`); continue; }
      const hold = await crossSiteHold(job, key);
      if (hold) { skip('applied on another site', `${label} (${hold})`); continue; }

      Object.assign(job, await site.details(page, job), { payChecked: true });
      const midBlock = await blocked();
      if (midBlock) { summary.health = midBlock.health; summary.errors.push(midBlock.msg); log(`STOP: ${midBlock.msg}`); break; }
      if (INSPECT) await capture(page, site.name, `job-${job.id}`);

      const fit2 = ONLY ? { ok: true } : fits(job, site.name);
      if (!fit2.ok && !fit2.needs) { skip(fit2.reason.split(' ')[0] === 'pay' ? 'pay' : 'level', `${label} (${fit2.reason})`); s.handled[job.id] = 'skipped'; state.save(); continue; }
      summary.matched++;
      log(`  fits: ${label} (${fit.track})`);
      if (fit2.needs) { await needsYou(rowFor(job), fit2.reason); s.handled[job.id] = 'needs you'; s.needs[job.id] = { jobLink: job.jobLink, company: job.company, role: job.role }; state.save(); continue; }

      const result = await site.apply(page, job, { dryRun: DRY });
      if (result.broken) {
        summary.health = `Needs fix: ${result.broken}`; summary.errors.push(result.broken);
        await capture(page, site.name, 'apply-check');
        log(`STOP: ${result.broken}`);
        break;
      }
      if (result.dry) log(`  [dry run] would apply. ${site.sent(job).note.startsWith('None') ? 'No note.' : 'Note: ' + site.sent(job).note}`);
      if (result.needs) {
        await needsYou(rowFor(job), result.needs);
        s.handled[job.id] = 'needs you';
        s.needs[job.id] = { jobLink: job.jobLink, company: job.company, role: job.role };
      }
      if (result.applied) {
        summary.applied++;
        state.markApplied(job.id);
        recordApplied(key, { site: site.label, date: istNow(), jobLink: job.jobLink, by: 'bot' }, { dryRun: DRY });
        const row = { ...rowFor(job), action: 'Applied', status: 'Applied', appliedAt: istNow() };
        if (s.crossWait[key]) { await updateRow(TAB, { ...row, notes: 'No reply on the other site, so applied here too' }, { dryRun: DRY }); delete s.crossWait[key]; }
        else await logRow(TAB, row, { dryRun: DRY });
        log(`  APPLIED: ${label}`);
      }
      state.save();
      if (result.applied && !DRY) await pause();
    }
  }
} catch (err) {
  const msg = /closed/.test(err.message) ? 'The bot window was closed during the run' : err.message;
  summary.health = summary.health === 'OK' ? `Error: ${msg}` : summary.health;
  summary.errors.push(msg);
  log(`ERROR: ${msg}`);
  process.exitCode = 1;
} finally {
  state.save();
  summary.appliedToday = state.appliedToday();
  pruneDebug(site.name, INSPECT ? 60 : 12);
  const skipped = Object.entries(summary.skipped).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
  log(`\nDone. Seen ${summary.seen}, matched ${summary.matched}, applied ${summary.applied}, needs you ${summary.needsYou}${summary.youApplied ? `, you applied ${summary.youApplied}` : ''}. Skipped: ${skipped}.`);
  if (summary.nearMisses.length) log(`Near misses: ${[...new Set(summary.nearMisses)].join(', ')}`);
  log(`Health: ${summary.health}. Next run: ${summary.nextRun} IST.`);
  recordRun(summary, { dryRun: DRY });
  await logRun(summary, { dryRun: DRY });
  await ctx.close().catch(() => {});
}
