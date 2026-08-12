# Production Tracker

Kanban board for tracking any kind of production run (tracks, episodes, chapters,
client deliverables) through custom pipeline stages. Vanilla HTML/CSS/JS frontend,
Supabase (Postgres + Auth) backend.

## Files

```
index.html          home / setup / board views (main app)
login.html           sign in
signup.html          create account
css/style.css        dark industrial theme
js/supabaseClient.js Supabase client config — put your project URL + anon key here
js/data.js           data access layer — every function returns {data, error}
js/auth.js           shared login/signup page logic
js/script.js         board app logic (state, rendering, drag/select/summary/members)
sql/schema.sql        tables + row-level-security policies
```

## Setup

1. Create a Supabase project.
2. SQL editor → run `sql/schema.sql` once, top to bottom.
3. Project Settings → API → copy the Project URL and anon public key into
   `js/supabaseClient.js`.
4. Auth → Providers → Email: leave "Confirm email" on or off, your call. If on,
   new signups land on a "check your email" screen instead of straight into the app.
5. Serve the folder over any static server (Supabase Auth needs http/https, not
   `file://`). `npx serve .` works fine for local testing.
6. Open `signup.html`, create an account, start a project.

## Role model

- **owner** — created the project. Only role that can invite/remove members,
  delete the project, or (per current policies) rename it alongside editors.
- **editor** — full read/write on stages, items, and progress.
- **viewer** — read-only; item fields and stage toggles render disabled.

Enforced by RLS in Postgres, not just hidden in the UI — a viewer's Supabase
session cannot write even by calling the API directly.

## Save model

Item field edits (name, assignee, due date) and stage-toggle clicks update
local state immediately and mark the board "Unsaved changes." Nothing hits the
network until **Save Progress** is clicked, which batches everything into a
handful of requests. Item creation/deletion, stage edits, and member changes
are immediate — those need a server-issued id to keep working (drag reorder,
checkboxes) so they can't be queued the same way.

## Known deliberate simplifications

- **Invite by email works even without an account now** (see below) — the
  earlier "must already have an account" limitation is closed.
- **Drag-to-reorder is now persisted** (previously display-only) — dropping
  an item writes its new `sort_order` to Supabase right away, so the order
  survives a refresh and syncs to other members. Only rows whose position
  actually changed get written.

## Invite-by-email before signup

`sql/migration_pending_invites.sql` adds a `pending_invites` table (owner-only
RLS) and extends `handle_new_user()` so that when someone signs up, any
pending invite matching their email is turned into a real `project_members`
row automatically, then cleared. Run this migration once, after the base
`schema.sql`, in the SQL editor.

Inviting an email with no account yet now queues a pending invite instead of
erroring — the Members panel shows it as "pending" with a Cancel option
(owner only). No action needed on your end when they sign up; the trigger
handles the attach.

## Activity log

`sql/migration_activity_log.sql` adds an `activity` table plus triggers on
`items`, `item_progress`, `stages`, and `project_members`. Every create,
delete, rename, stage toggle, and membership change gets logged automatically
at the database layer — the app never has to remember to log anything, and
bulk operations (multi-select check/uncheck, bulk delete) get one row per
affected item since triggers fire per-row. Run this migration once, after
`schema.sql`.

Only project members can read a project's `activity` rows (RLS); nothing
writes to the table except the trigger functions themselves. Open it from the
board toolbar → **Activity**.

Without this step, "Invite" only writes a database row — nothing lands in
anyone's inbox. `supabase/functions/send-invite/index.ts` is an Edge Function
that actually sends the email, via [Resend](https://resend.com) (free tier,
100 emails/day).

1. Install the Supabase CLI, log in, link this project:
   ```
   npm install -g supabase
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   ```
2. Sign up at resend.com, grab an API key.
3. Set secrets and deploy:
   ```
   supabase secrets set RESEND_API_KEY=re_xxxxxxxx
   supabase secrets set APP_URL=https://your-deployed-app-url.com
   supabase functions deploy send-invite
   ```
4. That's it — inviting someone now calls the function automatically
   (`js/data.js` → `sendInviteEmail`), which the Members panel fires
   right after saving the invite/member row.

