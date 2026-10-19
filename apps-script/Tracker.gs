/**
 * Job hunt tracker: shared setup.
 * Runs inside Google Apps Script on Sejal's personal Google account,
 * so it keeps working when her laptop is off.
 *
 * Secrets (Telegram token, chat id, sheet id) live in Script Properties,
 * never in this file.
 */

const TABS = ['LinkedIn', 'Instahyre', 'Wellfound', 'Cutshort', 'Career pages'];

const COLUMNS = [
  'Found at', 'Posted at', 'Applied at', 'Minutes to apply',
  'Company', 'Role', 'Location / mode', 'Applicants',
  'Job link', 'Post link', 'Recruiter / poster',
  'Resume version', 'Note used', 'Action', 'Status',
  'Response at', 'Follow-up on', 'Notes',
];

const STATUSES = ['Applied', 'Needs you', 'Viewed', 'Replied', 'Interview', 'Offer', 'Rejected', 'No reply', 'Skipped'];
const ACTIONS = ['Applied', 'Needs you', 'Skipped'];

// Pings are muted between these hours (IST). Rows are still logged.
const QUIET_FROM = 23;
const QUIET_TO = 8;

const props = () => PropertiesService.getScriptProperties();

/** Step 1. Run once. Creates the sheet with one tab per source. */
function setupTracker() {
  let id = props().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('Job hunt tracker');
  if (!id) props().setProperty('SHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone('Asia/Kolkata');

  TABS.forEach(name => setupTab_(ss, name));

  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  Logger.log('Tracker ready: ' + ss.getUrl());
}

/** Adds a new source tab later, for example addTab('Naukri'). */
function addTab(name) {
  setupTab_(sheet_(), name);
}

function setupTab_(ss, name) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold');
  sh.setFrozenRows(1);

  const col = n => COLUMNS.indexOf(n) + 1;
  const rows = sh.getMaxRows() - 1;
  const list = values => SpreadsheetApp.newDataValidation().requireValueInList(values, true).build();
  sh.getRange(2, col('Status'), rows).setDataValidation(list(STATUSES));
  sh.getRange(2, col('Action'), rows).setDataValidation(list(ACTIONS));
  ['Found at', 'Posted at', 'Applied at', 'Response at'].forEach(n =>
    sh.getRange(2, col(n), rows).setNumberFormat('dd mmm yyyy, hh:mm'));
  sh.getRange(2, col('Follow-up on'), rows).setNumberFormat('dd mmm yyyy');
}

function sheet_() {
  const id = props().getProperty('SHEET_ID');
  if (!id) throw new Error('Run setupTracker first.');
  return SpreadsheetApp.openById(id);
}

/**
 * Logs one job to a source tab. Skips it if the job link is already there.
 * job: { company, role, location, applicants, jobLink, postLink, poster, postedAt, appliedAt,
 *        resume, note, action, status, notes }
 * Returns true when a new row was added.
 */
function addJob(tab, job) {
  const sh = sheet_().getSheetByName(tab);
  const linkCol = COLUMNS.indexOf('Job link') + 1;
  const last = sh.getLastRow();
  if (last > 1 && job.jobLink) {
    const links = sh.getRange(2, linkCol, last - 1).getValues().flat();
    if (links.includes(job.jobLink)) return false;
  }

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
  sh.getRange(r, COLUMNS.indexOf('Minutes to apply') + 1)
    .setFormulaR1C1('=IF(OR(R[0]C3="",R[0]C2=""),"",ROUND((R[0]C3-R[0]C2)*1440))');
  return true;
}

/* ---------- Telegram ---------- */

/**
 * Step 2. After setting TELEGRAM_TOKEN in Script Properties and sending
 * any message to your bot, run this once to save your chat id.
 */
function linkTelegram() {
  const token = props().getProperty('TELEGRAM_TOKEN');
  if (!token) throw new Error('Add TELEGRAM_TOKEN in Project Settings > Script Properties.');
  const res = JSON.parse(UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/getUpdates`).getContentText());
  const msg = (res.result || []).map(u => u.message).filter(Boolean).pop();
  if (!msg) throw new Error('Send any message to your bot in Telegram, then run this again.');
  props().setProperty('TELEGRAM_CHAT_ID', String(msg.chat.id));
  ping('Job hunt bot is linked. Alerts will arrive here.', { force: true });
}

/** Step 3. Sends a test alert. */
function testPing() {
  ping('Test alert: Product Designer at Example Co\nhttps://sejalborkar.vercel.app', { force: true });
}

/** Sends a phone alert. Muted in quiet hours unless force is set. */
function ping(text, opts) {
  opts = opts || {};
  const hour = Number(Utilities.formatDate(new Date(), 'Asia/Kolkata', 'H'));
  const quiet = hour >= QUIET_FROM || hour < QUIET_TO;
  if (quiet && !opts.force) return;

  const token = props().getProperty('TELEGRAM_TOKEN');
  const chat = props().getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chat) return;
  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'post',
    payload: { chat_id: chat, text: text, disable_web_page_preview: 'true' },
    muteHttpExceptions: true,
  });
}

/* ---------- Endpoint for the site scripts on the Mac ---------- */

/**
 * The Mac scripts post here to log rows. Deploy once as a web app
 * (Deploy > New deployment > Web app, execute as Me, access Anyone).
 * Requests must carry SHEET_SECRET from Script Properties, so nobody
 * else can write to the Sheet.
 *
 * Body: { secret, action: 'has' | 'add', tab, job }
 */
function doPost(e) {
  const out = obj => ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body.secret || body.secret !== props().getProperty('SHEET_SECRET')) return out({ ok: false, error: 'bad secret' });
    if (!TABS.includes(body.tab) && !sheet_().getSheetByName(body.tab)) return out({ ok: false, error: 'unknown tab' });

    if (body.action === 'has') return out({ ok: true, has: hasJob_(body.tab, body.job.jobLink) });
    if (body.action === 'add') return out({ ok: true, added: addJob(body.tab, body.job) });
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function hasJob_(tab, link) {
  const sh = sheet_().getSheetByName(tab);
  const last = sh.getLastRow();
  if (last < 2 || !link) return false;
  return sh.getRange(2, COLUMNS.indexOf('Job link') + 1, last - 1).getValues().flat().includes(link);
}

/** Run once to create the secret the Mac scripts use. Copy it from the log into the local .env file. */
function makeSecret() {
  const s = Utilities.getUuid().replace(/-/g, '');
  props().setProperty('SHEET_SECRET', s);
  Logger.log('SHEET_SECRET=' + s);
}
