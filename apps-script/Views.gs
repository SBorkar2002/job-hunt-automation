/**
 * Sheet v2 (built 1 Nov 2026, her ask): views and housekeeping on top of the site tabs.
 *
 *   To do      every Needs you job from every site in one list, newest first. Pick Applied or Skip
 *              in "Done?" and the site tab is updated (right away, and again every hour).
 *   Pipeline   first tab: counts, live conversations (Interview, Offer, Replied), two charts.
 *   Expired    Needs you older than NEEDS_YOU_DAYS leaves To do (alert jobs go stale fast).
 *   No reply   Applied or Viewed with no response after NO_REPLY_DAYS.
 *   Evening    one email to her at 9pm when the day had anything new; nothing on quiet days.
 *   Labels     company replies get a Gmail label by outcome: Job hunt/Interview, /Replied, /Rejected, /Viewed,
 *              and automatic confirmations Job hunt/Confirmation.
 *   Cleanup    (once, at switch-on) false replies corrected, notes shortened, Skipped dates, test row, Cutshort hidden.
 *   Duplicates the same company and role from two sources shows once in To do; already applied ones are skipped.
 *
 * Runs on the live Sheet only when SHEET_V2 = on (enableV2_), or on a copy (previewV2_).
 */

const NEEDS_YOU_DAYS = 10;
const NO_REPLY_DAYS = 14;
const TODO_COLUMNS = ['Done?', 'Found', 'Days old', 'Site', 'Company', 'Role', 'Location', 'What to do', 'Job link', 'Source'];
const TODO_DONE = ['Applied', 'Skip'];
const LIVE_STATUSES = ['Interview', 'Offer', 'Replied'];
const OUTCOME_LABEL = 'Job hunt';

// Status colours: green = moving, amber = waiting on her, blue = sent, grey = closed.
const STATUS_COLOURS = {
  'Offer': ['#b7e1cd', '#0d5c2e'], 'Interview': ['#ceead6', '#137333'], 'Replied': ['#e6f4ea', '#137333'],
  'Needs you': ['#fef7e0', '#8a5a00'], 'Applied': ['#e8f0fe', '#1a56c4'], 'Viewed': ['#e8f0fe', '#1a56c4'],
  'Rejected': ['#f1f3f4', '#5f6368'], 'No reply': ['#f1f3f4', '#5f6368'], 'Expired': ['#f1f3f4', '#9aa0a6'],
  'Skipped': ['#fce8e6', '#a50e0e'],
};

function statusColours_(sh, range) {
  const rules = Object.keys(STATUS_COLOURS).map(s => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(s).setBackground(STATUS_COLOURS[s][0]).setFontColor(STATUS_COLOURS[s][1]).setRanges([range]).build());
  safe_(() => sh.setConditionalFormatRules(rules));
}

/* ---------- Source column ---------- */

/** Source is column 19 everywhere. Skipped had From tab there: move it one right. Safe to run again. */
function ensureSourceColumn_(ss) {
  const i = col(COLUMNS, 'Source');
  const skip = ss.getSheetByName('Skipped');
  if (skip && skip.getLastColumn() >= i && skip.getRange(1, i).getValue() === 'From tab') {
    skip.insertColumnBefore(i);
    skip.getRange(1, i).setValue('Source').setFontWeight('bold');
  }
  TABS.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh && sh.getRange(1, i).getValue() !== 'Source') sh.getRange(1, i).setValue('Source').setFontWeight('bold');
  });
}

/** Old rows: where each job came from, worked out from its tab and notes. Only fills blanks. */
function backfillSource_(ss) {
  const iSrc = col(COLUMNS, 'Source') - 1, iNotes = col(COLUMNS, 'Notes') - 1, iLink = col(COLUMNS, 'Job link') - 1;
  const guess = (tab, notes, link) => {
    if (/You applied on LinkedIn/.test(notes)) return 'Your LinkedIn application';
    if (/alert email/.test(notes)) return tab + ' alert email';
    if (tab === 'Career pages') return 'Careers page';
    if (tab === 'Wellfound') return 'Saved search';
    if (tab === 'Instahyre') return /job-438957-/.test(link) ? 'Search: UI/UX Designer, Bangalore' : 'Recommended feed';
    return '';
  };
  TABS.concat(['Skipped']).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const width = name === 'Skipped' ? COLUMNS.length + 1 : COLUMNS.length;
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
    let changed = false;
    const out = vals.map(v => {
      if (v[iSrc]) return [v[iSrc]];
      const g = guess(name === 'Skipped' ? v[COLUMNS.length] : name, String(v[iNotes]), String(v[iLink]));
      if (g) changed = true;
      return [g];
    });
    if (changed) sh.getRange(2, iSrc + 1, out.length).setValues(out);
  });
}

