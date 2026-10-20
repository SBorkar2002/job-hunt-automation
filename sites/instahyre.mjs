// Instahyre, in the five parts every site has: login, jobs, details, apply, isApplied.
// Plus check (start-of-run check) and sent (what goes out). The shared runner does the rest.
//
// What we know (proven 20 Oct 2026):
// - The Opportunities page loads its list as JSON from candidate_matching. No posted date,
//   no applicant count, so newer job ids (higher numbers) go first.
// - A job page shows experience like "1-5 Years", sometimes pay, and who posted it.
// - "Apply now" is a button inside a link that catches the mouse, so we trigger the button.
// - After applying, the page shows "Application sent!" and the button is gone.
// - One-click apply sends the resume on her Instahyre profile and no note.
import { payTopLpa } from '../shared/filters.mjs';
import { fillForm } from '../core/forms.mjs';
import { sleep } from '../core/util.mjs';

const LIST = 'https://www.instahyre.com/candidate/opportunities/?matching=true';
const TEXT = {
  apply: /^\s*(apply|apply now|interested|i'?m interested)\s*$/i,
  submit: /^\s*(submit|apply|send|send application|confirm)\s*$/i,
  done: /application (sent|submitted)/i,
};

const feed = new Map();
let feedSeen = false;

function collect(url, body) {
  if (!/candidate_opportunities\/candidate_matching\?/.test(url) || !Array.isArray(body?.objects)) return;
  feedSeen = true;
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

export default {
  name: 'instahyre',
  label: 'Instahyre',
  loginUrl: 'https://www.instahyre.com/login/',
  loggedIn: url => /\/candidate\//.test(new URL(url).pathname),
  loggedOut: url => /\/login/.test(url),
  listUrl: LIST,

  watch(page) {
    page.on('response', async r => {
      if (!/json/.test(r.headers()['content-type'] || '')) return;
      try { collect(r.url(), await r.json()); } catch {}
    });
  },

  // Job list, newest first.
  async jobs(page) {
    feed.clear(); feedSeen = false;
    await page.goto(LIST, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    return [...feed.values()].sort((x, y) => Number(y.id) - Number(x.id));
  },

  // Start-of-run check: did the job list load the way we expect?
  async check() {
    return feedSeen ? null : 'The job list did not load (no candidate_matching data)';
  },

  // Reads one job's page: experience, pay, poster.
  async details(page, job) {
    await page.goto(job.jobLink, { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    const text = await page.locator('body').innerText();
    const header = text.slice(0, 1500);
    const exp = header.match(/(\d+)\s*-\s*(\d+)\s*Years/i);
    const poster = text.match(/Posted by ([^\n]{2,40})\n([^\n]{2,80})/)
      || header.match(/\n([A-Z][A-Za-z.' ]{1,40})\n((?:Recruiter|HR|Talent|Hiring|CEO|CTO|COO|Founder|Co-?founder|Head|Director|Manager|Design)[^\n]{0,60} at [^\n]{1,60})/);
    return {
      minYears: exp ? Number(exp[1]) : null,
      experience: exp ? `${exp[1]}-${exp[2]} years` : null,
      payTop: payTopLpa(header),
      poster: poster ? `${poster[1].trim()}, ${poster[2].trim()}` : '',
    };
  },

  // Applies on the open job page. Returns { applied } | { needs } | { broken } | { dry }.
  async apply(page, job, { dryRun }) {
    const button = page.getByRole('button', { name: TEXT.apply }).first();
    if (!(await button.count())) {
      if (TEXT.done.test(await page.locator('body').innerText())) return { needs: 'Already applied on Instahyre (by you?)' };
      return { broken: 'Apply now button not found on the job page' };
    }
    if (dryRun) return { dry: true };

    const popup = page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null);
    await button.dispatchEvent('click');
    const newTab = await popup;
    if (newTab) {
      const url = newTab.url();
      await newTab.close();
      return { needs: `Applies on the company site: ${url}` };
    }
    await sleep(1500);

    const formIssue = await fillForm(page, job, 'instahyre');
    if (formIssue) { await page.keyboard.press('Escape'); return { needs: formIssue }; }
    const submit = page.getByRole('dialog').getByRole('button', { name: TEXT.submit }).first();
    if (await submit.count()) { await submit.click(); await sleep(2000); }

    if (await this.isApplied(page)) return { applied: true };
    return { needs: 'Clicked apply but could not confirm it went through. Please check' };
  },

  // Applied = "Application sent!" on the page and no Apply button left.
  async isApplied(page, job) {
    if (job) { await page.goto(job.jobLink, { waitUntil: 'domcontentloaded' }); await sleep(2500); }
    const text = await page.locator('body').innerText();
    const left = await page.getByRole('button', { name: TEXT.apply }).count();
    return TEXT.done.test(text) && !left;
  },

  // Exactly what went out, in plain words.
  sent(job) {
    return {
      resume: 'Instahyre profile resume',
      note: job.noteSent ? job.noteSent : 'None (one-click apply, no note asked)',
    };
  },
};
