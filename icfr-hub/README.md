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

### RCM Excel upload rules (admins only)

1. Every downloaded sheet starts with a grey **Existing Control ID** column. It tells the app which control each row is. Do not change it.
2. **Renumber** a control by changing its **Control ID** (for example after inserting a new control in the middle). Swaps such as 02 ↔ 03 work.
3. **Add** a control by adding a row with Existing Control ID left empty.
4. **Remove** a control by deleting its row. The preview lists the controls missing from the file; tick the box to remove them. Removed controls keep their walkthroughs, tests, files and history and can be restored (**Show removed**).
5. Before anything is saved you see every new, changed, renumbered and removed control (old value → new value).
6. **Any problem blocks the whole file**: missing required value, value not in the list, bad email/date/number, Existing Control ID that does not exist, the same Control ID twice after the upload, a column twice. The problem list can be downloaded as Excel.
7. Sample Size in the file: leave the master value or empty to use the master; a different number becomes a manual override for that control.
8. Columns are matched by header name, or by position if a column was renamed after the file was downloaded. Unknown columns are ignored with a note.
9. If a control was changed in the app after the file was downloaded, the preview flags it as "newer in app".
10. A file without the Existing Control ID column (an old file) matches rows by Control ID and removes nothing.
11. Values are cleaned up: `yes`/`y`/`1` → Yes, list values ignore case, several emails or values are separated with `;`, dates can be date cells, `YYYY-MM-DD` or `DD/MM/YYYY`.

## Project layout

```
icfr-hub/
  supabase/migrations/   0001_core.sql      tables
                         0002_access.sql    access functions + row-level security
                         0003_workflow.sql  save functions, sample sizes, Excel upload, sign-off, test plan, audit trail
                         0004_storage.sql   private buckets "evidence" and "uploads"
  supabase/functions/admin-users/           create users / set passwords (admin only)
  supabase/functions/send-email/            sends emails with Excel attachments through Resend (admin only)
  src/lib/        api.js (all database calls), excel.js (download/upload), util.js, stats.js, app.js
  src/components/ SheetGrid (spreadsheet), drawers, sign-off bar, column editor, upload flow, email composer, UI kit
  src/pages/      Home, EntityPage, Dashboard, Processes, TemplateEditor, ProcessRcm, Testing, Tasks, Activity, Admin* (entities, users, sample size master)
```

## Setup

1. **Supabase project.** Create a new project (for example `icfr-hub`, region ap-south-1).
2. **Database.** Run the four files in `supabase/migrations/` in order, either in the SQL editor or with `supabase db push`.
3. **Edge functions.** Deploy `admin-users` and `send-email` (`supabase functions deploy admin-users send-email`). Both use the built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
   For email, create a free [Resend](https://resend.com) account, verify your company domain there, and set the function secrets `RESEND_API_KEY` and `MAIL_FROM` (for example `ICFR Hub <icfr@yourcompany.com>`).
4. **Auth settings.** Under Authentication → Sign In / Providers, keep Email enabled, **turn off "Allow new users to sign up"**, and turn off email confirmation. Users are created by admins in the app.
5. **First admin.** In Authentication → Users → Add user, create your own account with a password. The first account automatically becomes **Admin**.
6. **Vercel.** Create a project with root directory `icfr-hub` and framework Vite, then set:
   - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the project's publishable (anon) key
7. Sign in, add entities under **Setup**, create processes, add users under **Users**.

Local development: copy `.env.example` to `.env.local`, fill both values, then run `npm install` and `npm run dev`.
