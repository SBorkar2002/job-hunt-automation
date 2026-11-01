/**
 * Job hunt tracker: the Sheet side.
 * Runs inside Google Apps Script on Sejal's personal Google account,
 * so the Sheet side works even when her laptop is off.
 *
 * Tabs: Health (one line per site), one tab per site, Runs (one row per run).
 * The format of every tab is defined here; setupTracker applies it and fixes old rows.
 *
 * Secrets (sheet id, SHEET_SECRET) live in Script Properties, never in this file.
 */

const TABS = ['LinkedIn', 'Instahyre', 'Wellfound', 'Cutshort', 'Career pages', 'Glassdoor', 'Naukri', 'Indeed'];

const COLUMNS = [
  'Found at', 'Posted at', 'Applied at', 'Minutes to apply',
  'Company', 'Role', 'Location / mode', 'Applicants',
  'Job link', 'Post link', 'Recruiter / poster',
  'Resume version', 'Note used', 'Action', 'Status',
  'Response at', 'Follow-up on', 'Notes', 'Source',
];
const WIDTHS = { 'Company': 140, 'Role': 180, 'Location / mode': 130, 'Job link': 220, 'Recruiter / poster': 180, 'Note used': 260, 'Notes': 260, 'Source': 200 };
// Never filled in practice (checked 1 Nov 2026 over 125 rows): hidden, still written.
// Action repeats Status (and contradicted it on 4 Indeed rows), so it is hidden too.
const HIDDEN = ['Minutes to apply', 'Applicants', 'Post link', 'Recruiter / poster', 'Action'];

const STATUSES = ['Applied', 'Needs you', 'Viewed', 'Replied', 'Interview', 'Offer', 'Rejected', 'No reply', 'Skipped', 'Expired'];
const ACTIONS = ['Applied', 'Needs you', 'Skipped'];

const RUN_COLUMNS = ['Run at', 'Site', 'Seen', 'Matched', 'Applied', 'Needs you', 'Skipped', 'Near misses', 'Errors', 'Next run'];
const HEALTH_COLUMNS = ['Site', 'Status', 'Last good run', 'Last run', 'Next run', 'Today', 'Login', 'Problem', 'Bot status'];

const props = () => PropertiesService.getScriptProperties();
const col = (cols, name) => cols.indexOf(name) + 1;

// Sheet v2 (To do, Pipeline, colours, expiry, No reply, evening email, Gmail outcome labels) runs on the
// live Sheet only after she approves a preview: SHEET_V2 = on. A preview runs it on a copy (SS_OVERRIDE).
let SS_OVERRIDE = null;
const v2_ = () => Boolean(SS_OVERRIDE) || props().getProperty('SHEET_V2') === 'on';

/** Run once, and again after any format change. Creates or reformats every tab and fixes old rows. */
function setupTracker() {
  let id = props().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('Job hunt tracker');
  if (!id) props().setProperty('SHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone('Asia/Kolkata');
  ss.setRecalculationInterval(SpreadsheetApp.RecalculationInterval.HOUR);

  formatAll_(ss);

  Logger.log('Tracker ready: ' + ss.getUrl());
}

/** Every tab's format, old rows fixed; with v2 also To do and Pipeline in front. Used for the live Sheet and previews. */
function formatAll_(ss) {
  ensureSourceColumn_(ss);
  setupHealth_(ss);
  TABS.forEach(name => setupTab_(ss, name));
  setupRuns_(ss);
  migrateRows_(ss);
  backfillSource_(ss);

  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
  ss.setActiveSheet(ss.getSheetByName('Health'));
  ss.moveActiveSheet(1);
  if (v2_()) refreshViews_(ss);
}

/** Adds a new site tab later, for example addTab('Naukri'). */
function addTab(name) {
  setupTab_(sheet_(), name);
}

function header_(sh, cols, widths) {
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(1, 1, sh.getMaxRows(), cols.length).setWrap(true).setVerticalAlignment('middle');
  cols.forEach((c, i) => sh.setColumnWidth(i + 1, (widths && widths[c]) || 120));
}

function setupTab_(ss, name) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  header_(sh, COLUMNS, WIDTHS);
  const rows = sh.getMaxRows() - 1;
  const list = values => SpreadsheetApp.newDataValidation().requireValueInList(values, true).build();
  safe_(() => sh.getRange(2, col(COLUMNS, 'Status'), rows).setDataValidation(list(STATUSES)));
  safe_(() => sh.getRange(2, col(COLUMNS, 'Action'), rows).setDataValidation(list(ACTIONS)));
  ['Found at', 'Posted at', 'Applied at', 'Response at'].forEach(n =>
    fmt_(sh.getRange(2, col(COLUMNS, n), rows), 'dd mmm yyyy, hh:mm'));
  fmt_(sh.getRange(2, col(COLUMNS, 'Follow-up on'), rows), 'dd mmm yyyy');
  if (v2_()) {
    HIDDEN.forEach(n => safe_(() => sh.hideColumns(col(COLUMNS, n))));
    statusColours_(sh, sh.getRange(2, col(COLUMNS, 'Status'), rows));
  }
}

