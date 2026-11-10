# ICFR Hub

A multi-entity ICFR website: per-entity dashboards, process templates you design yourself, an RCM per process with Excel download and upload, walkthroughs and periodic control testing, three-step sign-off, evidence files and a full audit trail.

This is a new project. It shares no code or database with the older `index.html` tool in this repository.

Stack (same as Studio Opal): Vite + React (plain JSX), Supabase (Postgres, Auth, Storage, one Edge Function) and Vercel.

## What it does

| Area | How it works |
|---|---|
| Entities | Admins add entities (code, name, country, currency, fiscal year-end month). Each entity has its own processes, controls, testing and access. |
| Processes (master templates) | Admins create a process per entity. Each process has **three templates**: RCM, Walkthrough and Testing. Columns can be added, renamed, re-typed, reordered and removed under **Edit process**. Renaming keeps the data, and removing hides the column, which can be brought back with its data. System columns (Control ID, Description, Key Control, Risk Level, Control Frequency, Testing Frequency, Sample Size, Responsible, Manager; and Conclusion / Sample Size / Exceptions on the testing side) can be renamed but not removed. |
| RCM | A spreadsheet-style grid per process: click a cell to edit (Enter/Tab confirms, Esc cancels), **+ Add row**, then **Save changes**. Only admins (the finance team) change the RCM, and there is no sign-off on it. Download/upload Excel per process or for the whole entity. |
| Sample size master | **Setup → Sample size master**: a grid of control frequency × risk level. Every control gets its sample size from it. Admins can type a different number on a control (shown as *manual*); clearing it goes back to the master (*auto*). Saving the master updates every control and every test not yet submitted, except numbers typed in by hand. Process owners cannot change sample sizes. |
| Walkthroughs & testing | **Set up FY testing** creates one walkthrough per control and one test per testing period (Annual = FY, Semi-annual = H1/H2, Quarterly = Q1–Q4, Monthly = M01–M12), following the entity's year end. Each test gets the control's sample size. The testing page is a spreadsheet per process with a tab for the walkthrough and each period; the responsible person fills the cells and submits each row. |
| Sign-off (walkthroughs and tests) | The responsible person submits (that counts as their sign-off) → Manager signs off → Admin (finance) signs off. The manager or finance can send it back with a comment. Once submitted, the preparer cannot edit until it is sent back. Every required column must be filled before submitting. |
| Email | **Send emails** (Processes page) or **Email** (RCM page): by selected controls, by person, or by process. Each person gets one email with only their controls, with **one Excel file per process** (e.g. P2P with 5 controls and O2C with 2 controls). You can also send everything to fixed addresses. Sent emails are listed under **Uploads & activity → Emails**. |
| Dashboard | Per entity and year: controls, key and high-risk controls, walkthroughs and tests signed off, overdue tests, awaiting sign-off, ineffective results, controls without an owner, a per-process table, testing by period and recent activity. The **Entities** page compares entities. |
| My tasks | Walkthroughs and tests waiting for you: to prepare, manager sign-off, final sign-off (admins), and items you submitted. |
| Files & audit trail | Evidence on controls, walkthroughs and tests; uploaded Excel files are kept; every change, sign-off, upload and email is recorded. |

### Roles and access

| Role | Can do |
|---|---|
| Admin (finance) | Everything: entities, processes and templates, RCM, sample size master, users, emails, and the final sign-off. The first account created becomes admin. |
| User | Sees the controls where their email is in **Responsible** or **Manager**, plus anything granted. Fills and submits walkthroughs/tests as responsible person; signs off as manager. Cannot change the RCM or sample sizes. |
| Viewer / Auditor | Read-only on what is granted to them. |

Access grants (**Setup → Users & access → Manage**) open a whole entity, one process or a single control, view-only or "can edit" (prepare and submit walkthroughs/tests in that scope). Every rule is enforced in the database (row-level security and `security definer` functions), not only in the browser.

### RCM Excel upload (admins only) – the rule

The downloaded sheet has **Existing Control ID** (the number in ICFR Hub today) and **New Control ID** (the number you want).
On upload the app compares the two and takes the New Control ID:

