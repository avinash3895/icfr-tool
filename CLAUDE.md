# ICFR Portal

An internal portal for managing ICFR (internal control over financial reporting): process narratives, the risk and control matrix (RCM), and testing of controls (TOC).

## What is in this folder

- `prototype/` holds six HTML mock-ups, one per page. They are the visual reference for the look and feel. Open each one in a browser.
- The mock-ups use sample data and scripted behaviour only. Nothing is saved and there is no backend.
- Each mock-up was drawn at a small fixed width (480px). Treat them as a design reference, not as code to ship. Rebuild the pages properly, responsive, in the real stack, and keep the same layout, colours and behaviour.

| File | Page |
| --- | --- |
| `01-signin.html` | Sign in |
| `02-dashboard.html` | Dashboard |
| `03-process-narrative.html` | Process narrative |
| `04-rcm.html` | RCM |
| `05-templates.html` | Templates |
| `06-toc.html` | TOC (test of controls) |

## Build order

1. First, the look and feel of every page (this is what the prototype shows).
2. Then functionality, page by page, with a real data model and storage.

Do not add features beyond what is listed here without asking.

## Style

- Professional navy palette. Main navy `#1f3a5f`, page background `#eef2f7`, borders `#d5dde8`, text `#1f2d3d`, muted text `#6b7a90`.
- No green and no yellow anywhere. Status pills: navy filled for good or done, light blue for neutral, grey for not started, soft red for exception or returned, soft amber only for "due soon" on the dashboard.
- Font stack: Interstate, then Segoe UI, Arial, sans-serif.
- Keep every page simple. Show only the essentials (for example no status or date columns on lists unless asked).
- Never use real company or business-segment names. Use generic placeholders.

## Shared layout

- Navy sidebar on the left with: Dashboard, Process narrative, RCM, TOC, Templates. No Walkthrough module. No Settings link in the sidebar.
- The sidebar collapses to a narrow rail showing letter icons, using an arrow toggle. It collapses automatically when a detail view opens.
- At the bottom of the sidebar is a round avatar with the user's initial plus name and role. Clicking it opens a small menu with Settings and Log out.
- Every page after sign in has an AI assistant box at the bottom right. It collapses and expands like a chat box. Once a provider is set in Settings it is one agent on every page (see "AI assistant" below). Without a provider, Process narrative shows the scripted demo and the other pages point to Settings.

## Pages

### 1. Sign in
Very simple. A centred box with logo text, Email, Password and a Sign in button. No SSO.

### 2. Dashboard
KPI cards (controls, tested %, open issues, overdue), testing progress bars per process, and a "My actions" list.

### 3. Process narrative
- First a list of existing processes (process name and owner only). Click one to open it.
- Inside a process it is a Word-like document editor with a minimal toolbar: block style (normal, headings), font, size, bold, italic, underline, text colour, left, centre and justified alignment, bullet and numbered lists.
- The AI assistant is agentic, not just a chat box. It reads the RCM and the narrative, shows what it is doing step by step, then proposes changes. Nothing is applied until the user approves. Examples: draft a "Key controls" section from the RCM, find control gaps and offer to add draft controls to the RCM, with an Undo.

### 4. RCM
- First a list of processes with control counts. Click one to open its risk and control table.
- Columns: Risk ID, Risk description, Control ID, Control description, Type, Nature, Frequency, Owner, Key, Assertions, Testing attributes, Actions.
- Testing attributes are set per control (for example DoA, Sign-off). They feed the TOC page.
- Users can add a control (row), edit or delete a control (with a confirm bar), add a column, rename a column and delete a column.

### 5. Templates
- Lists processes with where each is pushed to (PN, RCM, TOC).
- "Create process" is a two-step flow: process name and owner, then choose where to create it (PN, RCM, TOC) and push to all.
- A created process appears in Process narrative, RCM and TOC.
- Deleting a template asks for confirmation and deletes everything linked to it: its narrative, RCM controls and TOC tests.

