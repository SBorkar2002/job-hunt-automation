# Job hunt automation

Scripts that find fresh design roles and apply (or alert) fast, so Sejal can work on other projects while the hunt runs.

This file is the single tracker: requirements, answers, what exists, how to run it, what is done and what is left.

## Goal

Be one of the first applicants on every good-fit role. Recruiters often start from the top of the list, so speed after posting is the main lever. Fit still matters, so filters stay strict.

## Links

- Sheet (Job hunt tracker): https://docs.google.com/spreadsheets/d/1tj34leK-HVtZBhOoofL1ZZaOrc-_eXlE5gfaafy1E68/edit
- Apps Script project (Job hunt bot): https://script.google.com/home/projects/1wpIEesipTmHfU6vfUP5B73G0GZpspTfby8f32XTX-2SvgsuhBGFTT9CQ/edit
- Code (private repo): https://github.com/SBorkar2002/job-hunt-automation
- Workflow page: https://claude.ai/artifact/9No5UMQKk65HViTicyM6SB

## Requirements (from Sejal, 19 Oct 2026)

1. **Log everything in one Google Sheet.**
2. **One tab per source.** LinkedIn, Instahyre, Wellfound, Cutshort, Career pages (direct web search for open roles). More tabs as sources are added (Naukri, Hirist, YC Work at a Startup).
3. **One row per job**, with every useful detail filled in (columns below).
4. **Sources, one at a time.** Now: Instahyre, LinkedIn, Wellfound, Cutshort. Later: Naukri, Hirist, YC Work at a Startup, others. Shared setup is done first.
5. **Runs even when the laptop is off.**
6. **Freshness first.** Target new jobs and hiring posts. Under 100 applicants is preferred, not required.
7. **Answers are stored here** so every script reuses them. More can be added later.

## Sheet columns (every tab)

| Column | Meaning |
|---|---|
| Found at | When the script first saw it |
| Posted at | When the job or post went live. Blank for Instahyre: it doesn't show this |
| Applied at | When the application went in |
| Minutes to apply | Applied at minus Posted at. Blank when Posted at is unknown |
| Company | |
| Role | Position applied for |
| Location / mode | City, remote, hybrid |
| Applicants | Count when applied, if shown. Instahyre doesn't show it |
| Job link | |
| Post link | Hiring post, if it came from one |
| Recruiter / poster | Name and profile link, if known |
| Resume version | Which resume went out. Instahyre one-click uses the resume on her Instahyre profile |
| Note used | The exact note sent, or "None" when the site didn't ask for one |
| Action | Applied, Needs you, Skipped |
| Status | Applied, Viewed, Replied, Interview, Offer, Rejected, No reply |
| Response at | When she heard back |
| Follow-up on | Date to nudge |
| Notes | Track (product, visual, art, brand, graphic), experience asked, pay if shown, or the reason for Needs you |

## Hard limits

- No getting past CAPTCHAs or bot checks.
- No passwords in code or files. Sejal logs in herself.
- Nothing is sent without the approval flow she picks.
- No paid tools or credits without asking.

## Answers (Sejal said "ok" to all defaults, 19 Oct 2026)

Private answers (pay, phone, notice) are in `private/answers.local.json`, which is never committed or uploaded.

**Roles**
- Titles (widened 20 Oct), grouped into tracks in `shared/config.json`:
  - Product: Product Designer, UX Designer, UI/UX Designer, Interaction Designer, AI / GenAI Product Designer.
  - Visual: UI Designer, Visual Designer, UI Visual Designer, Digital Designer.
  - Art: 2D Artist, Illustrator, Concept Artist, Comic Artist, Storyboard Artist, Motion (Graphics) Designer.
  - Brand: Brand Designer, Creative Designer, Communication Designer.
  - Graphic: Graphic Designer, only if the job shows pay of 8 LPA or more. No pay shown means "Needs you".
- Notes: product and visual roles use the product note. Art, brand and graphic roles use a second note (approved 20 Oct): "Hi {company} team, I'm Sejal, a designer who works across product design, illustration and visual design. I'd love to bring that to the {role} role. My work is here: {portfolio}".
- Level: entry and Associate (0 to 2 years). Skip Senior, Lead, Principal, Manager.
- Locations: Bengaluru or remote (India). No Mumbai (decided 20 Oct).
- Start date: in private answers. Flag "immediate joiner" roles, don't skip them.
- Prefer: AI products, fintech, consumer apps, design-led startups.
- Avoid: agencies, IT services, unpaid or contract-only roles, betting apps.
- Dream companies: list pending from Sejal. They go first and skip the level filter.

