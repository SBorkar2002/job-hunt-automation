// Decides if a job fits. Returns { ok, reason, track } so every skip explains itself.
// track is the title group from config.tracks (product, visual, art, brand, graphic).
import { config } from './config.mjs';

const has = (text, words) => words.find(w => text.includes(w));
const tracks = Object.entries(config.tracks).filter(([k]) => !k.startsWith('_'));

export function trackFor(title) {
  const t = (title || '').toLowerCase();
  const hit = tracks.find(([, tr]) => has(t, tr.titles));
  return hit ? hit[0] : null;
}

// Reads pay like "₹ 6 - 10 LPA" or "8-12 Lakhs". Returns the top of the range in LPA, or null.
export function payTopLpa(text) {
  const m = (text || '').match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|l\b)/i)
    || (text || '').match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakhs? per annum)/i);
  return m ? Number(m[2] || m[1]) : null;
}

// site: optional site name, for per-site settings like postedWithinHours.
export function fits(job, site) {
  const title = (job.role || '').toLowerCase();
  const company = (job.company || '').toLowerCase();
  const where = (job.location || '').toLowerCase();
  const dream = config.dreamCompanies.some(c => company.includes(c.toLowerCase()));

  if (config.avoidCompanies.some(c => company.includes(c.toLowerCase()))) return { ok: false, reason: 'avoid list' };
  const track = trackFor(title);
  if (!track) return { ok: false, reason: `title "${job.role}" not in your list` };
  const bad = has(title, config.excludeWords);
  if (bad && !dream) return { ok: false, reason: `title has "${bad}"` };
  if (where && !has(where, config.locations)) return { ok: false, reason: `location "${job.location}"` };
  if (job.minYears != null && job.minYears > config.maxYearsRequired && !dream) return { ok: false, reason: `needs ${job.minYears}+ years` };
  const within = config.sites[site]?.postedWithinHours ?? config.postedWithinHours;
  if (job.postedHoursAgo != null && job.postedHoursAgo > within) {
    const d = job.postedHoursAgo / 24;
    return { ok: false, reason: `posted ${d >= 2 ? Math.round(d) + ' days' : Math.round(job.postedHoursAgo) + ' hours'} ago` };
  }
  // Any role: pay shown below the floor is skipped; pay shown but unclear goes to her.
  if (job.payUnclear) return { ok: false, needs: true, track, reason: `Pay unclear ("${job.pay}"). Apply yourself if it looks good` };
  if (config.minPayLpa && job.payTop != null && job.payTop < config.minPayLpa && !dream) return { ok: false, track, reason: `pay up to ${job.payTop} LPA, under ${config.minPayLpa}` };
  const minPay = config.tracks[track].minPayLpa;
  if (minPay && job.payChecked) {
    if (job.payTop == null) return { ok: false, needs: true, track, reason: `${job.role}: no pay shown. Apply yourself if it looks good` };
    if (job.payTop < minPay) return { ok: false, track, reason: `pay up to ${job.payTop} LPA, under ${minPay}` };
  }
  return { ok: true, track, reason: dream ? 'dream company' : `fits (${track})` };
}
