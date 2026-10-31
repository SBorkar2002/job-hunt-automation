// npm run fill -- <job link>
// Opens a company's application form (Lever, Greenhouse, Ashby, Rippling, or any simple form),
// fills what it knows from your saved answers, attaches your resume, and drafts the note.
// It never submits: you check everything and click Submit yourself. If the page then shows
// a thank-you, the job is logged as Applied on the Career pages tab.
import { chromium } from 'playwright';
import { join } from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { config, answers, noteFor } from '../shared/config.mjs';
import { trackFor } from '../shared/filters.mjs';
import { logRow } from '../shared/sheet.mjs';
import { istNow, sleep } from './util.mjs';

const url = process.argv[2];
if (!url) { console.log('Usage: npm run fill -- <job link>'); process.exit(1); }
const RESUME = join(os.homedir(), 'Documents/Personal/Github/my-portfolio/public/Sejal_Borkar_Resume.pdf');
const PORTFOLIO = config.portfolio;
const LINKEDIN = 'https://www.linkedin.com/in/sejalborkar';

// The application page, not the description page, for the common systems.
function formUrl(u) {
  if (/jobs\.lever\.co\/[^/]+\/[0-9a-f-]+\/?$/.test(u)) return u.replace(/\/?$/, '/apply');
  if (/jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]+\/?$/.test(u)) return u.replace(/\/?$/, '/application');
  return u;
}

// What we can answer, by the field's label. Anything else is left for you.
const [first, ...rest] = 'Sejal Borkar'.split(' ');
const FIELDS = [
  [/^first name|given name/i, first],
  [/^last name|surname|family name/i, rest.join(' ')],
  [/^(full )?name\*?$|your name/i, 'Sejal Borkar'],
  [/e-?mail/i, answers.email],
  [/phone|mobile/i, answers.phone],
  [/current (company|employer)|organi[sz]ation/i, 'Epifi'],
  [/^(current )?location|city|where are you based/i, 'Bengaluru, India'],
  [/linkedin/i, LINKEDIN],
  [/portfolio|website|personal (site|link)|other link/i, PORTFOLIO],
  [/notice/i, answers.noticePeriod],
  [/current.*(ctc|salary|compensation)/i, answers.currentCtc],
  [/expected.*(ctc|salary|compensation)/i, answers.expectedCtc],
  [/(start|join).*date|earliest/i, answers.earliestStart],
  [/relocat/i, answers.relocate],
];
const NOTE = /cover letter|why .*(interest|join|work)|what interest|about you|additional information|message to/i;

const ctx = await chromium.launchPersistentContext(join(os.homedir(), '.jobbot/profiles/forms'), { channel: 'chrome', headless: false, viewport: null });
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto(formUrl(url), { waitUntil: 'domcontentloaded' });
await sleep(4000);

// Some pages need an "Apply" click to show the form.
if (!(await page.locator('input[type=file], input[type=email]').count())) {
  const open = page.getByRole('button', { name: /^apply( now| for this job)?$/i }).or(page.getByRole('link', { name: /^apply( now| for this job)?$/i })).first();
  if (await open.count()) { await open.click(); await sleep(3000); }
}

const info = await page.evaluate(() => ({
  og: document.querySelector('meta[property="og:title"]')?.content || '',
  h: (document.querySelector('.posting-header h2, h1, h2')?.innerText || '').trim(),
  title: document.title,
}));
const host = new URL(url);
const slug = /lever|ashby|greenhouse|rippling/.test(host.host) ? host.pathname.split('/').filter(Boolean).find(p => !/^(en-[a-z]+|jobs?)$/i.test(p)) || '' : host.host.replace(/^www\./, '').split('.')[0];
const company = (slug.charAt(0).toUpperCase() + slug.slice(1)).replace(/softwareprivatelimited$/i, '');
const role = (info.h && !/apply|application/i.test(info.h) ? info.h : info.og.replace(new RegExp(company, 'i'), '').replace(/^[\s|·:-]+|[\s|·:-]+$/g, '')) || info.title;
const job = { role, company, track: trackFor(role) || 'product' };