**Sites and actions**
- Sources: LinkedIn, Instahyre, Wellfound, Cutshort, career pages. Later: Naukri, Hirist, YC Work at a Startup.
- Allowed: one-click and short-form applies, done automatically. Recruiter messages and cold emails are drafted only; she sends them.

**Freshness**
- Posted within 24 hours, newest applied first.
- Under 100 applicants preferred.
- Post keywords: "hiring" plus "product designer", "UX designer", "design role".
- Exclude: senior, lead, principal, manager, 5+ years, intern.

**Resume, note, portfolio**
- Resume: the PDF on the site (sejalborkar.vercel.app/resume), one version for now.
- Cover note: one 3-line template filled with company, role and one line from the job post. No paid AI. She approves the template once; it is then used as is.
- Portfolio: sejalborkar.vercel.app with ?ref=<site> per source (needs Vercel Analytics on).
- Email for applications: personal Gmail, not Epifi.

**Control, alerts, running (changed 20 Oct 2026)**
- **Auto-apply, no approval step.** The script applies on its own using these answers and logs every application in the Sheet. Sejal reviews the Sheet and asks this chat for script changes. This is her approved flow.
- **No Telegram.** No pings. Anything that needs her shows up in the Sheet as Status "Needs you" with the reason.
- Safety caps: a daily limit per site, newest jobs first, filters stay strict. A form question it has no answer for gets skipped and marked "Needs you", never guessed.
- Applying needs her logins, so it runs on her Mac in its own Chrome profile she logs into once. When the Mac is off or asleep it can't apply; it catches up on the next run. No saved logins online.
- LinkedIn: skipped for now (decided 20 Oct). Hiring posts later: message drafted in the Sheet; she sends it.
- **Separate script per site**, one shared Sheet and one shared config. Order: Instahyre first, then Cutshort, Wellfound.
- **"Apply" means the whole thing** (20 Oct): click Apply or Interested, and if the job sends her to another website, fill that form and submit it too. Questions with no saved answer: skip and mark "Needs you".
- Budget: free only. Ask before anything paid.
- Log: Google Sheet on her personal account, one tab per source.
- Order: shared setup, then sources one at a time.

## What exists

- `core/run.mjs`: the shared runner. Every site plugs in five parts (login, jobs, details, apply, isApplied); the runner does filters, Sheet rows, caps and pacing, the Needs you recheck, the same-job-on-two-sites rule, the start-of-run check and the run summary.
- `sites/instahyre.mjs`: Instahyre's five parts and what we know about its pages.
- `core/status.mjs` (`npm run status`): health per site on the Mac.
- `core/state.mjs`, `core/util.mjs`, `core/forms.mjs`: memory in `~/.jobbot/state`, helpers, the shared form filler.
- `shared/config.json`: titles (tracks), excluded words, cities, caps, notes, `crossSite` rule. Edit this to change filters.
- `shared/filters.mjs`, `shared/sheet.mjs`: fit rules; Sheet calls with retries and an offline queue.
- `apps-script/Tracker.gs`: the Sheet side. Health tab (one line per site, red when something is wrong), a tab per site, Runs tab (one row per run). Format defined in code; `setupTracker` applies it and fixes old rows.
- `scripts/timer.sh`: hourly timer per site, 8am to 11pm, at each site's `runMinute` (Instahyre :00, Wellfound :30). `npm run timer:install` installs both. `scripts/sheet-deploy.sh` (`npm run sheet:deploy`): pushes the Apps Script with clasp and reapplies the format.
- `docs/workflow.html`: the flow page (one section per site, to be updated with Wellfound).
- `private/answers.local.json`: private answers (git ignored).

**Commands:** `npm run instahyre:dry` (reads and decides, applies to nothing), `npm run instahyre:inspect` (same, plus page captures in `~/.jobbot/debug/instahyre/`, newest kept), `npm run instahyre:live -- --limit 1`, `npm run instahyre:login`, `npm run status`.

## Setup steps for Sejal (about 10 minutes, once)