function setupRuns_(ss) {
  const sh = ss.getSheetByName('Runs') || ss.insertSheet('Runs');
  header_(sh, RUN_COLUMNS, { 'Skipped': 200, 'Near misses': 200, 'Errors': 240 });
  fmt_(sh.getRange(2, 1, sh.getMaxRows() - 1), 'dd mmm yyyy, hh:mm');
  fmt_(sh.getRange(2, col(RUN_COLUMNS, 'Next run'), sh.getMaxRows() - 1), 'dd mmm, hh:mm');
}

function setupHealth_(ss) {
  const sh = ss.getSheetByName('Health') || ss.insertSheet('Health');
  header_(sh, HEALTH_COLUMNS, { 'Status': 200, 'Login': 220, 'Problem': 280 });
  safe_(() => sh.hideColumns(col(HEALTH_COLUMNS, 'Bot status')));
  ['Last good run', 'Last run', 'Next run'].forEach(n =>
    fmt_(sh.getRange(2, col(HEALTH_COLUMNS, n), sh.getMaxRows() - 1), 'dd mmm, hh:mm'));
  const status = sh.getRange(2, col(HEALTH_COLUMNS, 'Status'), sh.getMaxRows() - 1);
  const green = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OK').setBackground('#d9f4e4').setRanges([status]).build();
  const red = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($B2<>"",$B2<>"OK")').setBackground('#fde3e1').setFontColor('#b3261e').setRanges([status]).build();
  safe_(() => sh.setConditionalFormatRules([green, red]));
}

/** Old rows: replace retired codes with plain words and turn text times into real dates. */
function migrateRows_(ss) {
  TABS.forEach(name => {
    const sh = ss.getSheetByName(name);
    const last = sh.getLastRow();
    if (last < 2) return;
    const range = sh.getRange(2, 1, last - 1, COLUMNS.length);
    const values = range.getValues();
    const iResume = col(COLUMNS, 'Resume version') - 1;
    const iNote = col(COLUMNS, 'Note used') - 1;
    const iApplied = col(COLUMNS, 'Applied at') - 1;
    let changed = false;
    values.forEach(r => {
      if (r[iResume] === 'site-v1') { r[iResume] = name === 'Instahyre' ? 'Instahyre profile resume' : 'Resume PDF'; changed = true; }
      const note = String(r[iNote]);
      const withText = /^note-[\w-]+: ([\s\S]*)$/.exec(note);
      if (withText) { r[iNote] = withText[1]; changed = true; }
      else if (/^note-[\w-]+$/.test(note)) { r[iNote] = 'None (one-click apply, no note asked)'; changed = true; }
      if (typeof r[iApplied] === 'string' && /^\d{4}-\d\d-\d\dT/.test(r[iApplied])) { r[iApplied] = new Date(r[iApplied]); changed = true; }
    });
    // Only write back the plain columns, so the Minutes to apply formulas stay.
    if (changed) {
      [iResume, iNote, iApplied].forEach(i => sh.getRange(2, i + 1, values.length).setValues(values.map(r => [r[i]])));
    }
  });
}

