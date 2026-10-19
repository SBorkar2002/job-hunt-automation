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

Private answers (pay, phone, notice) are in `private/answers.local.md`, which is never committed or uploaded.

**Roles**
- Titles: Product Designer, UX Designer, UI/UX Designer, AI / GenAI Product Designer, Interaction Designer.
- Level: entry and Associate (0 to 2 years). Skip Senior, Lead, Principal, Manager.
- Locations: Bengaluru, Mumbai, remote (India).
- Start: Dec 2026. Flag "immediate joiner" roles, don't skip them.
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
- LinkedIn: she wants auto Easy Apply too. Pending her final yes after the ban-risk warning (20 Oct). Hiring posts: message drafted in the Sheet; she sends it (no auto DMs or emails).
- Budget: free only. Ask before anything paid.
- Log: Google Sheet on her personal account, one tab per source.
- Order: shared setup, then sources one at a time.

## What exists

- `apps-script/Tracker.gs`: shared setup. Creates the Sheet and its tabs (columns, status dropdowns, auto "Minutes to apply"), and logs jobs without duplicates (`addJob`). Its Telegram code is no longer used.
- `private/answers.local.md`: private answers template (git ignored).
- `docs/workflow.html`: the auto-apply workflow for LinkedIn, Instahyre, Cutshort and Wellfound. Live page: https://claude.ai/artifact/9No5UMQKk65HViTicyM6SB

## Setup steps for Sejal (about 5 minutes, once)

1. **Apps Script.** Signed in to your *personal* Google account, go to script.google.com and click New project. Name it "Job hunt bot". Delete the sample code and paste all of `apps-script/Tracker.gs`.
2. **Sheet.** Pick `setupTracker` in the function menu and click Run. Allow the permissions Google asks for (it's your own script). The log shows your new Sheet's link.
3. **Logins (later, per site).** When a site's script is ready, it opens its own Chrome window once. You log in there yourself. It remembers that login on your Mac only.

## Status

- Done: requirements and answers recorded; git set up; Sheet setup script written (syntax checked, not yet run in Google); workflow page.
- Decided 20 Oct: auto-apply with Sheet review, no Telegram.
- Next: Sejal's final yes on LinkedIn auto Easy Apply, then the first site script.
- Left: every site script; drop the unused Telegram code from `Tracker.gs`.