/* ---------- housekeeping ---------- */

const daysSince_ = d => (d instanceof Date ? (Date.now() - d.getTime()) / 864e5 : null);

/** Walks every site tab row; fn(values, rowNumber, sheet, tab) returns a change list or nothing. */
function eachJobRow_(ss, fn) {
  TABS.forEach(tab => {
    const sh = ss.getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, COLUMNS.length).getValues().forEach((v, i) => fn(v, i + 2, sh, tab));
  });
}
const at_ = name => col(COLUMNS, name) - 1;
function addNote_(sh, r, text) {
  const cell = sh.getRange(r, col(COLUMNS, 'Notes'));
  cell.setValue([cell.getValue(), text].filter(String).join(' · '));
}

function expireNeedsYou_(ss) {
  let n = 0;
  eachJobRow_(ss, (v, r, sh) => {
    if (v[at_('Status')] !== 'Needs you' || !(daysSince_(v[at_('Found at')]) > NEEDS_YOU_DAYS)) return;
    sh.getRange(r, col(COLUMNS, 'Status')).setValue('Expired');
    addNote_(sh, r, 'Expired: in To do for ' + NEEDS_YOU_DAYS + '+ days');
    n++;
  });
  return n;
}

function noReply_(ss) {
  let n = 0;
  eachJobRow_(ss, (v, r, sh) => {
    if (['Applied', 'Viewed'].indexOf(v[at_('Status')]) < 0 || v[at_('Response at')]) return;
    // Jobs she marked applied herself have no Applied at: count from when the job was found.
    if (!(daysSince_(v[at_('Applied at')] || v[at_('Found at')]) > NO_REPLY_DAYS)) return;
    sh.getRange(r, col(COLUMNS, 'Status')).setValue('No reply');
    addNote_(sh, r, 'No reply after ' + NO_REPLY_DAYS + ' days');
    n++;
  });
  return n;
}

/* ---------- To do ---------- */

/** Her picks in To do go back to the site tab: Applied (with the time) or Skipped. */
function todoWriteback_(ss) {
  const td = ss.getSheetByName('To do');
  if (!td || td.getLastRow() < 2) return 0;
  const rows = td.getRange(2, 1, td.getLastRow() - 1, TODO_COLUMNS.length).getValues();
  let n = 0;
  rows.forEach(t => {
    const done = t[col(TODO_COLUMNS, 'Done?') - 1];
    if (TODO_DONE.indexOf(done) < 0) return;
    const sh = ss.getSheetByName(t[col(TODO_COLUMNS, 'Site') - 1]);
    if (!sh || sh.getLastRow() < 2) return;
    const links = sh.getRange(2, col(COLUMNS, 'Job link'), sh.getLastRow() - 1).getValues().flat();
    const i = links.indexOf(t[col(TODO_COLUMNS, 'Job link') - 1]);
    if (i < 0) return;
    const r = i + 2;
    if (done === 'Applied') {
      sh.getRange(r, col(COLUMNS, 'Status')).setValue('Applied');
      sh.getRange(r, col(COLUMNS, 'Action')).setValue('Applied');
      fmt_(sh.getRange(r, col(COLUMNS, 'Applied at')).setValue(new Date()), 'dd mmm yyyy, hh:mm');
      addNote_(sh, r, 'You applied (marked in To do)');
    } else {
      sh.getRange(r, col(COLUMNS, 'Status')).setValue('Skipped');
      addNote_(sh, r, 'You skipped it (in To do)');
    }
    n++;
  });
  return n;
}

