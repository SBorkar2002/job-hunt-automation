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
const me_ = () => Session.getEffectiveUser().getEmail();
const istNow_ = () => Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');

/* ---------- filters (same rules as shared/filters.mjs) ---------- */

function fits_(job) {
  const t = String(job.role || '').toLowerCase();
  const where = String(job.location || '').toLowerCase();
  const tracks = Object.keys(CONFIG.tracks).filter(k => k.charAt(0) !== '_');
  const track = tracks.find(k => CONFIG.tracks[k].titles.some(x => t.indexOf(x) >= 0));
  if (!track) return { ok: false, reason: 'title' };
  const bad = CONFIG.excludeWords.find(w => t.indexOf(w) >= 0);
  if (bad) return { ok: false, reason: 'title has "' + bad + '"' };
  if (where && LOCATION_HINT.test(where) && !CONFIG.locations.some(l => where.indexOf(l) >= 0)) return { ok: false, reason: 'location' };
  return { ok: true, track: track };
}

/* ---------- 1. job alert emails ---------- */

// Reads one alert email's text: every job link, with the few lines just above it as context.
function parseAlert_(plain, html, linkRe) {
  const jobs = [];
  const text = plain || '';
  const lines = text.split(/\r?\n/).map(s => s.trim());
  lines.forEach((line, i) => {
    const links = line.match(linkRe) || [];
    if (!links.length) return;
    const before = [];
    for (let k = i - 1; k >= 0 && before.length < 5; k--) {
      const l = lines[k];
      if (!l || /^https?:/.test(l) || linkRe.test(l)) { linkRe.lastIndex = 0; if (before.length) break; else continue; }
      linkRe.lastIndex = 0;
      before.unshift(l.replace(/[​-‍]/g, ''));
    }
    jobs.push({ link: links[0], context: before.concat([line.replace(linkRe, '').trim()]).filter(String) });
  });
  linkRe.lastIndex = 0;
  // HTML fallback: link text is usually the job title.
  if (!jobs.length && html) {
    const a = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = a.exec(html))) {
      linkRe.lastIndex = 0;
      if (!linkRe.test(m[1])) continue;
      const label = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      if (label) jobs.push({ link: m[1].replace(/&amp;/g, '&'), context: [label] });
    }
  }
  linkRe.lastIndex = 0;
  return jobs.map(j => toJob_(j));
}

// Picks role, company and location out of the context lines.
function toJob_(j) {
  const allTitles = Object.keys(CONFIG.tracks).filter(k => k.charAt(0) !== '_').reduce((a, k) => a.concat(CONFIG.tracks[k].titles), []);
  const ctx = j.context.filter(l => l.length < 140);
  const roleLine = ctx.find(l => allTitles.some(t => l.toLowerCase().indexOf(t) >= 0)) || ctx.find(l => /design|ux|ui\b|artist|illustrat/i.test(l)) || ctx[0] || '';
  const loc = ctx.find(l => l !== roleLine && LOCATION_HINT.test(l) && l.length < 80) || '';
  const company = ctx.find(l => l !== roleLine && l !== loc && !/view job|apply|easy apply|new|actively|promoted|\d+ (applicants|days?|hours?)/i.test(l)) || '';
  return { role: roleLine.replace(/\s+/g, ' ').trim(), company: company.replace(/\s+/g, ' ').trim(), location: loc.trim(), jobLink: cleanLink_(j.link) };
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
        const jobs = parseAlert_(msg.getPlainBody(), msg.getBody(), src.link);
        jobs.forEach(job => {
          const fit = fits_(job);
          if (!fit.ok) return;
          if (!job.jobLink || hasJob_(src.tab, job.jobLink)) return;
          const elsewhere = lookup_(job.company, job.role).filter(r => /Applied|Replied|Interview|Offer/.test(r.status));
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
    if (alertFrom.test(from) && !/application|interview|status/i.test(subject)) { th.addLabel(done); return; }
    const hay = (from + ' ' + subject + ' ' + body).toLowerCase();
    const row = applied.find(r => r.companyKey.length > 2 && (hay.indexOf(r.companyKey) >= 0));
    if (!row) return;
    let status = 'Replied';
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
  const keep = ['checkAlerts', 'checkReplies', 'followUps', 'healthAlert', 'weeklySummary'];
  ScriptApp.getProjectTriggers().filter(t => keep.indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkAlerts').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('checkReplies').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('healthAlert').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('followUps').timeBased().everyDays(1).atHour(9).inTimezone('Asia/Kolkata').create();
  ScriptApp.newTrigger('weeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(19).inTimezone('Asia/Kolkata').create();
  return ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
}

/** Run once from the editor: Google asks for Gmail and email permission, then the timers start. */
function authorize() {
  GmailApp.getInboxUnreadCount();
  MailApp.getRemainingDailyQuota();
  Logger.log('Permissions granted. Timers: ' + installTriggers().join(', '));
}

/** For the Mac: what the alert emails look like (sender, subject, first lines), to tune the reader. */
function peekMail_() {
  return ALERT_SOURCES.map(src => {
    const th = GmailApp.search(src.query + ' newer_than:30d', 0, 2);
    return { tab: src.tab, emails: th.map(t => { const m = t.getMessages()[0]; return { from: m.getFrom(), subject: m.getSubject(), date: String(m.getDate()), parsed: parseAlert_(m.getPlainBody(), m.getBody(), src.link).slice(0, 6) }; }) };
  });
}