| In the file | Result |
|---|---|
| Existing ID filled, New ID the same | that control, other changed columns are updated |
| Existing ID filled, New ID different | that control gets the new number (renumbering, swaps such as 02 ↔ 03 work) |
| Existing ID empty | new control |
| Control not in the file | removed (history kept, can be restored with “Show removed”) |

You see every change before saving. A file with a problem (required value missing, value not in the list, unknown Existing ID, the same New ID twice, …) is not saved at all; the problem list can be downloaded.
Sample Size: keep the master value or leave it empty to use the master; another number is a manual override.

### Testing Excel (walkthroughs and tests)

On **Walkthroughs & testing**, **Download Excel** gives the selected process for the selected year: one sheet for the walkthrough and one per test period (Q1…Q4 etc.), with grey information columns and the white columns of the testing template.
Responsible people fill it and **Upload Excel**: rows are matched by Control ID; only rows they may edit (Draft / Sent back, their controls) can change; Sample Size can only be changed by admins. Uploading saves the work; each row is then submitted on the website.

### AI assistant

"Ask AI" (bottom right, or Ctrl/Cmd+K) is a chat that can do what the signed-in person could do by hand: create entities and processes, change templates, add or load controls from an attached Excel/CSV, set up the testing year, fill walkthroughs and tests, submit and sign off, set sample sizes, add users, download Excel, open pages and answer questions about the data.

- Admins connect a provider under **Setup → AI assistant**: Anthropic Claude, or anything OpenAI-compatible (OpenAI, Gemini, OpenRouter, Groq, a company endpoint). Several can be saved; one is active.
- API keys live in `icfr_ai_providers`, which has no access policies; only the `icfr-ai` edge function reads it. The browser never gets a key back.
- The function only relays the chat. Every action runs in the browser with the person's own login, so access rules and the audit trail apply as usual. Removals always ask first; "Ask me before it changes anything" makes every change ask.

### Email

Built and working up to the send step, but **not connected to a mailbox yet** (placeholder). When the company mailbox is ready, set the `ICFR_RESEND_API_KEY` and `ICFR_MAIL_FROM` secrets on the `icfr-send-email` function, or replace its send step with the company mail service.

## Project layout

```
icfr-hub/
  supabase/migrations/   0001_core.sql      tables
                         0002_access.sql    access functions + row-level security
                         0003_workflow.sql  save functions, sample sizes, Excel upload, sign-off, test plan, audit trail
                         0004_storage.sql   private buckets "evidence" and "uploads"
                         0005_hardening.sql functions callable by signed-in users only
                         0006_ai.sql        AI provider settings (server-only table)
  supabase/functions/admin-users/           create users / set passwords (admin only)
  supabase/functions/send-email/            sends emails with Excel attachments through Resend (admin only)
  src/lib/        api.js (all database calls), excel.js (download/upload), util.js, stats.js, app.js
  src/components/ SheetGrid (spreadsheet), drawers, sign-off bar, column editor, upload flow, email composer, UI kit
  src/pages/      Home, EntityPage, Dashboard, Processes, TemplateEditor, ProcessRcm, Testing, Tasks, Activity, Admin* (entities, users, sample size master)
```

## Where it runs

- **Database, login, files, functions:** the existing Supabase project **studio-admin** (`ybagmgjseignnyleovee`). Everything ICFR uses is prefixed so nothing else in that project is touched:
  tables and functions `icfr_*` in `public`, storage buckets `icfr-evidence` and `icfr-uploads`, edge functions `icfr-admin-users`, `icfr-send-email` and `icfr-ai`. No trigger was added to the shared login table.
- The login is shared with the other studio apps, but a login only gets into ICFR Hub when it has an `icfr_profiles` row.
- **First admin:** open the website; while there is no ICFR admin, the sign-in page shows “First time here? Set up ICFR Hub”. That creates your admin login (or links an existing one with its current password). After that the option disappears.
- **Website:** Vite + React, deployed to Vercel. `.env.production` holds the public Supabase URL and publishable key.

## Setting it up again elsewhere

1. Run the four files in `supabase/migrations/` in order.
2. Deploy `supabase/functions/icfr-admin-users`, `icfr-send-email` and `icfr-ai` (JWT verification off; they check the user themselves).
3. Put the project URL and publishable key in `.env.production`, build (`npm install && npm run build`) and deploy `dist/` (Vercel: root directory `icfr-hub`, framework Vite).
