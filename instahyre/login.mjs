// Opens Instahyre in the bot's own Chrome profile so you can log in yourself, once.
// The login stays in ~/.jobbot/profiles/instahyre on this Mac. Close the window when done.
import { chromium } from 'playwright';
import { profileDir } from '../shared/config.mjs';

const ctx = await chromium.launchPersistentContext(profileDir('instahyre'), {
  channel: 'chrome', headless: false, viewport: null,
});
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://www.instahyre.com/login/');
console.log('Log in to Instahyre in the window that opened. It closes by itself once you are in.');
// Done when the page leaves the login screen for your candidate pages, or if you close it.
const loggedIn = page.waitForURL(u => /\/candidate\//.test(u.pathname), { timeout: 15 * 60 * 1000 }).then(() => true).catch(() => false);
const closed = new Promise(resolve => page.on('close', () => resolve(false)));
const ok = await Promise.race([loggedIn, closed]);
if (ok) await page.waitForTimeout(4000);
await ctx.close().catch(() => {});
console.log(ok ? 'Logged in and saved. You stay logged in for the scripts.' : 'Window closed before login finished. Run npm run instahyre:login again.');
