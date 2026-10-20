// Wellfound, built to the shared five parts. Stage 3 (recon) in progress:
// only login works so far; the other parts are filled in from what the recon shows.
const notYet = () => { throw new Error('Wellfound jobs and apply are not built yet (recon first)'); };

export default {
  name: 'wellfound',
  label: 'Wellfound',
  loginUrl: 'https://wellfound.com/login',
  plainLogin: true, // she signs in with Google, which refuses script-driven browsers
  // Public pages look similar when logged out, so check for the Log in link instead of the URL.
  isLoggedIn: async page => {
    const text = await page.locator('body').innerText().catch(() => '');
    if (text.length < 200) return false; // still loading
    return !(await page.getByRole('link', { name: /^(log in|create profile)$/i }).count());
  },
  loggedIn: url => /wellfound\.com\/(jobs|role|candidates|profile|onboarding|discover|dashboard)/.test(url),
  loggedOut: url => /\/login/.test(url),
  listUrl: 'https://wellfound.com/jobs',
  watch() {},
  jobs: notYet,
  check: async () => null,
  details: notYet,
  apply: notYet,
  isApplied: notYet,
  sent: () => ({ resume: 'Wellfound profile resume', note: 'None' }),
};