function buildTodo_(ss) {
  let td = ss.getSheetByName('To do');
  if (!td) td = ss.insertSheet('To do');
  const items = [];
  eachJobRow_(ss, (v, r, sh, tab) => {
    if (v[at_('Status')] !== 'Needs you') return;
    const found = v[at_('Found at')];
    items.push(['', found, found instanceof Date ? Math.floor(daysSince_(found)) : '', tab, v[at_('Company')], v[at_('Role')],
      v[at_('Location / mode')], whatToDo_(tab, String(v[at_('Notes')])), v[at_('Job link')], v[at_('Source')]]);
  });
  items.sort((a, b) => new Date(b[1] || 0) - new Date(a[1] || 0));
  td.clear();
  safe_(() => td.getRange(1, 1, td.getMaxRows(), td.getMaxColumns()).clearDataValidations());
  header_(td, TODO_COLUMNS, { 'Done?': 90, 'Found': 120, 'Days old': 70, 'Site': 100, 'Location': 130, 'What to do': 300, 'Job link': 220, 'Source': 180 });
  td.getRange(1, 1, 1, TODO_COLUMNS.length).setBackground('#fef7e0');
  if (items.length) {
    td.getRange(2, 1, items.length, TODO_COLUMNS.length).setValues(items);
    fmt_(td.getRange(2, col(TODO_COLUMNS, 'Found'), items.length), 'dd mmm, hh:mm');
    td.getRange(2, 1, items.length).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(TODO_DONE, true).build());
  }
  return items.length;
}

/** One plain instruction per To do row. */
function whatToDo_(tab, notes) {
  if (['LinkedIn', 'Glassdoor', 'Indeed', 'Naukri'].indexOf(tab) >= 0) return 'Open the link and apply on ' + tab;
  const fill = notes.match(/npm run fill -- \S+/);
  if (fill) return 'On the Mac: ' + fill[0];
  if (/Needs note/.test(notes)) return 'Say "draft notes" in the automation chat';
  const reason = notes.split(' · ').filter(x => !/^(Track|track):/.test(x) && !/^\d|years|pay/.test(x)).slice(-1)[0];
  return (reason || 'Open the link and apply').slice(0, 160);
}

/** Same company and role twice in To do: keep the newest. Already applied elsewhere: skip it. */
function dedupeNeedsYou_(ss) {
  const sent = ['Applied', 'Viewed', 'Replied', 'Interview', 'Offer', 'Rejected', 'No reply'];
  const byKey = {};
  eachJobRow_(ss, (v, r, sh, tab) => {
    const key = companyKey_(v[at_('Company')]) + '|' + normRole_(v[at_('Role')]);
    (byKey[key] = byKey[key] || []).push({ v: v, r: r, sh: sh, tab: tab });
  });
  let n = 0;
  Object.keys(byKey).forEach(key => {
    const rows = byKey[key];
    if (rows.length < 2 || key.charAt(0) === '|') return;
    const done = rows.find(x => sent.indexOf(x.v[at_('Status')]) >= 0);
    const open = rows.filter(x => x.v[at_('Status')] === 'Needs you')
      .sort((a, b) => new Date(b.v[at_('Found at')] || 0) - new Date(a.v[at_('Found at')] || 0));
    open.forEach((x, i) => {
      if (!done && i === 0) return;
      x.sh.getRange(x.r, col(COLUMNS, 'Status')).setValue('Skipped');
      addNote_(x.sh, x.r, done ? 'Already applied via ' + done.tab : 'Same job also in ' + open[0].tab);
      n++;
    });
  });
  return n;
}

/** Runs keeps 30 days; Health has the current picture. */
function pruneRuns_(ss) {
  const sh = ss.getSheetByName('Runs');
  if (!sh || sh.getLastRow() < 3) return 0;
  const cutoff = Date.now() - 30 * 864e5;
  const dates = sh.getRange(2, 1, sh.getLastRow() - 1).getValues().flat();
  let old = 0;
  while (old < dates.length && dates[old] instanceof Date && dates[old].getTime() < cutoff) old++;
  if (old) sh.deleteRows(2, old);
  return old;
}

/* ---------- one-time cleanup at switch-on (and in a preview) ---------- */

/** Rows the reply reader moved on a false email go back to Applied, with a note saying why. */
function correctReplies_(ss) {
  const fixed = [];
  eachJobRow_(ss, (v, r, sh, tab) => {
    if (['Replied', 'Interview', 'Viewed'].indexOf(v[at_('Status')]) < 0) return;
    const marks = [];
    String(v[at_('Notes')]).replace(/(Replied|Interview|Viewed|Rejected) \(email: "([^"]*)"\)/g, (m, s, subj) => { marks.push(subj); return m; });
    if (!marks.length) return; // set by her, not the reader
    if (marks.some(subj => ['Replied', 'Interview', 'Viewed', 'Rejected'].indexOf(replyKind_(subj, '')) >= 0 && !ACK.test(subj))) return;
    sh.getRange(r, col(COLUMNS, 'Status')).setValue('Applied');
    sh.getRange(r, col(COLUMNS, 'Response at')).setValue('');
    addNote_(sh, r, 'Corrected 1 Nov: no reply yet (those emails were confirmations or not from the company)');
    fixed.push(tab + ': ' + v[at_('Company')] + ' (' + v[at_('Status')] + ')');
  });
  return fixed;
}

