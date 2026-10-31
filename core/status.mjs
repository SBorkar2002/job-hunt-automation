// npm run status: the same health picture as the Sheet's Health tab, on the Mac.
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../shared/config.mjs';
import { readRuns } from './state.mjs';
import { istHour, nextRunIst } from './util.mjs';

const runs = readRuns();
const sites = readdirSync(join(import.meta.dirname, '..', 'sites')).map(f => f.replace('.mjs', ''));
const ageH = t => (Date.now() - new Date(t.replace(' ', 'T') + '+05:30')) / 36e5;

for (const name of sites) {
  const label = name[0].toUpperCase() + name.slice(1);
  const mine = runs.filter(r => r.site.toLowerCase() === name && r.mode === 'live');
  const last = mine.at(-1);
  const good = [...mine].reverse().find(r => r.health === 'OK');
  let timer = 'off';
  try { timer = /state = /.test(execSync(`launchctl print gui/$(id -u)/com.sejal.jobbot.${name} 2>/dev/null`, { shell: '/bin/bash' }).toString()) ? 'on' : 'off'; } catch {}
  let health = last ? last.health : 'No live run yet';
  const active = istHour() >= 9 && istHour() < 23;
  if (health === 'OK' && good && active && ageH(good.runAt) > config.schedule.staleHours) health = `No good run in ${config.schedule.staleHours} hours`;
  console.log(`${health === 'OK' ? 'OK ' : '!! '} ${label}: ${health}`);
  console.log(`    timer ${timer} · last run ${last?.runAt || '-'} · last good ${good?.runAt || '-'} · next ${nextRunIst(config.sites[name]?.runMinute || 0, config.schedule.runHours)}`);
  console.log(`    today ${last?.appliedToday ?? 0} of ${config.sites[name]?.dailyCap ?? '?'} · last run: seen ${last?.seen ?? 0}, applied ${last?.applied ?? 0}, needs you ${last?.needsYou ?? 0}`);
  if (last?.errors?.length) console.log(`    problem: ${last.errors.join('; ')}`);
}
