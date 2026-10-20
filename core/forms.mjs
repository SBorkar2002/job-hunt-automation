// Fills an apply form from saved answers. Shared by every site.
// Returns null when done, or the reason it needs her (never guesses an answer).
import { config, answers, noteFor } from '../shared/config.mjs';

const FIELDS = [
  { re: /phone|mobile/i, value: () => answers.phone },
  { re: /e-?mail/i, value: () => answers.email },
  { re: /notice/i, value: () => answers.noticePeriod },
  { re: /current.*(ctc|salary|compensation)/i, value: () => answers.currentCtc },
  { re: /expected.*(ctc|salary|compensation)/i, value: () => answers.expectedCtc },
  { re: /(join|start).*date|earliest/i, value: () => answers.earliestStart },
  { re: /relocat/i, value: () => answers.relocate },
  { re: /portfolio|website|link/i, value: site => `${config.portfolio}/?ref=${config.sites[site].ref}` },
];

export async function fillForm(page, job, site) {
  const dialog = page.getByRole('dialog').last();
  const scope = (await dialog.count()) ? dialog : page;
  const inputs = scope.locator('input:visible, textarea:visible, select:visible');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    const type = (await el.getAttribute('type')) || '';
    if (/hidden|submit|button|checkbox|radio|file|search/i.test(type)) continue;
    if ((await el.inputValue().catch(() => '')).trim()) continue;
    const label = await el.evaluate(e => {
      const byFor = e.id && document.querySelector(`label[for="${e.id}"]`);
      return (byFor?.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.name || e.closest('label')?.innerText || '').trim();
    });
    const tag = await el.evaluate(e => e.tagName);
    if (tag === 'TEXTAREA' && /(note|message|cover|why|about)/i.test(label + ' textarea')) {
      const note = noteFor(job, site);
      if (!note) return `Form asks for a note and the ${job.track} note isn't approved yet`;
      await el.fill(note);
      job.noteSent = note;
      continue;
    }
    const value = FIELDS.find(f => f.re.test(label))?.value(site);
    if (value) { await el.fill(String(value)); continue; }
    const required = await el.evaluate(e => e.required || e.getAttribute('aria-required') === 'true');
    if (required) return `Form asks "${label || 'an unlabeled field'}" and there is no saved answer`;
  }
  return null;
}
