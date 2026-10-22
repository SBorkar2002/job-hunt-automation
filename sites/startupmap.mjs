// Bangalore Startup Map (bangalorestartupmap.com): find-only. It has no apply form of its own;
// each role links to the company's careers page, so the bot lists roles in the Sheet and she
// applies there (npm run fill -- <link> helps). Runs once a day.
//
// What we know (recon 23 Oct 2026):
// - Free directory by one person; no login; no terms page. robots.txt allows everything except /api,
//   so the bot never calls /api itself.
// - The design view (?hiring=1&track=design) lists the companies hiring designers (in grid view).
// - Each company page (/company/<slug>?hiring=1&track=design) lists its design roles: title, level,
//   "Posted ...", and an "Apply ↗" link to the company's own job board. Data refreshes daily.
// - Pages are read a few seconds apart, about 40 a day.
import { sleep } from '../core/util.mjs';

const BASE = 'https://www.bangalorestartupmap.com';
const LIST = `${BASE}/?hiring=1&track=design`;
let companiesSeen = 0;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// "Posted 8 days ago", "Posted 3 hours ago", "Posted today", "Posted 22 Jul" -> hours ago.
export function postedHours(text) {
  const t = (text || '').toLowerCase().replace(/^posted\s+/, '');
  if (/today|just now/.test(t)) return 0;
  if (/yesterday/.test(t)) return 24;
  let m = t.match(/(\d+)\s*(hour|day|week|month)s?\s*ago/);
  if (m) return Number(m[1]) * { hour: 1, day: 24, week: 168, month: 720 }[m[2]];
  m = t.match(/(\d{1,2})\s+([a-z]{3})/);
  if (m && MONTHS[m[2]] !== undefined) {
    const now = new Date();
    let d = new Date(now.getFullYear(), MONTHS[m[2]], Number(m[1]));
    if (d > now) d = new Date(now.getFullYear() - 1, MONTHS[m[2]], Number(m[1]));
    return (now - d) / 36e5;
  }
  return null;
}
const LEVEL_YEARS = { fresher: 0, junior: 0, mid: 2, senior: 5, lead: 7 };

const site = {
  name: 'startupmap',
  label: 'Startup Map',
  findOnly: true,
  loginUrl: LIST,
  loggedIn: () => true,
  loggedOut: () => false,
  isLoggedIn: async () => true,
  listUrl: LIST,
  watch() {},

  async jobs(page) {
    companiesSeen = 0;
    await page.goto(LIST, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    const grid = page.getByRole('button', { name: /^grid$/i }).first();
    if (await grid.count()) { await grid.click(); await sleep(3000); }
    const slugs = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/company/"]')]
      .map(a => new URL(a.href).pathname.split('/')[2]).filter(Boolean))]);
    companiesSeen = slugs.length;

    const jobs = [];
    for (const slug of slugs) {
      await sleep(2000 + Math.random() * 1500); // gentle: a person's pace
      await page.goto(`${BASE}/company/${slug}?hiring=1&track=design`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(1500);
      const found = await page.evaluate(() => {
        const company = (document.querySelector('h1')?.innerText || '').trim();
        return [...document.querySelectorAll('a')].filter(a => /^apply/i.test(a.innerText.trim())).map(a => {
          let card = a.parentElement;
          while (card && card.innerText.split('\n').filter(Boolean).length < 4) card = card.parentElement;
          const lines = (card?.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
          return { company, link: a.href, lines };
        });
      });
      for (const f of found) {
        const role = f.lines[0] || '';
        const level = f.lines.find(l => /^(fresher|junior|mid|senior|lead|unspecified)$/i.test(l)) || '';
        const posted = (f.lines.find(l => /^posted/i.test(l)) || '').replace(/^posted\s+/i, '');
        const years = LEVEL_YEARS[level.toLowerCase()];
        jobs.push({
          id: f.link, role, company: f.company || slug, location: 'Bengaluru', jobLink: f.link,
          level, posted, postedHoursAgo: postedHours(posted), minYears: years ?? null,
        });
      }
    }
    // Newest first.
    return jobs.sort((a, b) => (a.postedHoursAgo ?? 1e9) - (b.postedHoursAgo ?? 1e9));
  },

  async check() {
    return companiesSeen ? null : 'The design list showed no companies (page layout may have changed)';
  },

  details: async () => ({}),
  apply: async () => ({ needs: 'Find-only source' }),
  isApplied: async () => false,
  sent: () => ({ resume: 'None', note: 'None' }),
};

export default site;