/** The same sentence on 100+ rows becomes "Track: product"; the Source column says where it came from. */
function cleanNotes_(ss) {
  let n = 0;
  TABS.concat(['Skipped']).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const range = sh.getRange(2, col(COLUMNS, 'Notes'), sh.getLastRow() - 1);
    const vals = range.getValues().map(([x]) => {
      const y = String(x)
        .replace(/From an? [\w ]+? alert email \((\w+)\)\. Open the link and apply yourself\./g, 'Track: $1')
        .replace(/New on .+?'s careers page \((\w+)\)\. To apply with your answers filled in, run on the Mac: (npm run fill -- \S+)/g, 'Track: $1 · Apply: $2')
        .replace(/¬∑/g, '·');
      if (y !== String(x)) n++;
      return [y];
    });
    range.setValues(vals);
  });
  return n;
}

function oneTimeCleanup_(ss) {
  const out = { correctedReplies: correctReplies_(ss), notesShortened: cleanNotes_(ss) };
  const msg = ss.getSheetByName('Messages');
  if (msg && msg.getLastRow() >= 2) {
    const companies = msg.getRange(2, col(MSG_COLUMNS, 'Company'), msg.getLastRow() - 1).getValues().flat();
    for (let i = companies.length - 1; i >= 0; i--) if (/^TEST \(from your job bot\)/.test(companies[i])) { msg.deleteRow(i + 2); out.testRowRemoved = true; }
  }
  const cut = ss.getSheetByName('Cutshort');
  if (cut && cut.getLastRow() < 2) { safe_(() => cut.hideSheet()); out.cutshortHidden = true; }
  const skip = ss.getSheetByName('Skipped');
  if (skip && skip.getLastRow() >= 2) {
    const rows = skip.getLastRow() - 1;
    ['Found at', 'Posted at', 'Applied at', 'Response at'].forEach(n => fmt_(skip.getRange(2, col(COLUMNS, n), rows), 'dd mmm yyyy, hh:mm'));
    HIDDEN.forEach(n => safe_(() => skip.hideColumns(col(COLUMNS, n))));
  }
  const fu = ss.getSheetByName('Follow-ups');
  if (fu && fu.getLastRow() >= 1) {
    const i = col(FOLLOW_COLUMNS, 'How to send');
    fu.getRange(1, i).setValue('How to send').setFontWeight('bold');
    fu.setColumnWidth(i, 260);
    if (fu.getLastRow() >= 2) {
      const sites = fu.getRange(2, col(FOLLOW_COLUMNS, 'Site'), fu.getLastRow() - 1).getValues();
      fu.getRange(2, i, sites.length).setValues(sites.map(([s]) => [s ? howToSend_(s) : '']));
    }
  }
  return out;
}

/** Installable edit trigger: a pick in To do updates the site tab within seconds. */
function onTodoEdit(e) {
  const sh = e && e.range && e.range.getSheet();
  if (!sh || sh.getName() !== 'To do' || e.range.getColumn() !== col(TODO_COLUMNS, 'Done?')) return;
  const ss = sh.getParent();
  if (todoWriteback_(ss)) { tidy_(false); buildTodo_(ss); buildPipeline_(ss); }
}

/* ---------- Pipeline ---------- */

