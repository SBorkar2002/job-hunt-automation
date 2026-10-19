// Decides if a job fits. Returns { ok, reason } so every skip explains itself.
import { config } from './config.mjs';

const has = (text, words) => words.find(w => text.includes(w));

export function fits(job) {
  const title = (job.role || '').toLowerCase();
  const company = (job.company || '').toLowerCase();
  const where = (job.location || '').toLowerCase();
  const dream = config.dreamCompanies.some(c => company.includes(c.toLowerCase()));

  if (config.avoidCompanies.some(c => company.includes(c.toLowerCase()))) return { ok: false, reason: 'avoid list' };
  if (!has(title, config.titles)) return { ok: false, reason: `title "${job.role}" not in your list` };
  const bad = has(title, config.excludeWords);
  if (bad && !dream) return { ok: false, reason: `title has "${bad}"` };
  if (where && !has(where, config.locations)) return { ok: false, reason: `location "${job.location}"` };
  if (job.minYears != null && job.minYears > config.maxYearsRequired && !dream) return { ok: false, reason: `needs ${job.minYears}+ years` };
  if (job.postedHoursAgo != null && job.postedHoursAgo > config.postedWithinHours) return { ok: false, reason: `posted ${Math.round(job.postedHoursAgo)}h ago` };
  return { ok: true, reason: dream ? 'dream company' : 'fits' };
}
