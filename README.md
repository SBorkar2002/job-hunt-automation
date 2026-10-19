# Job hunt automation

Scripts that find fresh design roles and apply (or alert) fast, so Sejal can work on other projects while the hunt runs.

This file is the single tracker: requirements, answers, what exists, how to run it, what is done and what is left.

## Goal

Be one of the first applicants on every good-fit role. Recruiters often start from the top of the list, so speed after posting is the main lever. Fit still matters, so filters stay strict.

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
| Action | Applied, Alerted, Skipped |
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

Private answers (pay, phone, notice) are in `private/answers.local.md`, which is never committed or uploaded.

**Roles**
- Titles: Product Designer, UX Designer, UI/UX Designer, AI / GenAI Product Designer, Interaction Designer.
- Level: entry and Associate (0 to 2 years). Skip Senior, Lead, Principal, Manager.
- Locations: Bengaluru, Mumbai, remote (India).
- Start: Dec 2026. Flag "immediate joiner" roles, don't skip them.
- Prefer: AI products, fintech, consumer apps, design-led startups.
- Avoid: agencies, IT services, unpaid or contract-only roles, betting apps.
- Dream companies: list pending from Sejal. They ping instantly and skip filters.

**Sites and actions**
- Sources: LinkedIn (alerts only), Instahyre, Wellfound, Cutshort, career pages. Later: Naukri, Hirist, YC Work at a Startup.
- Allowed: one-click and short forms, filled for her approval. Recruiter messages and cold emails are drafted only; she sends them.
- LinkedIn: route A. No script logs in or clicks on LinkedIn.

**Freshness**
- Posted within 24 hours. Under 3 hours old means an urgent ping.
- Under 100 applicants preferred.
- Post keywords: "hiring" plus "product designer", "UX designer", "design role".
- Exclude: senior, lead, principal, manager, 5+ years, intern.

**Resume, note, portfolio**
- Resume: the PDF on the site (sejalborkar.vercel.app/resume), one version for now.
- Cover note: one 3-line template filled with company, role and one line from the job post. No paid AI. She edits before anything goes out.
- Portfolio: sejalborkar.vercel.app with ?ref=<site> per source (needs Vercel Analytics on).
- Email for applications: personal Gmail, not Epifi.

**Control, alerts, running**
- She approves every application. Loosen per site after a week if it goes well.
- Alerts: Telegram bot (free) with Approve and Skip buttons, plus a 9pm email summary. Quiet 11pm to 8am IST.
- Watchers run in the cloud on Google Apps Script (free, laptop can be off).
- Applying: she taps on her phone, then her Mac applies when it's awake, using its own Chrome profile she logs into herself. No saved logins online.
- Budget: free only. Ask before anything paid.
- Log: Google Sheet on her personal account, one tab per source.
- Order: shared setup, then sources one at a time.

## What exists

- `apps-script/Tracker.gs`: shared setup. Creates the Sheet and its tabs (columns, status dropdowns, auto "Minutes to apply"), logs jobs without duplicates (`addJob`), and sends Telegram pings (`ping`) that stay muted in quiet hours.
- `private/answers.local.md`: private answers template (git ignored).
- `docs/workflow.html`: the full workflow diagram for LinkedIn, Instahyre, Cutshort and Wellfound, including every case where Telegram is used. Live page: https://claude.ai/artifact/9No5UMQKk65HViTicyM6SB

## Setup steps for Sejal (about 10 minutes, once)

1. **Telegram bot.** In Telegram, open @BotFather, send `/newbot`, pick a name. Copy the token it gives you. Don't paste the token in chat or in any file.
2. **Apps Script.** Signed in to your *personal* Google account, go to script.google.com and click New project. Name it "Job hunt bot". Delete the sample code and paste all of `apps-script/Tracker.gs`.
3. **Token.** In Project Settings (gear icon), under Script Properties, add `TELEGRAM_TOKEN` with your bot token as the value.
4. **Sheet.** Back in Editor, pick `setupTracker` in the function menu and click Run. Allow the permissions Google asks for (it's your own script). The log shows your new Sheet's link.
5. **Link phone.** Send "hi" to your bot in Telegram. Then run `linkTelegram`. You should get "Job hunt bot is linked".
6. **Test.** Run `testPing`. A test alert should reach your phone.

## Status

- Done: requirements and answers recorded; git set up; shared setup script written (passes a syntax check, not yet run in Google).
- Next: Sejal runs the setup steps above. Then the first source.
- Left: every source script.

## Open decision: first source

LinkedIn job alert emails come daily or weekly at most, not instantly ([guide](https://www.viralbrain.ai/blog/linkedin-job-alerts), [Cooper](https://cooper.edu/continuing-education/setting-job-alerts-linkedin)). So an email watcher would be up to a day late, which defeats "apply first". Recommended instead:
- **Start with career pages** (Greenhouse, Lever, Ashby public feeds). Roles show there first, often before LinkedIn, and checking them every 10 minutes is allowed and free. Needs the dream company list.
- **LinkedIn speed:** turn on LinkedIn app push notifications for job alerts (near instant, from LinkedIn itself). You apply from the phone; a later script only logs it.