function sheet_() {
  if (SS_OVERRIDE) return SS_OVERRIDE;
  const id = props().getProperty('SHEET_ID');
  if (!id) throw new Error('Run setupTracker first.');
  return SpreadsheetApp.openById(id);
}

/**
 * Logs one job to a site tab. Skips it if the job link is already there.
 * job: { company, role, location, applicants, jobLink, postLink, poster, postedAt, appliedAt,
 *        resume, note, action, status, notes }
 * Returns true when a new row was added.
 */
function addJob(tab, job) {
  const sh = sheet_().getSheetByName(tab);
  if (hasJob_(tab, job.jobLink)) return false;
  const row = {
    'Found at': new Date(),
    'Posted at': job.postedAt || '',
    'Company': job.company || '',
    'Role': job.role || '',
    'Location / mode': job.location || '',
    'Applicants': job.applicants || '',
    'Job link': job.jobLink || '',
    'Post link': job.postLink || '',
    'Recruiter / poster': job.poster || '',
    'Applied at': job.appliedAt || '',
    'Resume version': job.resume || '',
    'Note used': job.note || '',
    'Action': job.action || 'Applied',
    'Status': job.status || job.action || 'Applied',
    'Notes': job.notes || '',
    'Source': job.source || '',
  };
  sh.appendRow(COLUMNS.map(c => (c in row ? row[c] : '')));

  // Minutes to apply fills itself once Applied at is set.
  const r = sh.getLastRow();
  // Adding a row resets date formats, so set them again on this row.
  ['Found at', 'Posted at', 'Applied at', 'Response at'].forEach(n => fmt_(sh.getRange(r, col(COLUMNS, n)), 'dd mmm yyyy, hh:mm'));
  sh.getRange(r, col(COLUMNS, 'Minutes to apply'))
    .setFormulaR1C1('=IF(OR(R[0]C3="",R[0]C2=""),"",ROUND((R[0]C3-R[0]C2)*1440))');
  return true;
}

/* ---------- Endpoint for the site scripts on the Mac ---------- */

/**
 * The Mac scripts post here. Deployed as a web app (execute as Me, access Anyone).
 * Requests must carry SHEET_SECRET from Script Properties, so nobody else can write.
 *
 * Body: { secret, action, tab, job, run }
 *   has | add | update   job rows on a site tab
 *   run                  one Runs row and the site's Health line
 *   lookup               rows for the same company and role on any site tab
 *   setup                reapplies the format (setupTracker)
 *   peek                 reads back the Health tab and the last Runs rows, as shown
 */
function doPost(e) {
  const out = obj => ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body.secret || body.secret !== props().getProperty('SHEET_SECRET')) return out({ ok: false, error: 'bad secret' });
    const a = body.action;
    if (['has', 'add', 'update'].indexOf(a) >= 0 && !sheet_().getSheetByName(body.tab)) return out({ ok: false, error: 'unknown tab' });

    if (a === 'has') return out({ ok: true, has: hasJob_(body.tab, body.job.jobLink) });
    if (a === 'add') return out({ ok: true, added: addJob(body.tab, body.job) });
    if (a === 'update') return out({ ok: true, updated: updateJob_(body.tab, body.job) });
    if (a === 'run') { logRun_(body.run); return out({ ok: true }); }
    if (a === 'lookup') return out({ ok: true, rows: lookup_(body.job.company, body.job.role) });
    if (a === 'setup') { setupTracker(); return out({ ok: true }); }
    if (a === 'peek') return out({ ok: true, health: shown_('Health', 20), runs: shown_('Runs', 3) });
    if (a === 'mail') return out({ ok: true, result: { alerts: checkAlerts(), replies: checkReplies(), followUps: followUps() } });
    if (a === 'owner') { props().setProperty('OWNER_EMAIL', body.job.email); return out({ ok: true }); }
    if (a === 'tidy') return out({ ok: true, result: tidy_(Boolean(body.job && body.job.dryRun)) });
    if (a === 'colors') return out({ ok: true, result: rowColors_() });
    if (a === 'dedupeRuns') return out({ ok: true, result: dedupeRuns_() });
    if (a === 'message') { messageIn_(body.message); return out({ ok: true }); }
    if (a === 'pages') return out({ ok: true, result: checkPages() });
    if (a === 'resetalerts') return out({ ok: true, result: resetAlertRows_() });
    if (a === 'tail') return out({ ok: true, result: shown_(body.tab, body.job && body.job.n || 15) });
    if (a === 'mailraw') return out({ ok: true, result: mailRaw_() });
    if (a === 'mailpeek') return out({ ok: true, result: peekMail_() });
    if (a === 'triggers') return out({ ok: true, result: installTriggers() });
    if (a === 'preview') return out({ ok: true, result: previewV2_() });
    if (a === 'v2on') return out({ ok: true, result: enableV2_() });
    if (a === 'views') return out({ ok: true, result: refreshViews_(sheet_()) });
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) + ' @ ' + String(err.stack || '').split('\n').slice(0, 4).join(' < ') });
  }
}