// Resume into the first file field that looks like it wants one.
const fileInputs = page.locator('input[type=file]');
let resumeDone = false;
for (let i = 0; i < await fileInputs.count() && existsSync(RESUME); i++) {
  const near = await fileInputs.nth(i).evaluate(e => (e.closest('label, div, fieldset')?.innerText || e.name || '').slice(0, 200));
  if (/resume|cv/i.test(near) || i === 0) { await fileInputs.nth(i).setInputFiles(RESUME); resumeDone = true; await sleep(3000); break; }
}

// Fill text fields by their labels.
const fields = await page.$$('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=submit]), textarea');
const filled = [], left = [];
for (const el of fields) {
  if (!(await el.isVisible())) continue;
  const label = await el.evaluate(e => {
    const t = (e.id && document.querySelector(`label[for="${e.id}"]`)?.innerText) || e.getAttribute('aria-label') || e.closest('label')?.innerText
      || e.closest('.application-question, [class*=question], [class*=field], li, fieldset')?.querySelector('label, legend, [class*=label], [class*=text]')?.innerText || e.placeholder || e.name || '';
    const q = e.closest('.application-question, [class*=question], li, fieldset')?.innerText?.split('\n')[0] || '';
    const pick = /^type your|^enter|^your answer/i.test(t.trim()) && q ? q : t;
    return pick.replace(/[✱*]/g, '').replace(/\s+/g, ' ').trim();
  });
  const required = await el.evaluate(e => e.required || e.getAttribute('aria-required') === 'true' || /\*/.test(e.closest('label, div')?.innerText?.slice(0, 120) || ''));
  if ((await el.inputValue().catch(() => '')).trim()) { filled.push(label + ' (already filled)'); continue; }
  const tag = await el.evaluate(e => e.tagName);
  if (tag === 'TEXTAREA' && NOTE.test(label)) {
    const note = noteFor(job, 'wellfound') ? noteFor(job, 'wellfound').replace(/\?ref=wellfound/, '?ref=careers') : null;
    if (note) { await el.fill(note); filled.push(`${label}: note drafted (check it)`); continue; }
  }
  const hit = FIELDS.find(([re]) => re.test(label));
  if (hit && hit[1]) { await el.fill(String(hit[1])); filled.push(label); continue; }
  if (required) left.push(label || '(a field with no label)');
}

console.log(`\n${company} · ${role}`);
console.log(`Resume: ${resumeDone ? 'attached' : 'not attached (no file field found)'}`);
console.log(`Filled: ${filled.join(', ') || 'nothing'}`);
console.log(left.length ? `For you to fill (required): ${left.join(' · ')}` : 'No required text fields left.');
console.log('Also check dropdowns, yes/no questions and the note, then click Submit yourself.');
console.log('Close the window when done. If the page shows a thank-you, it is logged as Applied.\n');

// Log only if a confirmation appears before she closes the window.
let applied = false;
const watch = setInterval(async () => {
  const t = await page.locator('body').innerText().catch(() => '');
  if (/thank you for (applying|your application)|application (has been )?(received|submitted)|we('| ha)ve received your application/i.test(t)) applied = true;
}, 2000);
await new Promise(resolve => { page.on('close', resolve); ctx.on('close', resolve); });
clearInterval(watch);
if (applied) {
  await logRow('Career pages', {
    company, role, jobLink: url, location: '', appliedAt: istNow(), action: 'Applied', status: 'Applied',
    resume: resumeDone ? 'Resume PDF' : 'None', note: filled.some(f => /note drafted/.test(f)) ? 'Note drafted by the helper, checked and sent by you' : 'None',
    notes: 'Filled by the helper, submitted by you',
  });
  console.log('Logged as Applied on the Career pages tab.');
} else console.log('No thank-you page seen, so nothing was logged.');
await ctx.close().catch(() => {});
