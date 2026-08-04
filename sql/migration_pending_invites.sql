-- ============================================================
-- Migration: invite-by-email before signup
-- Run once in Supabase SQL editor, after the base schema.sql.
-- ============================================================

create table if not exists pending_invites (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  email        text not null,
  role         text not null check (role in ('editor','viewer')),
  invited_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  unique (project_id, email)
);

alter table pending_invites enable row level security;

-- only the project owner can see / create / cancel invites for their project
create policy "invites_select_owner" on pending_invites for select
  using (is_project_owner(project_id, auth.uid()));
create policy "invites_insert_owner" on pending_invites for insert
  with check (is_project_owner(project_id, auth.uid()));
create policy "invites_delete_owner" on pending_invites for delete
  using (is_project_owner(project_id, auth.uid()));

-- extend the existing signup trigger: on new auth.users row, also attach
-- any pending invites that match the new user's email, then clear them.
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;

  insert into project_members (project_id, user_id, role)
  select project_id, new.id, role
  from pending_invites
  where lower(email) = lower(new.email)
  on conflict (project_id, user_id) do nothing;

  delete from pending_invites where lower(email) = lower(new.email);

  return new;
end;
$$;
-- trigger on_auth_user_created already points at this function — no need to recreate it.
