// npm run doctor: checks every moving part and prints the one command that fixes each problem.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';
import { config, ROOT } from '../shared/config.mjs';
import { call } from '../shared/sheet.mjs';
import { readRuns } from './state.mjs';
import { istHour } from './util.mjs';
import { createHash } from 'node:crypto';

const ok = [], bad = [];
const good = msg => ok.push(msg);
const fix = (msg, cmd) => bad.push({ msg, cmd });
const sh = c => { try { return execSync(c, { shell: '/bin/bash', stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return ''; } };
const ageH = t => (Date.now() - new Date(String(t).replace(' ', 'T') + '+05:30')) / 36e5;

// Files the bot needs.
existsSync(join(ROOT, 'node_modules/playwright')) ? good('Playwright installed') : fix('Playwright is missing', 'npm install');
existsSync(join(ROOT, '.env')) ? good('.env present') : fix('.env is missing (Sheet link and secret)', 'cp .env.example .env, then paste SHEET_URL and SHEET_SECRET (README setup steps 3 to 5)');
existsSync(join(ROOT, 'private/answers.local.json')) ? good('Private answers present') : fix('Private answers are missing', 'fill private/answers.local.json (README setup step 6)');
existsSync('/Applications/Google Chrome.app') ? good('Chrome installed') : fix('Google Chrome is missing', 'install Chrome from google.com/chrome');

// Sheet reachable.
try { await call('has', 'Instahyre', { jobLink: 'doctor-check' }); good('Sheet reachable'); }
catch (e) { fix(`Sheet not reachable (${e.message})`, 'check Wi-Fi; if it says "bad secret", run makeSecret in Apps Script and update .env'); }

// Apps Script deploys.
existsSync(join(os.homedir(), '.clasprc.json')) ? good('clasp logged in (Apps Script deploys)') : fix('clasp is logged out', 'npm run clasp:login');

// Per site: timer, last run, login.
const runs = readRuns();
for (const site of Object.keys(config.sites)) {
  const label = site[0].toUpperCase() + site.slice(1);
  const loaded = /state = /.test(sh(`launchctl print gui/$(id -u)/com.sejal.jobbot.${site}`));
  loaded ? good(`${label}: timer on`) : fix(`${label}: timer is off`, 'npm run timer:install');
  const mine = runs.filter(r => r.site === label && r.mode === 'live');
  const last = mine.at(-1);
  if (!last) { fix(`${label}: no live run yet`, `npm run timer:run-now${site === 'instahyre' ? '' : ':' + site}`); continue; }
  if (last.health === 'Login expired') fix(`${label}: logged out`, `npm run ${site}:login`);
  else if (last.health === 'Bot check') fix(`${label}: a CAPTCHA appeared`, `open ${label} in the bot's Chrome yourself (npm run ${site}:login) and finish it`);
  else if (last.health === 'Site error') good(`${label}: last run hit an error on the site's side (${last.errors.join('; ')}); it retries every hour`);
  else if (/^Needs fix/.test(last.health)) fix(`${label}: ${last.health}`, `ask the automation chat: "${label} needs fix: ${last.errors.join('; ')}"`);
  else if (/^Error/.test(last.health)) fix(`${label}: ${last.health}`, `npm run timer:run-now${site === 'instahyre' ? '' : ':' + site}, and if it repeats, ask the automation chat`);
  else if (istHour() >= 9 && istHour() < 23 && ageH(last.runAt) > 3) fix(`${label}: last run ${Math.round(ageH(last.runAt))} hours ago`, 'keep the Mac awake and plugged in during the day, or run: npm run timer:install');
  else good(`${label}: OK, last run ${last.runAt}, today ${last.appliedToday} of ${last.cap}`);
}

// Offline queue and capture folder.
const q = join(os.homedir(), '.jobbot/state/pending-rows.json');
const queued = existsSync(q) ? JSON.parse(readFileSync(q, 'utf8')).length : 0;
queued ? fix(`${queued} Sheet row(s) waiting to be sent`, 'nothing to do if Wi-Fi is fine: the next run sends them') : good('No Sheet rows waiting');
const timerCopy = join(os.homedir(), '.jobbot/app/core/run.mjs');
const hash = f => createHash('md5').update(readFileSync(f)).digest('hex');
const changed = ['core/run.mjs', 'shared/config.json', 'shared/filters.mjs', ...readdirSync(join(ROOT, 'sites')).map(f => 'sites/' + f)]
  .some(f => !existsSync(join(os.homedir(), '.jobbot/app', f)) || hash(join(ROOT, f)) !== hash(join(os.homedir(), '.jobbot/app', f)));
if (existsSync(timerCopy) && changed) fix('The timer runs an older copy of the scripts', 'npm run timer:install');

console.log('\nJob bot doctor\n');
ok.forEach(m => console.log('  OK   ' + m));
if (bad.length) {
  console.log('\nNeeds fixing:');
  bad.forEach(b => console.log(`  !!   ${b.msg}\n       fix: ${b.cmd}`));
} else console.log('\nAll good.');
console.log('');
