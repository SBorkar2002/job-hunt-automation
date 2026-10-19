// Opens Instahyre in the bot's own Chrome profile so you can log in yourself, once.
// The login stays in ~/.jobbot/profiles/instahyre on this Mac. Close the window when done.
import { chromium } from 'playwright';
import { profileDir } from '../shared/config.mjs';

const ctx = await chromium.launchPersistentContext(profileDir('instahyre'), {
  channel: 'chrome', headless: false, viewport: null,
});
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://www.instahyre.com/login/');
console.log('Log in to Instahyre in the window that opened, then close the window.');
await new Promise(resolve => ctx.on('close', resolve));
console.log('Saved. You stay logged in for the scripts.');