// A job counts as known if its link is on its own tab or in Skipped (she never wants those back).
function hasJob_(tab, link) {
  if (!link) return false;
  return [tab, 'Skipped'].some(name => {
    const sh = sheet_().getSheetByName(name);
    if (!sh) return false;
    const last = sh.getLastRow();
    if (last < 2) return false;
    return sh.getRange(2, col(COLUMNS, 'Job link'), last - 1).getValues().flat().indexOf(link) >= 0;
  });
}

/**
 * Updates the row with this job link. job: { jobLink, action, status, appliedAt, resume, note, notes }.
 * Notes are added after what is already there. Returns true when a row was found.
 */
function updateJob_(tab, job) {
  const sh = sheet_().getSheetByName(tab);
  const last = sh.getLastRow();
  if (last < 2 || !job.jobLink) return false;
  const links = sh.getRange(2, col(COLUMNS, 'Job link'), last - 1).getValues().flat();
  const i = links.indexOf(job.jobLink);
  if (i < 0) return false;
  const r = i + 2;
  const set = (name, v) => { if (v) sh.getRange(r, col(COLUMNS, name)).setValue(v); };
  set('Action', job.action);
  set('Status', job.status);
  set('Applied at', job.appliedAt);
  if (job.appliedAt) fmt_(sh.getRange(r, col(COLUMNS, 'Applied at')), 'dd mmm yyyy, hh:mm');
  set('Resume version', job.resume);
  set('Note used', job.note);
  if (job.notes) {
    const cell = sh.getRange(r, col(COLUMNS, 'Notes'));
    cell.setValue([cell.getValue(), job.notes].filter(String).join(' · '));
  }
  return true;
}

// Same matching as core/util.mjs on the Mac.
function normCompany_(s) {
  return String(s || '').toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llp|technologies|technology|labs?|india)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function normRole_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(jr|junior|sr|senior)\b/g, '').replace(/\s+/g, ' ').trim();
}

// Stronger than normCompany_: "Red Baton Creative Marketing Solutions Private Limited" = "Red Baton",
// "Lyzr AI" = "Lyzr", "Weekday (YC W21)" = "Weekday", "NTT DATA North America" = "NTT DATA".
function companyKey_(s) {
  return normCompany_(String(s || '').replace(/\([^)]*\)/g, ' '))
    .replace(/\b(ai|solutions?|services|software|digital|global|group|co|company|creative|marketing|north america|studios?|inc|tech)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function lookup_(company, role) {
  const c = companyKey_(company), r = normRole_(role), found = [];
  TABS.concat(['Skipped']).forEach(name => {
    const sh = sheet_().getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, COLUMNS.length).getValues().forEach(v => {
      if (companyKey_(v[col(COLUMNS, 'Company') - 1]) === c && normRole_(v[col(COLUMNS, 'Role') - 1]) === r) {
        found.push({ tab: name, status: v[col(COLUMNS, 'Status') - 1], appliedAt: v[col(COLUMNS, 'Applied at') - 1] });
      }
    });
  });
  return found;
}