**Sandbox limitation:** Resend's default `onboarding@resend.dev` sender only
delivers to the email address you signed up to Resend with, until you verify
your own domain in the Resend dashboard. For real multi-user invites, verify
a domain and swap the `from` address in `index.ts`.

Email failures don't block the invite — the invite/member row is saved either
way; only the email itself can fail, and the UI toasts that separately.

## Attachments (files + links)

`sql/migration_attachments.sql` adds an `attachments` table plus a private
Supabase **Storage** bucket (`attachments`), with RLS on both the table and
the storage objects — same owner/editor/viewer role model as everything
else. Run this migration once, after `schema.sql`.

- Each item card has a **Attachments** button opening a panel scoped to
  that item: upload a file, or paste a link with an optional label.
- Files are stored under `{project_id}/{item_id}/{filename}` in the bucket;
  the bucket is private, so viewing/downloading always goes through a
  short-lived signed URL requested at click time — nothing is world-readable.
- Viewers can see and open attachments but the upload/link/remove controls
  are hidden for them, same as the rest of the read-only rules.

## CSV import

Next to "+ Add item" is **Import CSV** — no migration needed, pure
client-side parsing plus one bulk insert. Expected header row (case-insensitive,
any order): `name, assignee, due_date, notes`. Only `name` is required; rows
missing it are skipped. `due_date` must be `YYYY-MM-DD` — anything else is
imported with no due date rather than rejecting the whole row. Handles quoted
fields with embedded commas, same as a normal spreadsheet export.

## Profile management

`sql/migration_profile.sql` adds an `avatar_url` column to `profiles` plus a
**public** Storage bucket (`avatars`) — profile pictures aren't sensitive, so
they're served straight from Supabase's public URL endpoint rather than
needing signed URLs. Only the owner of a `{user_id}/...` path can
upload/replace/delete their own avatar; anyone can view it. Run this
migration once, after `schema.sql`.

Click **Profile** on the home screen for:
- **Picture** — upload, replaces the previous one.
- **Name** — updates `profiles.full_name` everywhere it's shown (activity
  feed, members list).
- **Email** — uses Supabase Auth's built-in flow: a confirmation link goes to
  the *new* address, and nothing changes until it's clicked.
- **Password** — requires re-entering the current password first (re-auths
  against it before allowing the change), same security bar as most real
  account-settings pages.

**Not included:** deleting the account itself. That needs a service-role key
to actually remove an `auth.users` row, which should never live in
client-side code — would need its own Edge Function (same pattern as
`send-invite`) if you want it later.

## Home dashboard

No migration needed — two extra bulk reads on top of data already fetched
for the project grid. Above your project cards, Home now shows:
- **Aggregate stats** — active projects, total items, complete (with %),
  in progress, overdue, summed across every project you belong to.
- **7-day activity trend** — a small bar chart pulled straight from the
  `activity` table, one bar per day, showing how many logged events
  (item/stage/member changes) happened across all your projects.

Both queries batch by ID (`item_progress` for every item across every
project in one call, same for `activity`) rather than querying per project,
so opening Home doesn't get slower as you add more projects.

## Single-track vs multi-track projects

`sql/migration_track_mode.sql` adds `track_mode` ('single' | 'multiple',
default 'multiple') and `primary_item_id` to `projects`. Run once, after
`schema.sql`.

- **At setup**, pick "Just one" or "Multiple" — "Just one" auto-creates that
  single item for you, named after your singular label.
- **One track mode** hides "+ Add item", "Import CSV", and the search box
  — the board only ever shows that one item's stages/assignee/due date.
  Everything else (stages, attachments, activity, members) works exactly
  the same.
- **Switch anytime** via the toolbar's **🎚 Mode** button. Going multi → one
  while several items exist asks you to pick which one stays as "the"
  track — the rest aren't deleted, just hidden from the board until you
  switch back to multiple.
- If the one track ever gets deleted, "+ Add item" reappears automatically
  so you're not stuck with an empty board and no way to add one back.

## Light / dark theme

No migration, no data.js changes — pure CSS variables plus `localStorage`.
**🌙 Dark / ☀️ Light** toggle sits on the Home screen. A tiny inline script
in each page's `<head>` (index, login, signup) applies the saved preference
before first paint, so there's no flash of the wrong theme on load. Choosing
a theme on Home carries over to login/signup too, since it's the same
`localStorage` key everywhere.