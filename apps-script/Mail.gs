/**
 * Gmail side of the job hunt. Runs in Google's cloud on timers, so the laptop can be off.
 *
 *   checkAlerts   hourly   job alert emails (Glassdoor, LinkedIn, Naukri, Indeed) -> rows as Needs you
 *   checkReplies  hourly   replies from companies you applied to -> Status Replied / Interview / Rejected
 *   followUps     daily    Applied 7+ days, no reply -> a row in Follow-ups with a drafted nudge
 *   healthAlert   hourly   a site red for 3+ hours in the day -> one email to you
 *   weeklySummary Sunday   counts and open Needs you rows -> one email to you
 *
 * It only reads mail and labels the threads it handled (jobbot/seen). It never emails anyone but you.
 * Filters come from Config.gs, which the deploy writes from shared/config.json.
 */

const ALERT_SOURCES = [
  { tab: 'Glassdoor', query: 'from:(glassdoor.com OR glassdoor.co.in)', link: /https?:\/\/[^\s"'<>]*glassdoor\.[a-z.]+\/[^\s"'<>]*(job-listing|jobListing|partner\/jobListing)[^\s"'<>]*/gi },
  { tab: 'LinkedIn', query: 'from:(jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com)', link: /https?:\/\/[^\s"'<>]*linkedin\.com\/(comm\/)?jobs\/view\/\d+[^\s"'<>]*/gi },
  { tab: 'Naukri', query: 'from:(naukri.com)', link: /https?:\/\/[^\s"'<>]*naukri\.com\/[^\s"'<>]*job-listings[^\s"'<>]*/gi },
  { tab: 'Indeed', query: 'from:(indeed.com)', link: /https?:\/\/[^\s"'<>]*indeed\.com\/(rc\/clk|viewjob|pagead\/clk)[^\s"'<>]*/gi },
];
const SEEN = 'jobbot/seen';
const REPLY_SEEN = 'jobbot/reply-seen';
const LOCATION_HINT = /(bengaluru|bangalore|mumbai|delhi|gurgaon|gurugram|noida|pune|hyderabad|chennai|kolkata|remote|india|hybrid|on-?site|work from home)/i;

function label_(name) { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }
// Her address, saved once from the Mac (owner action). Needs no extra Google permission.
const me_ = () => { const e = props().getProperty('OWNER_EMAIL'); if (!e) throw new Error('OWNER_EMAIL not set'); return e; };
const istNow_ = () => Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');

/* ---------- filters (same rules as shared/filters.mjs) ---------- */

// Yearly pay in LPA when the email makes it clear: "₹3L - ₹5L", "₹30,00,000 a year". Else null.
function payLpa_(line) {
  const l = String(line || '');
  const lakh = l.match(/₹\s*([\d.]+)\s*L\b[^₹]*(?:₹\s*([\d.]+)\s*L\b)?/i);
  if (lakh) return Number(lakh[2] || lakh[1]);
  if (/a year|per (year|annum)/i.test(l)) {
    const nums = (l.match(/₹\s*[\d,]+/g) || []).map(n => Number(n.replace(/[₹,\s]/g, '')));
    if (nums.length) return Math.max.apply(null, nums) / 100000;
  }
  return null;
}
const GRAPHIC = /graphic|video edit|video creator|embroidery|social media (content|designer)/i;

function fits_(job) {
  const t = String(job.role || '').toLowerCase();
  const where = String(job.location || '').toLowerCase();
  const tracks = Object.keys(CONFIG.tracks).filter(k => k.charAt(0) !== '_');
  const track = tracks.find(k => CONFIG.tracks[k].titles.some(x => t.indexOf(x) >= 0));
  if (!track) return { ok: false, reason: 'title' };
  // Graphic and video roles only with clear pay of 8 LPA or more (her rule, 21 Oct).
  if ((track === 'graphic' || GRAPHIC.test(t)) && !(job.payTop >= 8)) return { ok: false, reason: 'graphic without good pay' };
  if (job.payTop != null && job.payTop < (CONFIG.minPayLpa || 0)) return { ok: false, reason: 'pay' };
  const bad = CONFIG.excludeWords.find(w => t.indexOf(w) >= 0);
  if (bad) return { ok: false, reason: 'title has "' + bad + '"' };
  // Alert emails always put a place in this field. "India" alone may mean remote, so it passes.
  if (where && where.trim() !== 'india' && !CONFIG.locations.some(l => where.indexOf(l) >= 0)) return { ok: false, reason: 'location' };
  return { ok: true, track: track };
}

/* ---------- 1. job alert emails ---------- */

// Reads one alert email's text. Each job is the block of lines that ends with its link.
// Layouts (seen 21 Oct 2026):
//   Glassdoor: company, title, place, [pay], [Easy Apply], age, link
//   Indeed:    title, "company - place" (or company, place), [salary], [job type], link
//   LinkedIn:  title, company, place, ..., link
const NOISE = /^(easy apply|easily apply|responsive employer|urgently hiring|hiring multiple candidates|just posted|new|actively (hiring|recruiting)|promoted|be an early applicant|\d+\s*(d|h|days?|hours?)( ago)?|\d+ (connections?|school alumni|applicants?)|salary:|job type:|work setting:|view job:?|apply now:?|.*employer est.*|.*\ba (year|month)$|.*per (year|month)$|[₹$€£].*)$/i;

function parseAlert_(plain, html, linkRe, tab) {
  const lines = String(plain || '').split(/\r?\n/).map(s => s.replace(/[\u200b-\u200f\u2060\ufeff\u034f]/g, '').trim()).filter(Boolean);
  const jobs = [];
  let block = [];
  lines.forEach(line => {
    linkRe.lastIndex = 0;
    const links = line.match(linkRe);
    linkRe.lastIndex = 0;
    if (!links) { block.push(line); return; }
    const before = line.replace(linkRe, '').replace(/[<>:]+$/, '').trim();
    linkRe.lastIndex = 0;
    if (before && !NOISE.test(before)) block.push(before);
    const ctx = block.filter(l => !NOISE.test(l) && l.length <= 100 && !/^\[image/i.test(l));
    const payLine = block.find(l => /[₹]/.test(l)) || '';
    if (ctx.length) jobs.push(Object.assign(toJob_(ctx, links[0], tab), { pay: payLine, payTop: payLpa_(payLine) }));
    block = [];
  });
  return jobs.filter(j => j.role && !/\bcreate$/i.test(j.role) && j.company);
}

function toJob_(ctx, link, tab) {
  let role = '', company = '', location = '';
  const tail = ctx.slice(-3);
  if (tab === 'Glassdoor') {
    // company, title, place
    [company, role, location] = tail.length === 3 ? tail : ['', tail[0] || '', tail[1] || ''];
  } else if (tab === 'Indeed') {
    const t = ctx.slice(-2);
    const dash = t[1] && t[1].match(/^(.*?)\s+-\s+(.*)$/);
    if (dash && LOCATION_HINT.test(dash[2])) { role = t[0]; company = dash[1]; location = dash[2]; }
    else { const u = ctx.slice(-3); role = u[0] || ''; company = u[1] || ''; location = u[2] || ''; }
  } else {
    // LinkedIn: title, company, place (first lines of the block)
    const c = ctx.slice(-4);
    role = c.find(l => /design|ux|ui\b|artist|illustrat|product/i.test(l)) || c[0] || '';
    const rest = c.slice(c.indexOf(role) + 1);
    company = rest[0] || '';
    location = rest.find(l => LOCATION_HINT.test(l)) || rest[1] || '';
  }
  company = company.replace(/\s+\d(\.\d)?\s*★$/, '');
  return { role: role.trim(), company: company.trim(), location: location.trim(), jobLink: cleanLink_(link) };
}

// Drops tracking parameters so the same job from two emails matches.
function cleanLink_(u) {
  const li = u.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/);
  if (li) return 'https://www.linkedin.com/jobs/view/' + li[1] + '/';
  return u.replace(/[?&](utm_[^&]+|trackingId=[^&]+|refId=[^&]+|src=[^&]+)/g, '').replace(/[?&]$/, '');
}

function checkAlerts() {
  const seen = label_(SEEN);
  const counts = {};
  ALERT_SOURCES.forEach(src => {
    const threads = GmailApp.search(src.query + ' newer_than:3d -label:' + SEEN.replace('/', '-'), 0, 30);
    threads.forEach(th => {
      th.getMessages().forEach(msg => {
        const jobs = parseAlert_(msg.getPlainBody(), msg.getBody(), src.link, src.tab);
        // "Sejal, your application was sent to X": her own LinkedIn application, logged as Applied.
        const sent = src.tab === 'LinkedIn' && msg.getSubject().match(/application was sent to (.+)$/i);
        if (sent && jobs[0] && !hasJob_('LinkedIn', jobs[0].jobLink)) {
          addJob('LinkedIn', Object.assign(jobs.shift(), {
            company: sent[1].trim(), postedAt: '', action: 'Applied', status: 'Applied',
            appliedAt: Utilities.formatDate(msg.getDate(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'),
            resume: 'Your LinkedIn application', note: 'None', notes: 'You applied on LinkedIn (from the confirmation email)',
          }));
        } else if (sent) jobs.shift();
        jobs.forEach(job => {
          const fit = fits_(job);
          if (!fit.ok) return;
          if (!job.jobLink || hasJob_(src.tab, job.jobLink)) return;
          const known = lookup_(job.company, job.role);
          const elsewhere = known.filter(r => /Applied|Replied|Interview|Offer/.test(r.status));
          if (known.length && !elsewhere.length) return; // already listed (same company and role), no need twice
          const note = elsewhere.length ? 'Already applied via ' + elsewhere[0].tab + '. ' : '';
          addJob(src.tab, Object.assign(job, {
            postedAt: Utilities.formatDate(msg.getDate(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'),
            action: 'Needs you', status: elsewhere.length ? 'Skipped' : 'Needs you',
            resume: 'None', note: 'None',
            notes: note + 'From a ' + src.tab + ' alert email (' + fit.track + '). Open the link and apply yourself.',
          }));
          counts[src.tab] = (counts[src.tab] || 0) + 1;
        });
      });
      th.addLabel(seen);
    });
  });
  logRun_({ runAt: istNow_(), site: 'Email alerts', mode: 'live', seen: 0, matched: 0, applied: 0, needsYou: Object.keys(counts).reduce((a, k) => a + counts[k], 0),
    skipped: {}, nearMisses: [], errors: [], health: 'OK', appliedToday: 0, cap: 0, nextRun: '' });
  return counts;
}

/* ---------- 2. replies from companies ---------- */

function checkReplies() {
  const done = label_(REPLY_SEEN);
  const applied = appliedRows_();
  if (!applied.length) return 0;
  const alertFrom = /(glassdoor|linkedin|naukri|indeed|instahyre|wellfound|cutshort|noreply@rippling)/i;
  const threads = GmailApp.search('in:inbox newer_than:3d -label:' + REPLY_SEEN.replace('/', '-'), 0, 50);
  let n = 0;
  threads.forEach(th => {
    const msg = th.getMessages().slice(-1)[0];
    const from = msg.getFrom();
    const subject = msg.getSubject();
    const body = msg.getPlainBody().slice(0, 4000);
    if (/application was sent to/i.test(subject)) { th.addLabel(done); return; } // her own confirmation
    if (alertFrom.test(from) && !/application was viewed|interview|status/i.test(subject)) { th.addLabel(done); return; }
    const hay = (from + ' ' + subject + ' ' + body).toLowerCase();
    const row = applied.find(r => r.companyKey.length > 2 && (hay.indexOf(r.companyKey) >= 0));
    if (!row) return;
    let status = /application was viewed/i.test(subject) ? 'Viewed' : 'Replied';
    if (/unfortunately|not (be )?moving forward|other candidates|decided to (pursue|move)|not a fit|regret to inform|position has been filled/i.test(hay)) status = 'Rejected';
    else if (/interview|schedule a (call|chat)|your availability|next round|assignment|take-?home/i.test(hay)) status = 'Interview';
    const sh = sheet_().getSheetByName(row.tab);
    sh.getRange(row.r, col(COLUMNS, 'Status')).setValue(status);
    sh.getRange(row.r, col(COLUMNS, 'Response at')).setValue(msg.getDate()).setNumberFormat('dd mmm yyyy, hh:mm');
    const notes = sh.getRange(row.r, col(COLUMNS, 'Notes'));
    notes.setValue([notes.getValue(), status + ' (email: "' + subject.slice(0, 80) + '")'].filter(String).join(' · '));
    th.addLabel(done);
    n++;
  });
  return n;
}

function appliedRows_() {
  const out = [];
  TABS.forEach(tab => {
    const sh = sheet_().getSheetByName(tab);
    const last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, COLUMNS.length).getValues().forEach((v, i) => {
      const status = v[col(COLUMNS, 'Status') - 1];
      if (['Applied', 'Viewed', 'No reply'].indexOf(status) < 0) return;
      const key = normCompany_(v[col(COLUMNS, 'Company') - 1]);
      if (key) out.push({ tab: tab, r: i + 2, companyKey: key, role: v[col(COLUMNS, 'Role') - 1] });
    });
  });
  return out;
}

/* ---------- 3. follow-ups ---------- */

const FOLLOW_COLUMNS = ['Due', 'Site', 'Company', 'Role', 'Job link', 'Recruiter / poster', 'Draft message', 'Done'];

function followUps() {
  const ss = sheet_();
  const fu = ss.getSheetByName('Follow-ups') || ss.insertSheet('Follow-ups');
  if (fu.getLastRow() < 1) { header_(fu, FOLLOW_COLUMNS, { 'Draft message': 360, 'Job link': 220 }); fu.getRange(2, col(FOLLOW_COLUMNS, 'Done'), fu.getMaxRows() - 1).insertCheckboxes(); }
  const already = fu.getLastRow() > 1 ? fu.getRange(2, col(FOLLOW_COLUMNS, 'Job link'), fu.getLastRow() - 1).getValues().flat() : [];
  const weekAgo = Date.now() - 7 * 864e5;
  let n = 0;
  TABS.forEach(tab => {
    const sh = ss.getSheetByName(tab);
    const last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, COLUMNS.length).getValues().forEach((v, i) => {
      const status = v[col(COLUMNS, 'Status') - 1];
      const applied = v[col(COLUMNS, 'Applied at') - 1];
      const link = v[col(COLUMNS, 'Job link') - 1];
      if (status !== 'Applied' || !(applied instanceof Date) || applied.getTime() > weekAgo || already.indexOf(link) >= 0) return;
      const company = v[col(COLUMNS, 'Company') - 1], role = v[col(COLUMNS, 'Role') - 1];
      const poster = String(v[col(COLUMNS, 'Recruiter / poster') - 1] || '');
      const hi = poster ? 'Hi ' + poster.split(',')[0].split(' ')[0] + ',' : 'Hi,';
      const draft = hi + ' I applied for the ' + role + ' role at ' + company + ' last week and wanted to check in. I\'d love to talk about it, and my work is at sejalborkar.vercel.app. Thanks, Sejal';
      fu.appendRow([new Date(), tab, company, role, link, poster, draft, false]);
      fu.getRange(fu.getLastRow(), 1).setNumberFormat('dd mmm yyyy');
      sh.getRange(i + 2, col(COLUMNS, 'Follow-up on')).setValue(new Date()).setNumberFormat('dd mmm yyyy');
      n++;
    });
  });
  return n;
}

/* ---------- 4. emails to you ---------- */

function healthAlert() {
  const hour = Number(Utilities.formatDate(new Date(), 'Asia/Kolkata', 'H'));
  if (hour < 9 || hour >= 23) return false;
  const sh = sheet_().getSheetByName('Health');
  if (sh.getLastRow() < 2) return false;
  const red = sh.getRange(2, 1, sh.getLastRow() - 1, HEALTH_COLUMNS.length).getDisplayValues()
    .filter(r => r[0] && r[0] !== 'Email alerts' && r[1] && r[1] !== 'OK');
  if (!red.length) { props().deleteProperty('LAST_HEALTH_ALERT'); return false; }
  const last = Number(props().getProperty('LAST_HEALTH_ALERT') || 0);
  if (Date.now() - last < 6 * 3600 * 1000) return false;
  const lines = red.map(r => r[0] + ': ' + r[1] + (r[7] && r[7] !== 'None' ? ' (' + r[7] + ')' : ''));
  MailApp.sendEmail(me_(), 'Job bot needs you: ' + red.map(r => r[0]).join(', '),
    'Your job bot has a problem:\n\n' + lines.join('\n') + '\n\nOpen the Health tab: ' + sheet_().getUrl() + '\n\nOr ask the automation chat to fix it.');
  props().setProperty('LAST_HEALTH_ALERT', String(Date.now()));
  return true;
}

function weeklySummary() {
  const ss = sheet_();
  const weekAgo = Date.now() - 7 * 864e5;
  const per = {}, needs = [];
  let replies = 0, interviews = 0;
  TABS.forEach(tab => {
    const sh = ss.getSheetByName(tab);
    const last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, COLUMNS.length).getValues().forEach(v => {
      const applied = v[col(COLUMNS, 'Applied at') - 1], status = v[col(COLUMNS, 'Status') - 1];
      if (applied instanceof Date && applied.getTime() > weekAgo) per[tab] = (per[tab] || 0) + 1;
      const resp = v[col(COLUMNS, 'Response at') - 1];
      if (resp instanceof Date && resp.getTime() > weekAgo) { replies++; if (status === 'Interview') interviews++; }
      if (status === 'Needs you') needs.push('- ' + tab + ': ' + v[col(COLUMNS, 'Company') - 1] + ', ' + v[col(COLUMNS, 'Role') - 1]);
    });
  });
  const total = Object.keys(per).reduce((a, k) => a + per[k], 0);
  const body = 'This week\n\n' +
    'Applied: ' + total + (total ? ' (' + Object.keys(per).map(k => k + ' ' + per[k]).join(', ') + ')' : '') + '\n' +
    'Replies: ' + replies + ', interviews: ' + interviews + '\n\n' +
    'Waiting on you (' + needs.length + '):\n' + (needs.slice(0, 30).join('\n') || 'None') + '\n\n' + ss.getUrl();
  MailApp.sendEmail(me_(), 'Job hunt this week: ' + total + ' applied, ' + replies + ' replies', body);
  return true;
}

/* ---------- setup ---------- */

/** Creates the timers (safe to run again: it replaces them). */
function installTriggers() {
  const keep = ['checkAlerts', 'checkReplies', 'followUps', 'healthAlert', 'weeklySummary', 'checkPages'];
  ScriptApp.getProjectTriggers().filter(t => keep.indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkAlerts').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('checkPages').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('checkReplies').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('healthAlert').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('followUps').timeBased().everyDays(1).atHour(9).inTimezone('Asia/Kolkata').create();
  ScriptApp.newTrigger('weeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(19).inTimezone('Asia/Kolkata').create();
  return ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
}

/** Run once from the editor: Google asks for Gmail and email permission, then the timers start. */
function authorize() {
  GmailApp.getInboxUnreadCount();
  UrlFetchApp.fetch('https://api.lever.co/v0/postings/cred?mode=json&limit=1');
  MailApp.getRemainingDailyQuota();
  Logger.log('Permissions granted. Timers: ' + installTriggers().join(', '));
}

/** For the Mac: what the alert emails look like (sender, subject, first lines), to tune the reader. */
function peekMail_() {
  return ALERT_SOURCES.map(src => {
    const th = GmailApp.search(src.query + ' newer_than:30d', 0, 2);
    return { tab: src.tab, emails: th.map(t => { const m = t.getMessages()[0]; return { from: m.getFrom(), subject: m.getSubject(), date: String(m.getDate()), parsed: parseAlert_(m.getPlainBody(), m.getBody(), src.link, src.tab).slice(0, 8) }; }) };
  });
}

/** For the Mac: the raw text of the latest alert email per source, to tune the reader. */
function mailRaw_() {
  return ALERT_SOURCES.map(src => {
    const th = GmailApp.search(src.query + ' newer_than:30d', 0, 1);
    if (!th.length) return { tab: src.tab, text: '' };
    const m = th[0].getMessages()[0];
    return { tab: src.tab, text: m.getPlainBody().slice(0, 2500) };
  });
}

/** Clears the rows made from alert emails in the last few days and lets them be read again. */
function resetAlertRows_() {
  const removed = {};
  ['Glassdoor', 'LinkedIn', 'Indeed', 'Naukri'].forEach(tab => {
    const sh = sheet_().getSheetByName(tab);
    for (let r = sh.getLastRow(); r >= 2; r--) {
      const notes = String(sh.getRange(r, col(COLUMNS, 'Notes')).getValue());
      if (/alert email|You applied on LinkedIn/.test(notes)) { sh.deleteRow(r); removed[tab] = (removed[tab] || 0) + 1; }
    }
  });
  [SEEN, REPLY_SEEN].forEach(name => {
    const l = GmailApp.getUserLabelByName(name);
    if (l) GmailApp.search('label:' + name.replace('/', '-') + ' newer_than:4d', 0, 100).forEach(t => t.removeLabel(l));
  });
  return removed;
}
