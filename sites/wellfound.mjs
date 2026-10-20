// Wellfound, in the five parts every site has: login, jobs, details, apply, isApplied.
// Plus check (start-of-run check) and sent (what goes out). The shared runner does the rest.
//
// What we know (recon 20 Oct 2026):
// - Login is Google sign-in, so it happens in plain Chrome (plainLogin) and the bot uses the
//   Mac's real keychain to read that login.
// - The Jobs page shows her saved search (Product Designer, Bengaluru, full time, remote open).
//   Results arrive as JSON from the GraphQL call JobSearchResultsX: company, title, pay,
//   locations, remote, posted time (liveStartAt), and whether she already applied.
// - Wellfound sends her profile as the application. Her profile reports complete.
// - Apply opens a dialog with "What interests you about working for this company?" and
//   "Send application". The timer never writes that note: jobs wait as "Needs note" until
//   she approves a note drafted in the automation chat (saved in ~/.jobbot/state/wellfound-notes.json).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, JOBBOT, istNow } from '../core/util.mjs';

const LIST = 'https://wellfound.com/jobs';
const feed = new Map();
let feedSeen = false;

// "₹2.5L – ₹3.5L • No equity" -> 3.5 (LPA). "₹75,000 – ₹1.5L" mixes units (monthly? yearly?),
// so it counts as unclear. Other currencies: null (kept in the pay text only).
export function readPay(comp) {
  const part = (comp || '').split('•')[0];
  const amounts = [...part.matchAll(/₹\s*([\d.,]+)\s*(L|Cr|k)?/gi)];
  if (!amounts.length) return { payTop: null, payUnclear: false };
  if (amounts.some(a => !a[2])) return { payTop: null, payUnclear: true };
  const lpa = a => Number(a[1].replace(/,/g, '')) * ({ l: 1, cr: 100, k: 0.01 }[a[2].toLowerCase()]);
  return { payTop: lpa(amounts.at(-1)), payUnclear: false };
}

function collect(url, req, body) {
  if (!/wellfound\.com\/graphql/.test(url) || !/JobSearchResults/.test(req || '')) return;
  const edges = body?.data?.talent?.jobSearchResults?.startups?.edges;
  if (!Array.isArray(edges)) return;
  feedSeen = true;
  for (const { node: s } of edges) {
    for (const j of s?.highlightedJobListings || []) {
      if (!j?.id) continue;
      const places = (j.locationNames || []).join(', ');
      feed.set(String(j.id), {
        id: String(j.id),
        role: (j.title || '').trim(),
        company: (s.name || '').trim(),
        location: j.remote ? `Remote${places ? ` (${places})` : ''}` : places,
        jobLink: `https://wellfound.com/jobs/${j.id}-${j.slug}`,
        postedAt: j.liveStartAt ? istNow(new Date(j.liveStartAt * 1000)) : '',
        postedHoursAgo: j.liveStartAt ? (Date.now() / 1000 - j.liveStartAt) / 3600 : null,
        pay: j.compensation || '',
        ...readPay(j.compensation),
        external: Boolean(j.atsSource),
        appliedHere: Boolean(j.currentUserApplied),
      });
    }
  }
}

// Notes she approved in the chat, per job id: { "<id>": "note text" }.
function approvedNote(id) {
  const p = join(JOBBOT, 'state', 'wellfound-notes.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'))[id] || null;
}