/** One Runs row, and the site's line in Health. run: the summary the Mac sends. */
function logRun_(run) {
  const ss = sheet_();
  const when = s => (s ? new Date(String(s).replace(' ', 'T') + '+05:30') : '');
  const skipped = Object.keys(run.skipped || {}).map(k => run.skipped[k] + ' ' + k).join(', ') || 'None';
  const near = (run.nearMisses || []).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'None';
  const needs = run.needsYou ? run.needsYou + (run.needsTop ? ' (' + run.needsTop + ')' : '') : 0;
  // Hourly email checks that found nothing only update Health (they were 220 of 462 Runs rows).
  if (!run.quiet) {
    const runs = ss.getSheetByName('Runs');
    runs.appendRow([when(run.runAt), run.site, run.seen, run.matched, run.applied, needs, skipped, near, (run.errors || []).join('; ') || 'None', when(run.nextRun)]);
    const rr = runs.getLastRow();
    fmt_(runs.getRange(rr, 1), 'dd mmm yyyy, hh:mm');
    fmt_(runs.getRange(rr, col(RUN_COLUMNS, 'Next run')), 'dd mmm, hh:mm');
  }

  const sh = ss.getSheetByName('Health');
  const last = sh.getLastRow();
  const sites = last > 1 ? sh.getRange(2, 1, last - 1).getValues().flat() : [];
  let r = sites.indexOf(run.site) + 2;
  if (r < 2) { r = last + 1; safe_(() => sh.getRange(r, 1).setValue(run.site)); }
  // Health is for reading only: times go in as text ("22 Oct, 15:00"), and no single cell can block the rest.
  const txt = v => (v instanceof Date ? Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') : v);
  const set = (name, v) => safe_(() => sh.getRange(r, col(HEALTH_COLUMNS, name)).setValue(txt(v)));
  set('Bot status', run.health);
  safe_(() => sh.getRange(r, col(HEALTH_COLUMNS, 'Status')).setFormula(
    '=IF(I' + r + '="","",IF(AND(I' + r + '="OK",HOUR(NOW())>=9,HOUR(NOW())<23,NOW()-IFERROR(DATEVALUE(C' + r + ')+TIMEVALUE(C' + r + '),C' + r + ')>' + CONFIG.schedule.staleHours + '/24),"No good run in ' + CONFIG.schedule.staleHours + ' hours",I' + r + '))'));
  if (run.health === 'OK') set('Last good run', when(run.runAt));
  set('Last run', when(run.runAt));
  set('Next run', run.nextRunText || when(run.nextRun));
  set('Today', run.todayText || run.appliedToday + ' of ' + run.cap + ' applied');
  set('Login', run.health === 'Login expired' ? 'Expired: run npm run ' + String(run.site).toLowerCase() + ':login' : 'OK');
  set('Problem', (run.errors || []).join('; ') || 'None');
}

/** The last n rows of a tab, as the Sheet displays them (header first). */
function shown_(name, n) {
  const sh = sheet_().getSheetByName(name);
  const last = sh.getLastRow();
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  if (last < 2) return [head];
  const from = Math.max(2, last - n + 1);
  return [head].concat(sh.getRange(from, 1, last - from + 1, sh.getLastColumn()).getDisplayValues());
}

const MSG_COLUMNS = ['Received', 'Site', 'Company', 'From', 'Message', 'Link', 'Replied'];

/** A company wrote to her: one row in Messages and an email to her own address. */
function messageIn_(m) {
  const ss = sheet_();
  let sh = ss.getSheetByName('Messages');
  if (!sh) { sh = ss.insertSheet('Messages', 1); header_(sh, MSG_COLUMNS, { 'Message': 420, 'Link': 200 }); sh.getRange(2, col(MSG_COLUMNS, 'Replied'), sh.getMaxRows() - 1).insertCheckboxes(); }
  const when = m.sentAt ? new Date(String(m.sentAt).replace(' ', 'T') + '+05:30') : new Date();
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, 6).setValues([[when, m.site, m.company, m.from, m.body, m.link]]);
  fmt_(sh.getRange(2, 1), 'dd mmm yyyy, hh:mm');
  safe_(() => sh.getRange(2, col(MSG_COLUMNS, 'Replied')).insertCheckboxes());
  MailApp.sendEmail(me_(), 'New ' + m.site + ' message from ' + m.company + ' (' + m.from + ')',
    m.from + ' at ' + m.company + ' wrote on ' + m.site + ':\n\n' + m.body + '\n\nReply here: ' + m.link + '\n\nCareful with requests to move to Telegram or WhatsApp, install anything, or share ID or bank details.');
}

