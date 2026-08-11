-- ============================================================
-- Migration: single-track vs multi-track project mode
-- Run once in Supabase SQL editor, after schema.sql.
-- ============================================================

alter table projects add column if not exists track_mode text not null default 'multiple'
  check (track_mode in ('single', 'multiple'));

-- which item is "the" track when track_mode = 'single'. on delete set null
-- so removing that item never leaves a dangling reference — the app falls
-- back to showing nothing selected rather than erroring.
alter table projects add column if not exists primary_item_id uuid references items(id) on delete set null;
