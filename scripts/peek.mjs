// npm run sheet:peek: prints the Health tab and the last Runs rows, as the Sheet shows them.
import { call } from '../shared/sheet.mjs';
const { health, runs } = await call('peek');
const show = (title, rows) => { console.log(`\n${title}`); rows.forEach(r => console.log('  ' + r.join(' | '))); };
show('Health', health);
show('Runs (latest)', runs);