1. **Apps Script.** Signed in to your *personal* Google account, go to script.google.com and click New project. Name it "Job hunt bot". Delete the sample code and paste all of `apps-script/Tracker.gs`.
2. **Sheet.** Pick `setupTracker` in the function menu and click Run. Allow the permissions Google asks for (it's your own script). The log shows your new Sheet's link.
3. **Secret.** Run `makeSecret`. Copy the `SHEET_SECRET=...` line from the log.
4. **Web app.** Deploy > New deployment > type Web app. Execute as: Me. Who has access: Anyone. Copy the web app URL.
5. **.env.** In this folder, copy `.env.example` to `.env` and paste the URL and secret. (The secret only lets scripts write to your Sheet. It is not your Google password.)
6. **Private answers.** Fill `private/answers.local.json` (phone, pay, notice, start date, email).
7. **Instahyre login.** Run `npm run instahyre:login`, log in in the window that opens, then close it.

## Status

- Done: requirements and answers recorded; git set up; Sheet setup script written (syntax checked, not yet run in Google); workflow page.
- Decided 20 Oct: auto-apply with Sheet review, no Telegram. LinkedIn skipped. Instahyre first, one script per site.
- Built 20 Oct (branch `feat/instahyre`): Sheet endpoint, shared config and filters, cover note, Instahyre login helper and applier.
- Proven 20 Oct: filters and note on sample jobs; Sheet connection (read check, wrong secret refused); login survives a Chrome restart; inspect dry run read all 11 recommended jobs from Instahyre's feed, skipped 10 with reasons (7 title, 3 location), found 1 fit (Foresight Labs, Product Designer UI/UX) and its "Apply now" button.
- **First live application, 20 Oct (her OK):** Foresight Labs, Product Designer UI/UX. Instahyre shows "Application sent!", the Apply button is gone, and the row is in the Instahyre tab. No extra form appeared for this job. Fix made on the way: "Apply now" is a button inside a link, so the bot triggers the button itself.
- **Hourly timer on, 20 Oct (her OK):** Instahyre runs live every hour from 8am to 11pm, up to 10 applications a day. Proven: a timed run started by itself, read 8 jobs, skipped 8 with reasons. A missed hour (Mac asleep) runs once on wake.
- Fixed 20 Oct: an 8:13am run right after wake couldn't reach the Sheet ("fetch failed") and stopped early. Sheet calls now retry for about 50 seconds; rows that still can't be sent wait in `~/.jobbot/state/pending-rows.json` and go out on the next run.
- Live 20 Oct (PR #2 merged, timer refreshed): title tracks, pay rule for graphic roles, second note. Dry run on her feed: 2D Artist (OpEzee) and Visual Designer (Plaza) would be applied to, Graphic Designer (IDEX) becomes "Needs you" (no pay shown), 5 skipped for location.
- Built 20 Oct (branch `feat/sheet-format-and-recheck`): every tab wraps text and centers it vertically, with set column widths. Each run rechecks "Needs you" jobs; if she applied herself (Instahyre shows "Application sent!"), the row flips to Applied with a note. Proven in a dry run: IDEX India, which she applied to by hand, was detected. Needs her to paste the new `Tracker.gs`, run `setupTracker`, and deploy a new version of the web app.
- **Shared runner, 20 Oct (studio plan agreed with her):** Instahyre reshaped into five parts on branch `refactor/shared-runner`. Added: start-of-run check (stops a site whose page changed, saves a capture, keeps only the newest 12), cross-site rule (`crossSite`: apply once; apply on a second site only if no reply after 7 days; the 4 applications so far are remembered), `npm run status`, Health and Runs tabs, old-row migration, clasp deploys. Proven: dry run on her feed (seen 5, skipped 5 for location, health OK). Sheet side deployed with clasp on 20 Oct (web app version 3, same URL); format reapplied and old rows fixed; lookup checked (finds Plaza on Instahyre). PR #5 merged and timer switched (20 Oct). Proven: a timer run at 10:30 logged to the Runs tab and the Health line (OK, 3 of 10 applied, next 11:00); `npm run status` matches; `npm run sheet:peek` reads both tabs back. Fixed after: new rows kept the Sheet's default US date format; they now use "20 Oct 2026, 10:30".
- Next: Wellfound through the new-site steps (terms, profile check, recon, calibration, notes, one live apply, timer). Cap about 5 a day.
- Next after that: a week of live runs while she reviews the Sheet. Then add Instahyre search results, since the recommended feed has few product design roles.
- Idea: Instahyre's recommended feed is mostly visual and graphic roles. Its job search and "Similar jobs" show many more Product Designer roles in Bengaluru. Next step after the first live apply: also read search results for her titles.
- Later: fill company-site forms (Greenhouse, Lever, Ashby) for jobs that leave Instahyre; Cutshort; Wellfound.

## How it runs and moving to another laptop

- **Timer commands:** `npm run timer:status` (is it on, last log lines), `npm run timer:run-now`, `npm run timer:remove` (stop it). Log: `~/.jobbot/logs/instahyre.log`.
- macOS blocks background jobs from reading the Documents folder, so `npm run timer:install` copies the scripts, `.env` and private answers to `~/.jobbot/app` and the timer runs that copy. **After any script change, run `npm run timer:install` again.**
- The bot's Chrome window opens for a minute or two each hour. Don't close it mid-run; if you do, that run stops safely and the next hour tries again.

- The scripts are Node.js programs on the Mac. They drive a real Chrome window with Playwright (a free library that clicks and types like a person). Nothing is injected into the websites.
- The Sheet side is Google Apps Script, which lives in your Google account.
- Code lives in the private GitHub repo `SBorkar2002/job-hunt-automation`. On a new laptop: install Node, then run `git clone https://github.com/SBorkar2002/job-hunt-automation`, `npm install`, copy `.env` and `private/answers.local.json` across by hand (they are never in GitHub), and log in again with `npm run instahyre:login`.

## Instahyre terms (checked 20 Oct 2026)

Instahyre's Terms of Use say users must not "use ... automated software ... to crawl or spider any part of the Platform" and must not "harvest or scrape" content. So auto-applying breaks their terms, the same kind of rule as LinkedIn. Likely worst case: Instahyre restricts or closes her account. Ways to lower the risk: a small daily cap, slow pacing, her own Chrome profile, stop at any CAPTCHA or check. **Her decision (20 Oct 2026): yes, she accepts the account risk.** Cap: 10 applications a day, 90 to 180 seconds apart. Cover note draft approved.

Also from Instahyre's help centre: an application cannot be withdrawn once sent. So the first live run applies to one job only.

## Wellfound terms (checked 20 Oct 2026)

Wellfound's terms ban "automated or non-automated harvesting, collection or scraping" of content, and any automated system that puts "more ... load" on its servers "than a human can reasonably produce". Worst case: the account is suspended. Milder than Instahyre's, as long as the bot moves at a person's pace.

**Her decision (20 Oct 2026): yes, she accepts the account risk.** Cap: 5 applications a day, at least 3 minutes apart. Raise after a clean week. Wellfound treats the profile as the application, so the profile check comes first.

### Wellfound recon (20 Oct 2026, nothing applied)

- Login: Google sign-in, so it opens in plain Chrome (`npm run wellfound:login`); the bot reads that login through the Mac's real keychain. Proven: login survives a Chrome restart.
- Profile: Wellfound reports it complete (no pending steps). Wellfound sends the profile as the application.
- Job list: her saved search (Product Designer, Bengaluru, full time, remote open), read from the page's own data (GraphQL `JobSearchResultsX`): company, title, pay, locations, remote, posted time, already applied.
- Apply: an Apply dialog with one question, "What interests you about working for this company?", then "Send application". The timer never writes this note: such jobs wait as "Needs note" until she approves a note drafted in this chat.
- Applied: shown on the job page and in Applied > Ongoing. Exact wording confirmed at the first live application.
- First dry run: 13 jobs seen, 0 matched (7 title, 6 older than 24 hours). Calibration with her is next.
- Calibration with her (20 Oct): Wellfound freshness 14 days (`postedWithinHours` 336); every site skips jobs whose shown pay is under 6 LPA (`minPayLpa`); pay that is shown but unclear (for example "₹75,000 – ₹1.5L") goes to Needs you; "AI Design Engineer" added to product titles.
- **First live Wellfound application, 20 Oct (her OK):** Intempt Technologies, AI Design Engineer, applied on her request outside the filters (posted 76 days ago) with the note she approved. Proof: Wellfound Applied list shows it as Pending; the job page shows "✓ Applied"; the row is in the Wellfound tab. `isApplied` now checks for that tick.
- **Wellfound on the timer, 20 Oct (her OK):** runs at :30 each hour (Instahyre at :00), 8am to 11pm, cap 5 a day. Proven: a timer run at 15:26 logged to the Runs tab and the Health line (OK, 1 of 5); `npm run status` shows both sites. Flow page updated with a section per site.
- Next: a week of live runs on both sites while she reviews the Sheet. Then Cutshort through the same new-site steps.
