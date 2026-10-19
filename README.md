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
| Posted at | When the job or post went live |
| Applied at | When the application went in |
| Minutes to apply | Applied at minus Posted at |
| Company | |
| Role | Position applied for |
| Location / mode | City, remote, hybrid |
| Applicants | Count when applied, if shown |
| Job link | |
| Post link | Hiring post, if it came from one |
| Recruiter / poster | Name and profile link, if known |
| Resume version | |
| Note used | Cover note version |
| Action | Applied, Needs you, Skipped |
| Status | Applied, Viewed, Replied, Interview, Offer, Rejected, No reply |
| Response at | When she heard back |
| Follow-up on | Date to nudge |
| Notes | |

## Hard limits

- No getting past CAPTCHAs or bot checks.
- No passwords in code or files. Sejal logs in herself.
- Nothing is sent without the approval flow she picks.
- No paid tools or credits without asking.

## Answers (Sejal said "ok" to all defaults, 19 Oct 2026)

Private answers (pay, phone, notice) are in `private/answers.local.json`, which is never committed or uploaded.

**Roles**
- Titles: Product Designer, UX Designer, UI/UX Designer, AI / GenAI Product Designer, Interaction Designer.
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

- `apps-script/Tracker.gs`: shared setup. Creates the Sheet and its tabs (columns, status dropdowns, auto "Minutes to apply"), and logs jobs without duplicates (`addJob`).
- `apps-script/Tracker.gs` also has `doPost`: the endpoint the Mac scripts use to check for and log rows, guarded by a secret.
- `shared/config.json`: titles, excluded words, cities, caps, cover note (draft, needs her OK). Edit this to change filters.
- `shared/filters.mjs`: decides if a job fits and gives the reason. `shared/sheet.mjs`: logs rows (prints only in dry run).
- `instahyre/login.mjs` (`npm run instahyre:login`): opens Instahyre in the bot's own Chrome profile for her to log in once.
- `instahyre/apply.mjs`: the Instahyre applier. `npm run instahyre:dry` (reads and decides, applies to nothing), `npm run instahyre:inspect` (dry run plus page captures in `instahyre/debug/`, git ignored), `npm run instahyre:live -- --limit 1` (one real application). Stops on logout or any CAPTCHA. Jobs that send her to a company website are marked "Needs you" for now.
- `private/answers.local.json`: private answers (git ignored). Blank until she fills it.
- `docs/workflow.html`: the auto-apply workflow for LinkedIn, Instahyre, Cutshort and Wellfound. Live page: https://claude.ai/artifact/9No5UMQKk65HViTicyM6SB

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
- Not proven yet: what happens after clicking "Apply now" (any form). Needs one live apply.
- Next: `npm run instahyre:live -- --limit 1` with her OK, then show the Sheet row. Then the hourly timer on the Mac.
- Idea: Instahyre's recommended feed is mostly visual and graphic roles. Its job search and "Similar jobs" show many more Product Designer roles in Bengaluru. Next step after the first live apply: also read search results for her titles.
- Later: fill company-site forms (Greenhouse, Lever, Ashby) for jobs that leave Instahyre; Cutshort; Wellfound.

## How it runs and moving to another laptop

- The scripts are Node.js programs on the Mac. They drive a real Chrome window with Playwright (a free library that clicks and types like a person). Nothing is injected into the websites.
- The Sheet side is Google Apps Script, which lives in your Google account.
- Code lives in the private GitHub repo `SBorkar2002/job-hunt-automation`. On a new laptop: install Node, then run `git clone https://github.com/SBorkar2002/job-hunt-automation`, `npm install`, copy `.env` and `private/answers.local.json` across by hand (they are never in GitHub), and log in again with `npm run instahyre:login`.

## Instahyre terms (checked 20 Oct 2026)

Instahyre's Terms of Use say users must not "use ... automated software ... to crawl or spider any part of the Platform" and must not "harvest or scrape" content. So auto-applying breaks their terms, the same kind of rule as LinkedIn. Likely worst case: Instahyre restricts or closes her account. Ways to lower the risk: a small daily cap, slow pacing, her own Chrome profile, stop at any CAPTCHA or check. **Her decision (20 Oct 2026): yes, she accepts the account risk.** Cap: 10 applications a day, 90 to 180 seconds apart. Cover note draft approved.

Also from Instahyre's help centre: an application cannot be withdrawn once sent. So the first live run applies to one job only.