function buildPipeline_(ss) {
  let sh = ss.getSheetByName('Pipeline');
  if (!sh) sh = ss.insertSheet('Pipeline');
  const count = {}, live = [], perDay = {}, weekAgo = Date.now() - 7 * 864e5;
  let applied = 0, week = 0;
  const sent = ['Applied', 'Viewed', 'Replied', 'Interview', 'Offer', 'Rejected', 'No reply'];
  eachJobRow_(ss, (v, r, s, tab) => {
    const st = v[at_('Status')], a = v[at_('Applied at')];
    count[st] = (count[st] || 0) + 1;
    if (sent.indexOf(st) >= 0) applied++;
    if (a instanceof Date) {
      if (a.getTime() > weekAgo) week++;
      const d = Utilities.formatDate(a, 'Asia/Kolkata', 'yyyy-MM-dd');
      perDay[d] = (perDay[d] || 0) + 1;
    }
    if (LIVE_STATUSES.indexOf(st) >= 0) live.push([st, v[at_('Company')], v[at_('Role')], tab, v[at_('Response at')] || a || '', v[at_('Job link')]]);
  });
  live.sort((x, y) => LIVE_STATUSES.indexOf(x[0]) - LIVE_STATUSES.indexOf(y[0]) || new Date(y[4] || 0) - new Date(x[4] || 0));

  sh.getCharts().forEach(c => sh.removeChart(c));
  sh.clear();
  sh.setHiddenGridlines(true);
  sh.setColumnWidth(1, 24);
  [2, 3, 4, 5, 6, 7].forEach(c => sh.setColumnWidth(c, 130));
  sh.getRange('B1').setValue('Job hunt').setFontSize(20).setFontWeight('bold');
  sh.getRange('B2').setValue('Updated ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM, h:mm a') + '. Refreshes every hour.').setFontColor('#5f6368');

  const tiles = [['Applied', applied], ['This week', week], ['Replied', count['Replied'] || 0], ['Interview', count['Interview'] || 0], ['Offer', count['Offer'] || 0], ['To do', count['Needs you'] || 0]];
  sh.getRange(4, 2, 1, 6).setValues([tiles.map(t => t[0])]).setFontColor('#5f6368').setBackground('#f8f9fa');
  sh.getRange(5, 2, 1, 6).setValues([tiles.map(t => t[1])]).setFontSize(22).setFontWeight('bold').setBackground('#f8f9fa').setHorizontalAlignment('left');
  sh.getRange(5, 5).setFontColor('#137333');
  sh.getRange(5, 7).setFontColor('#8a5a00');
  sh.setRowHeight(5, 44);

  sh.getRange('B7').setValue('Live conversations').setFontSize(13).setFontWeight('bold');
  const head = ['Status', 'Company', 'Role', 'Site', 'Since', 'Job link'];
  sh.getRange(8, 2, 1, head.length).setValues([head]).setFontColor('#5f6368').setFontWeight('bold');
  if (live.length) {
    sh.getRange(9, 2, live.length, head.length).setValues(live);
    fmt_(sh.getRange(9, 6, live.length), 'dd mmm');
    statusColours_(sh, sh.getRange(9, 2, live.length));
  } else {
    sh.getRange(9, 2).setValue('None yet. Replies and interviews show up here.').setFontColor('#9aa0a6');
  }

  // Chart data, out of the way on the right.
  const days = [];
  for (let k = 13; k >= 0; k--) {
    const d = new Date(Date.now() - k * 864e5);
    days.push([Utilities.formatDate(d, 'Asia/Kolkata', 'd MMM'), perDay[Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd')] || 0]);
  }
  const reached = s => s.reduce((a, k) => a + (count[k] || 0), 0);
  const funnel = [['Applied', applied], ['Viewed or more', reached(['Viewed', 'Replied', 'Interview', 'Offer', 'Rejected'])], ['Replied or more', reached(['Replied', 'Interview', 'Offer', 'Rejected'])], ['Interview', reached(['Interview', 'Offer'])], ['Offer', count['Offer'] || 0]];
  sh.getRange(1, 20, 1, 2).setValues([['Day', 'Applied']]);
  sh.getRange(2, 20, days.length, 2).setValues(days);
  sh.getRange(1, 23, 1, 2).setValues([['Stage', 'Jobs']]);
  sh.getRange(2, 23, funnel.length, 2).setValues(funnel);
  sh.getRange(1, 20, 20, 5).setFontColor('#9aa0a6');

  const row = Math.max(12, 10 + live.length + 2);
  sh.insertChart(sh.newChart().asColumnChart().addRange(sh.getRange(1, 20, days.length + 1, 2))
    .setOption('title', 'Applied per day, last 14 days').setOption('legend', { position: 'none' }).setOption('colors', ['#1a73e8'])
    .setNumHeaders(1).setPosition(row, 2, 0, 0).setOption('width', 520).setOption('height', 260).build());
  sh.insertChart(sh.newChart().asBarChart().addRange(sh.getRange(1, 23, funnel.length + 1, 2))
    .setOption('title', 'How far applications got').setOption('legend', { position: 'none' }).setOption('colors', ['#137333'])
    .setNumHeaders(1).setPosition(row + 14, 2, 0, 0).setOption('width', 520).setOption('height', 240).build());
  return { applied: applied, week: week, live: live.length, toDo: count['Needs you'] || 0 };
}

/* ---------- order and refresh ---------- */

function refreshViews_(ss) {
  const result = {
    picked: todoWriteback_(ss),
    duplicates: dedupeNeedsYou_(ss),
    expired: expireNeedsYou_(ss),
    noReply: noReply_(ss),
    runsPruned: pruneRuns_(ss),
  };
  tidy_(false);
  result.toDo = buildTodo_(ss);
  result.pipeline = buildPipeline_(ss);
  // Tab order: Pipeline, To do, Health, then the rest as they were.
  ['Health', 'To do', 'Pipeline'].forEach(name => { const s = ss.getSheetByName(name); if (s) { ss.setActiveSheet(s); ss.moveActiveSheet(1); } });
  TABS.forEach(name => { const s = ss.getSheetByName(name); if (s) { HIDDEN.forEach(n => safe_(() => s.hideColumns(col(COLUMNS, n)))); statusColours_(s, s.getRange(2, col(COLUMNS, 'Status'), s.getMaxRows() - 1)); } });
  return result;
}

/* ---------- evening email ---------- */

function eveningDigest() {
  if (!v2_()) return false;
  const ss = sheet_();
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const isToday = d => d instanceof Date && Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd') === today;
  const applied = [], todo = [], heard = [];
  eachJobRow_(ss, (v, r, sh, tab) => {
    const st = v[at_('Status')], line = v[at_('Company')] + ', ' + v[at_('Role')] + ' (' + tab + ')';
    if (isToday(v[at_('Applied at')])) applied.push('- ' + line);
    if (st === 'Needs you' && isToday(v[at_('Found at')])) todo.push('- ' + line + '\n  ' + v[at_('Job link')]);
    if (isToday(v[at_('Response at')])) heard.push('- ' + st + ': ' + line);
  });
  if (!applied.length && !todo.length && !heard.length) return false;
  const body = [
    heard.length ? 'Companies wrote back (' + heard.length + '):\n' + heard.join('\n') : '',
    'Applied today (' + applied.length + '):\n' + (applied.join('\n') || 'None'),
    'New in To do (' + todo.length + '):\n' + (todo.slice(0, 15).join('\n') || 'None') + (todo.length > 15 ? '\n...and ' + (todo.length - 15) + ' more' : ''),
    ss.getUrl(),
  ].filter(String).join('\n\n');
  MailApp.sendEmail(me_(), 'Job hunt today: ' + applied.length + ' applied, ' + todo.length + ' new to do' + (heard.length ? ', ' + heard.length + ' replies' : ''), body);
  return true;
}

/* ---------- Gmail outcome labels ---------- */

function outcomeLabel_(status) {
  label_(OUTCOME_LABEL);
  return label_(OUTCOME_LABEL + '/' + status);
}

/* ---------- preview and switch-on ---------- */

/** Builds v2 on a copy of the Sheet (her live Sheet is not touched) and returns the copy's link. */
function previewV2_() {
  const live = sheet_();
  const copy = SpreadsheetApp.create('Job hunt tracker: preview ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM HH:mm'));
  live.getSheets().forEach(s => s.copyTo(copy).setName(s.getName()));
  const blank = copy.getSheetByName('Sheet1');
  if (blank) copy.deleteSheet(blank);
  copy.setSpreadsheetTimeZone('Asia/Kolkata');
  SS_OVERRIDE = copy;
  try {
    ensureSourceColumn_(copy);
    TABS.forEach(name => setupTab_(copy, name));
    backfillSource_(copy);
    const cleanup = oneTimeCleanup_(copy);
    const result = refreshViews_(copy);
    result.cleanup = cleanup;
    result.url = copy.getUrl();
    return result;
  } finally {
    SS_OVERRIDE = null;
  }
}

/** After she approves the preview: v2 on the live Sheet, one-time cleanup, timers updated. */
function enableV2_() {
  props().setProperty('SHEET_V2', 'on');
  const ss = sheet_();
  const cleanup = oneTimeCleanup_(ss);
  formatAll_(ss);
  return { cleanup: cleanup, triggers: installTriggers() };
}