/** Run once to create the secret the Mac scripts use. Copy it from the log into the local .env file. */
function makeSecret() {
  const s = Utilities.getUuid().replace(/-/g, '');
  props().setProperty('SHEET_SECRET', s);
  Logger.log('SHEET_SECRET=' + s);
}

/**
 * Sets a date or number format, unless the column is a typed Table column
 * (Google refuses those, and the column already has its own format).
 * A format must never stop a row from being written.
 */
function fmt_(range, format) {
  // Google applies changes in batches, so flush here: the typed-column error must surface inside this try.
  try { range.setNumberFormat(format); SpreadsheetApp.flush(); } catch (e) { /* typed column: keep its own format */ }
  return range;
}

/** Runs a formatting step that a typed Table column may refuse; never lets it stop a write. */
function safe_(fn) { try { fn(); SpreadsheetApp.flush(); } catch (e) { /* typed column or protected range */ } }

/** Removes repeated Runs rows (same time and site), left by retries that failed half-way. */
function dedupeRuns_() {
  const sh = sheet_().getSheetByName('Runs');
  const last = sh.getLastRow();
  if (last < 3) return 0;
  const vals = sh.getRange(2, 1, last - 1, 2).getDisplayValues();
  const seen = {}, drop = [];
  vals.forEach((v, i) => { const k = v[0] + '|' + v[1]; if (seen[k] || v[1] === 'Probe') drop.push(i + 2); else seen[k] = true; });
  drop.reverse().forEach(r => sh.deleteRow(r));
  return drop.length;
}

/** Each job row with its fill colour (her green = applied, red = skipped) and current Status. */
function rowColors_() {
  const out = [];
  sheet_().getSheets().forEach(sh => {
    const name = sh.getName();
    if (['Health', 'Runs', 'Messages', 'Follow-ups', 'To do', 'Pipeline'].indexOf(name) >= 0) return;
    const last = sh.getLastRow();
    if (last < 2) return;
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
    const ci = n => head.indexOf(n);
    const vals = sh.getRange(2, 1, last - 1, head.length).getDisplayValues();
    const bgs = sh.getRange(2, 1, last - 1, head.length).getBackgrounds();
    vals.forEach((v, i) => {
      const fills = bgs[i].filter(c => c && c !== '#ffffff');
      out.push({ tab: name, row: i + 2, company: v[ci('Company')], role: v[ci('Role')], status: v[ci('Status')], link: v[ci('Job link')], fill: fills[0] || '' });
    });
  });
  return out;
}

/* ---------- tidy: her colours -> Status, skipped rows -> Skipped tab, sort ---------- */

const GREEN = ['#d9ead3', '#b6d7a8', '#93c47d', '#d9f4e4', '#c8e6c9', '#a8e6a3'];
const RED = ['#f4cccc', '#ea9999', '#e06666', '#fde3e1', '#ffcdd2', '#f8b4b4'];
const LATER = ['Replied', 'Interview', 'Offer', 'Rejected', 'Viewed', 'No reply'];
const ORDER = { 'Needs you': 0, 'Applied': 1 };