const site = {
  name: 'wellfound',
  label: 'Wellfound',
  loginUrl: 'https://wellfound.com/login',
  plainLogin: true, // she signs in with Google, which refuses script-driven browsers
  loggedIn: url => /wellfound\.com\/(jobs|role|candidates|profile|onboarding|discover|dashboard)/.test(url),
  loggedOut: url => /\/login/.test(url),
  // Public pages look similar when logged out, so look for the Log in link instead of the URL.
  isLoggedIn: async page => {
    const text = await page.locator('body').innerText().catch(() => '');
    if (text.length < 200) return false; // still loading
    return !(await page.getByRole('link', { name: /^(log in|create profile)$/i }).count());
  },
  listUrl: LIST,

  watch(page) {
    page.on('response', async r => {
      if (!/json/.test(r.headers()['content-type'] || '')) return;
      try { collect(r.url(), r.request().postData(), await r.json()); } catch {}
    });
  },

  // Her saved search, newest first. Scrolls once or twice to load the next page of results.
  async jobs(page) {
    feed.clear(); feedSeen = false;
    await page.goto(LIST, { waitUntil: 'domcontentloaded' });
    await sleep(6000);
    for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, 6000); await sleep(3000); }
    return [...feed.values()].sort((a, b) => (a.postedHoursAgo ?? 1e9) - (b.postedHoursAgo ?? 1e9));
  },

  // Start-of-run check: logged in, and the job list loaded as expected.
  async check(page) {
    if (!(await site.isLoggedIn(page))) return 'Logged out of Wellfound. Run npm run wellfound:login';
    return feedSeen ? null : 'The job list did not load (no JobSearchResults data)';
  },

  // Reads one job's page: experience asked.
  async details(page, job) {
    await page.goto(job.jobLink, { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    const text = await page.locator('body').innerText();
    const exp = text.match(/Experience\s*\n?\s*(\d+)\+?\s*years?/i) || text.match(/(\d+)\+\s*years? of experience/i);
    return {
      minYears: exp ? Number(exp[1]) : null,
      experience: exp ? `${exp[1]}+ years` : null,
      poster: '',
    };
  },

  // Applies on the open job page. Returns { applied } | { needs } | { broken } | { dry }.
  async apply(page, job, { dryRun }) {
    if (job.appliedHere) return { needs: 'Already applied on Wellfound (by you?)' };
    if (job.external) return { needs: `Applies on the company site. Open: ${job.jobLink}` };
    const button = page.getByRole('button', { name: /^apply( now)?$/i }).first();
    if (!(await button.count())) return { broken: 'Apply button not found on the job page' };

    const note = approvedNote(job.id);
    if (!note) return { needs: 'Needs note: Wellfound asks "What interests you about working for this company?". I draft it in the automation chat for your OK' };
    if (dryRun) return { dry: true };

    await button.click();
    await sleep(2500);
    const dialog = page.getByRole('dialog').last();
    if (!(await dialog.count())) return { broken: 'Apply form did not open' };
    const box = dialog.locator('textarea').first();
    if (await box.count()) { await box.fill(note); job.noteSent = note; }
    // Any other required field we can't answer: stop and leave it to her.
    const otherRequired = await dialog.locator('textarea[required], input[required]').evaluateAll(els => els.filter(e => !e.value).length);
    if (otherRequired) { await page.keyboard.press('Escape'); return { needs: 'The form asks more than the note. Please finish it yourself' }; }
    const send = dialog.getByRole('button', { name: /send application/i });
    if (!(await send.count())) { await page.keyboard.press('Escape'); return { broken: 'Send application button not found' }; }
    await send.click();
    await sleep(3000);
    if (await site.isApplied(page)) return { applied: true };
    return { needs: 'Clicked Send application but could not confirm it went through. Please check' };
  },

  // Applied (proven 20 Oct): the job page shows "✓ Applied" and no Apply button.
  // The menu also says "Applied", so the check needs the tick.
  async isApplied(page, job) {
    if (job) { await page.goto(job.jobLink, { waitUntil: 'domcontentloaded' }); await sleep(3000); }
    const text = await page.locator('body').innerText();
    const applyLeft = await page.getByRole('button', { name: /^apply( now)?$/i }).count();
    return /✓\s*Applied/.test(text) && !applyLeft;
  },

  // Exactly what went out, in plain words.
  sent(job) {
    return {
      resume: 'Wellfound profile (resume and links on it)',
      note: job.noteSent || 'None',
    };
  },
};

export default site;
