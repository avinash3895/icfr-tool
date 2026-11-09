# ICFR Hub

A multi-entity ICFR website: per-entity dashboards, process templates you design yourself, an RCM per process with Excel download and upload, walkthroughs and periodic control testing, three-step sign-off, evidence files and a full audit trail.

This is a new project. It shares no code or database with the older `index.html` tool in this repository.

Stack (same as Studio Opal): Vite + React (plain JSX), Supabase (Postgres, Auth, Storage, one Edge Function) and Vercel.

## What it does

| Area | How it works |
|---|---|
| Entities | Admins add entities (code, name, country, currency, fiscal year-end month). Each entity has its own processes, controls, testing and access. |
| Processes (master templates) | Admins create a process per entity with **New process**: details first, then its columns. Columns can be renamed, re-typed, reordered, added and removed later under **Edit process**. Renaming keeps the data, and removing hides the column, which can be brought back with its data. Seven system columns drive the app and can be renamed but not removed: Control ID, Control Description, Key Control, Control Frequency, Testing Frequency, Responsible Person(s), Manager / Reviewer. |
| RCM | One grid per process. Add or edit a control in the side panel, or use **Download Excel** / **Blank template**, edit the file, and use **Upload Excel**. **Download all** on the Processes page gives one workbook with a sheet per process. |
| Walkthroughs & testing | Finance clicks **Set up FY testing** once per year (and again later to add new controls). This creates one walkthrough per control and one test per testing period: Annual = FY, Semi-annual = H1/H2, Quarterly = Q1–Q4, Monthly = M01–M12. Periods follow the entity's year end. |
| Sign-off | Every RCM row, walkthrough and test goes: Responsible person submits (that counts as their sign-off) → Manager signs off → Finance signs off. The manager or finance can send it back with a comment, and it returns to the responsible person. Once submitted, the preparer cannot edit until it is sent back. |
| Dashboard | Per entity and fiscal year: controls and key controls, RCM sign-off %, walkthroughs and tests signed off, overdue tests, items awaiting sign-off, ineffective results, controls without an owner, a per-process progress table, testing by period, conclusions and recent activity. The **Entities** home page compares all entities. |
| My tasks | Everything waiting for you across entities: to prepare, manager sign-off, finance sign-off, and items you submitted. |
| Files | Evidence can be attached to a control, a walkthrough or a test (Supabase Storage, private). Uploaded Excel files are kept under **Uploads & activity**. |
| Audit trail | Every field change, sign-off and send-back, with who and when, on each record and per entity. |

### Roles and access

| Role | Can do |
|---|---|
| Admin | Everything: entities, processes and templates, users and access, plus finance sign-off. The first account created becomes admin. |
| Finance | Sees every entity, can edit any control or test, and gives the final sign-off. |
| User | Sees only the controls where their email is in **Responsible** or **Manager**, plus anything granted to them. |
| Viewer / Auditor | Read-only on what is granted to them. |

Access grants (**Users → Manage**) open a whole entity, one process, or a single control. They can be view-only or "can edit". "Can edit" lets the person prepare and submit in that scope; an entity- or process-level edit grant also lets them add new controls. Every rule is enforced in the database (row-level security and `security definer` functions), not only in the browser.

### Excel upload rules (built as described; open to change)

1. Rows are matched by **Control ID** within the process. A Control ID that isn't in the process yet becomes a new control.
2. A row deleted from the file is **not** deleted in the app. Controls are archived in the app instead.
3. Before anything is saved you see a preview: new rows, changed fields (old value → new value) and unchanged rows.
4. **Any problem blocks the whole file**, for example a missing required value, a value not in the list, a bad email or date, a duplicate Control ID, or a column that appears twice. Fix the file and upload again; you can download the problem list as Excel.
5. Unchanged rows are ignored, so a user can upload the full process file even if they own only one control.
6. A non-finance user can change only controls where they are Responsible (or have an edit grant), only while the control is Draft or Sent back, and cannot change Responsible or Manager.
7. Columns are matched by header name. If a column was renamed after the file was downloaded, it is matched by its position in the original file. Unknown columns are ignored with a note.
8. If a control was changed in the app after the file was downloaded, the preview flags it as "newer in app" so you don't overwrite newer work by accident.
9. A file covering several processes is saved process by process. Each process is all-or-nothing.
10. Values are cleaned up on upload: `yes`/`y`/`1` → Yes, list values are matched ignoring case, several emails or list values are separated with `;`, and dates can be date cells, `YYYY-MM-DD` or `DD/MM/YYYY`.

## Project layout

```
icfr-hub/
  supabase/migrations/   0001_core.sql      tables
                         0002_access.sql    access functions + row-level security
                         0003_workflow.sql  save functions, sign-off workflow, test plan, audit trail
                         0004_storage.sql   private buckets "evidence" and "uploads"
  supabase/functions/admin-users/           create users / set passwords (admin only)
  src/lib/        api.js (all database calls), excel.js (download/upload), util.js, stats.js, app.js
  src/components/ drawers, sign-off bar, column editor, upload flow, UI kit
  src/pages/      Home, EntityPage, Dashboard, Processes, TemplateEditor, ProcessRcm, Testing, Tasks, Activity, Admin*
```

## Setup

1. **Supabase project.** Create a new project (for example `icfr-hub`, region ap-south-1).
2. **Database.** Run the four files in `supabase/migrations/` in order, either in the SQL editor or with `supabase db push`.
3. **Edge function.** Deploy `supabase/functions/admin-users` (`supabase functions deploy admin-users`). It uses the built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets.
4. **Auth settings.** Under Authentication → Sign In / Providers, keep Email enabled, **turn off "Allow new users to sign up"**, and turn off email confirmation. Users are created by admins in the app.
5. **First admin.** In Authentication → Users → Add user, create your own account with a password. The first account automatically becomes **Admin**.
6. **Vercel.** Create a project with root directory `icfr-hub` and framework Vite, then set:
   - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the project's publishable (anon) key
7. Sign in, add entities under **Setup**, create processes, add users under **Users**.

Local development: copy `.env.example` to `.env.local`, fill both values, then run `npm install` and `npm run dev`.
