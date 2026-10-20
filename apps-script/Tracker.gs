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

const TABS = ['LinkedIn', 'Instahyre', 'Wellfound', 'Cutshort', 'Career pages'];

const COLUMNS = [
  'Found at', 'Posted at', 'Applied at', 'Minutes to apply',
  'Company', 'Role', 'Location / mode', 'Applicants',
  'Job link', 'Post link', 'Recruiter / poster',
  'Resume version', 'Note used', 'Action', 'Status',
  'Response at', 'Follow-up on', 'Notes',
];
const WIDTHS = { 'Company': 140, 'Role': 180, 'Location / mode': 130, 'Job link': 220, 'Recruiter / poster': 180, 'Note used': 260, 'Notes': 260 };

const STATUSES = ['Applied', 'Needs you', 'Viewed', 'Replied', 'Interview', 'Offer', 'Rejected', 'No reply', 'Skipped'];
const ACTIONS = ['Applied', 'Needs you', 'Skipped'];

const RUN_COLUMNS = ['Run at', 'Site', 'Seen', 'Matched', 'Applied', 'Needs you', 'Skipped', 'Near misses', 'Errors', 'Next run'];
const HEALTH_COLUMNS = ['Site', 'Status', 'Last good run', 'Last run', 'Next run', 'Today', 'Login', 'Problem', 'Bot status'];

const props = () => PropertiesService.getScriptProperties();
const col = (cols, name) => cols.indexOf(name) + 1;

/** Run once, and again after any format change. Creates or reformats every tab and fixes old rows. */
function setupTracker() {
  let id = props().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('Job hunt tracker');
  if (!id) props().setProperty('SHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone('Asia/Kolkata');
  ss.setRecalculationInterval(SpreadsheetApp.RecalculationInterval.HOUR);

  setupHealth_(ss);
  TABS.forEach(name => setupTab_(ss, name));
  setupRuns_(ss);
  migrateRows_(ss);

  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
  ss.setActiveSheet(ss.getSheetByName('Health'));
  ss.moveActiveSheet(1);

  Logger.log('Tracker ready: ' + ss.getUrl());
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
  sh.getRange(2, col(COLUMNS, 'Status'), rows).setDataValidation(list(STATUSES));
  sh.getRange(2, col(COLUMNS, 'Action'), rows).setDataValidation(list(ACTIONS));
  ['Found at', 'Posted at', 'Applied at', 'Response at'].forEach(n =>
    sh.getRange(2, col(COLUMNS, n), rows).setNumberFormat('dd mmm yyyy, hh:mm'));
  sh.getRange(2, col(COLUMNS, 'Follow-up on'), rows).setNumberFormat('dd mmm yyyy');
}

function setupRuns_(ss) {
  const sh = ss.getSheetByName('Runs') || ss.insertSheet('Runs');
  header_(sh, RUN_COLUMNS, { 'Skipped': 200, 'Near misses': 200, 'Errors': 240 });
  sh.getRange(2, 1, sh.getMaxRows() - 1).setNumberFormat('dd mmm yyyy, hh:mm');
  sh.getRange(2, col(RUN_COLUMNS, 'Next run'), sh.getMaxRows() - 1).setNumberFormat('dd mmm, hh:mm');
}

function setupHealth_(ss) {
  const sh = ss.getSheetByName('Health') || ss.insertSheet('Health');
  header_(sh, HEALTH_COLUMNS, { 'Status': 200, 'Login': 220, 'Problem': 280 });
  sh.hideColumns(col(HEALTH_COLUMNS, 'Bot status'));
  ['Last good run', 'Last run', 'Next run'].forEach(n =>
    sh.getRange(2, col(HEALTH_COLUMNS, n), sh.getMaxRows() - 1).setNumberFormat('dd mmm, hh:mm'));
  const status = sh.getRange(2, col(HEALTH_COLUMNS, 'Status'), sh.getMaxRows() - 1);
  const green = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OK').setBackground('#d9f4e4').setRanges([status]).build();
  const red = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($B2<>"",$B2<>"OK")').setBackground('#fde3e1').setFontColor('#b3261e').setRanges([status]).build();
  sh.setConditionalFormatRules([green, red]);
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
  };
  sh.appendRow(COLUMNS.map(c => (c in row ? row[c] : '')));

  // Minutes to apply fills itself once Applied at is set.
  const r = sh.getLastRow();
  // Adding a row resets date formats, so set them again on this row.
  ['Found at', 'Posted at', 'Applied at', 'Response at'].forEach(n => sh.getRange(r, col(COLUMNS, n)).setNumberFormat('dd mmm yyyy, hh:mm'));
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
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function hasJob_(tab, link) {
  const sh = sheet_().getSheetByName(tab);
  const last = sh.getLastRow();
  if (last < 2 || !link) return false;
  return sh.getRange(2, col(COLUMNS, 'Job link'), last - 1).getValues().flat().indexOf(link) >= 0;
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
  if (job.appliedAt) sh.getRange(r, col(COLUMNS, 'Applied at')).setNumberFormat('dd mmm yyyy, hh:mm');
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

function lookup_(company, role) {
  const c = normCompany_(company), r = normRole_(role), found = [];
  TABS.forEach(name => {
    const sh = sheet_().getSheetByName(name);
    const last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, COLUMNS.length).getValues().forEach(v => {
      if (normCompany_(v[col(COLUMNS, 'Company') - 1]) === c && normRole_(v[col(COLUMNS, 'Role') - 1]) === r) {
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
  const runs = ss.getSheetByName('Runs');
  runs.appendRow([when(run.runAt), run.site, run.seen, run.matched, run.applied, needs, skipped, near, (run.errors || []).join('; ') || 'None', when(run.nextRun)]);
  const rr = runs.getLastRow();
  runs.getRange(rr, 1).setNumberFormat('dd mmm yyyy, hh:mm');
  runs.getRange(rr, col(RUN_COLUMNS, 'Next run')).setNumberFormat('dd mmm, hh:mm');

  const sh = ss.getSheetByName('Health');
  const last = sh.getLastRow();
  const sites = last > 1 ? sh.getRange(2, 1, last - 1).getValues().flat() : [];
  let r = sites.indexOf(run.site) + 2;
  if (r < 2) { r = last + 1; sh.getRange(r, 1).setValue(run.site); }
  const set = (name, v) => sh.getRange(r, col(HEALTH_COLUMNS, name)).setValue(v);
  set('Bot status', run.health);
  sh.getRange(r, col(HEALTH_COLUMNS, 'Status')).setFormula(
    '=IF(I' + r + '="","",IF(AND(I' + r + '="OK",HOUR(NOW())>=9,HOUR(NOW())<23,NOW()-C' + r + '>3/24),"No good run in 3 hours",I' + r + '))');
  if (run.health === 'OK') set('Last good run', when(run.runAt));
  set('Last run', when(run.runAt));
  set('Next run', when(run.nextRun));
  set('Today', run.appliedToday + ' of ' + run.cap + ' applied');
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

/** Run once to create the secret the Mac scripts use. Copy it from the log into the local .env file. */
function makeSecret() {
  const s = Utilities.getUuid().replace(/-/g, '');
  props().setProperty('SHEET_SECRET', s);
  Logger.log('SHEET_SECRET=' + s);
}