### 6. TOC (test of controls)
Mirrors the RCM structure.
- List of processes, then the process's controls table with a Status column (Not tested, Effective, Exception), then a control detail page.
- Control detail has: the editable testing procedure, one upload slot per testing attribute (attributes come from the RCM, evidence is uploaded per attribute), an "Exceptions noted" box, a conclusion dropdown (Not tested, Effective, Exception), Save and Submit.
- Submit asks for a second confirmation and needs a conclusion first. Once submitted, the control is locked: nothing can be edited and uploads cannot be removed. Users cannot go back. A real build needs an admin-only unlock.
- The list status shows the submitted state, for example "Effective · Submitted".

### 7. Settings
Opened from the avatar menu (not the sidebar). An "AI assistant" card: provider (Anthropic, OpenAI, Google Gemini, OpenAI-compatible), API key, model, optional base URL, Save, Test connection, Remove. The key is kept in the browser's local storage and sent straight to the provider.

### AI assistant (agent)
- Works on every page and keeps its conversation while the user moves between pages. Each message tells it which page, process and control the user is on.
- Read tools run on their own: list processes, read RCM, narrative and tests, open a page.
- Write tools only propose: add, update or delete controls; add, rename or delete RCM columns; append to or replace a narrative; update a test's procedure, exceptions or conclusion; create a process. Each proposal is a card with Approve and Reject (and Approve all); applied changes have Undo.
- It cannot submit tests, unlock submitted tests or delete processes. Submitted tests are locked for it too.

### Export
- Process narrative: Export to Word (.docx), keeping headings, bold, italic, underline, colour, alignment and lists.
- RCM: Export Excel (.xlsx) and Export Word (.docx, landscape table), with the current columns.

## Open points for the real build

- Roles and permissions (who can edit RCM, who can test, who can review or unlock).
- Audit trail for submitted tests.
- Moving AI keys from the browser to a server (for example a Supabase or Vercel function) so users do not handle keys, with per-user limits and logging.

## Code layout (current build)

- `index.html` loads React 18.3.1, ReactDOM, htm 3.1.1 and supabase-js 2.119.0 from unpkg, then the files in `assets/`. There is no build step; open `index.html` directly or serve the folder.
- `assets/styles.css` holds every style. Colours are CSS variables at the top.
- `assets/data.js` holds column defaults, the sample data used to seed the database, and helpers.
- `assets/ai.js` holds the AI settings, the provider adapters (Anthropic, OpenAI and compatible, Gemini) and the agent's tools.
- `assets/export.js` builds the Word and Excel files; docx 9.15.3 (unpkg) and SheetJS xlsx 0.18.5 (cdnjs) load only on export.
- `assets/app.js` holds all pages and the shared layout. Routes use the URL hash: `#/dashboard`, `#/pn/<process>`, `#/rcm/<process>`, `#/toc/<process>/<control>`, `#/templates/new`.
- Data is saved in Supabase project ICFR-Tool (`cfqxeuedcbscnupgqxxw`). Sign-in is Supabase email and password. `assets/config.js` holds the project URL and publishable key; `assets/store.js` loads everything at sign-in and saves changes about half a second after each edit (only what changed). Tables: `icfr_processes` (with `rcm_columns`), `icfr_narratives`, `icfr_controls` (`values` jsonb), `icfr_tests`, `icfr_evidence`; files in the private `icfr-portal-evidence` bucket. Schema: `supabase/migrations/`.
- The database enforces the test lock: submitted tests cannot be edited, un-submitted or have evidence added or removed, except by profiles with role `admin`. Only admins can change roles.
- The project also holds older, empty tables from a previous version (`processes`, `controls`, `evidence` and others). The portal does not use them.
- The dashboard's Overdue figure and My actions list are still sample data.
- Hosted on Vercel, project `icfr-portal` (https://icfr-portal.vercel.app).