function tidy_(dryRun) {
  const ss = sheet_();
  if (!dryRun) ensureSourceColumn_(ss);
  const before = statusCounts_(), plan = { coloured: [], moved: [], skippedTabRows: 0 };
  let skip = ss.getSheetByName('Skipped');
  if (!skip && !dryRun) { skip = ss.insertSheet('Skipped'); header_(skip, COLUMNS.concat(['From tab']), WIDTHS); }

  TABS.forEach(name => {
    const sh = ss.getSheetByName(name);
    const last = sh.getLastRow();
    if (last < 2) return;
    const range = sh.getRange(2, 1, last - 1, COLUMNS.length);
    const vals = range.getValues(), bgs = range.getBackgrounds();
    const iS = col(COLUMNS, 'Status') - 1, iA = col(COLUMNS, 'Action') - 1;
    // 1. Her colours set the Status, unless she already moved it further (Replied, Interview...).
    vals.forEach((v, i) => {
      const fill = (bgs[i].find(c => c && c !== '#ffffff') || '').toLowerCase();
      if (LATER.indexOf(v[iS]) >= 0) return;
      const to = GREEN.indexOf(fill) >= 0 ? 'Applied' : RED.indexOf(fill) >= 0 ? 'Skipped' : null;
      if (to && v[iS] !== to) {
        plan.coloured.push(name + ': ' + v[col(COLUMNS, 'Company') - 1] + ' -> ' + to);
        if (!dryRun) { sh.getRange(i + 2, iS + 1).setValue(to); if (to === 'Applied' && v[iA] !== 'Applied') sh.getRange(i + 2, iA + 1).setValue('Applied'); }
        v[iS] = to;
      }
    });
    // 2. Skipped rows move to the Skipped tab (kept for the duplicate check), bottom-up so rows don't shift.
    for (let i = vals.length - 1; i >= 0; i--) {
      if (vals[i][iS] !== 'Skipped') continue;
      plan.moved.push(name + ': ' + vals[i][col(COLUMNS, 'Company') - 1] + ', ' + vals[i][col(COLUMNS, 'Role') - 1]);
      if (!dryRun) {
        const row = vals[i].map(x => (x instanceof Date ? x : x)).concat([name]);
        skip.appendRow(row);
        safe_(() => skip.getRange(skip.getLastRow(), 1, 1, row.length).setBackgrounds([bgs[i].concat(['#ffffff'])]));
        sh.deleteRow(i + 2);
      }
    }
    // 3. Sort: Needs you, then Applied, then the rest; newest first inside each group.
    if (!dryRun) sortTab_(sh);
  });
  if (skip) plan.skippedTabRows = Math.max(0, skip.getLastRow() - 1);
  return { dryRun: dryRun, before: before, after: dryRun ? null : statusCounts_(), changes: { coloured: plan.coloured.length, moved: plan.moved.length }, coloured: plan.coloured, moved: plan.moved, skippedTabRows: plan.skippedTabRows };
}

function sortTab_(sh) {
  const last = sh.getLastRow();
  if (last < 3) return;
  const range = sh.getRange(2, 1, last - 1, COLUMNS.length);
  const vals = range.getValues(), bgs = range.getBackgrounds(), fml = range.getFormulasR1C1();
  const iS = col(COLUMNS, 'Status') - 1, iF = col(COLUMNS, 'Found at') - 1;
  const idx = vals.map((v, i) => i).sort((a, b) => {
    const ga = ORDER[vals[a][iS]] !== undefined ? ORDER[vals[a][iS]] : 2;
    const gb = ORDER[vals[b][iS]] !== undefined ? ORDER[vals[b][iS]] : 2;
    if (ga !== gb) return ga - gb;
    return new Date(vals[b][iF] || 0) - new Date(vals[a][iF] || 0);
  });
  range.setValues(idx.map(i => vals[i]));
  safe_(() => range.setBackgrounds(idx.map(i => bgs[i])));
  const iM = col(COLUMNS, 'Minutes to apply');
  idx.forEach((i, k) => { if (fml[i][iM - 1]) sh.getRange(k + 2, iM).setFormulaR1C1(fml[i][iM - 1]); });
}

function statusCounts_() {
  const c = {};
  TABS.concat(['Skipped']).forEach(name => {
    const sh = sheet_().getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, col(COLUMNS, 'Status'), sh.getLastRow() - 1).getValues().flat().forEach(s => {
      const k = (name === 'Skipped' ? 'Skipped tab' : 'Site tabs') + ': ' + (s || '(blank)');
      c[k] = (c[k] || 0) + 1;
    });
  });
  return c;
}
