-- Migration: create_projects
-- Creates four tables for the project management feature:
--   projects, project_hit_list, project_updates, project_checklist_items

-- ─────────────────────────────────────────────────────────────────────────────
-- projects
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists projects (
  id               uuid          primary key default gen_random_uuid(),
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),
  lead_id          uuid          references leads(id) on delete set null,
  name             text          not null,
  project_type     text          not null check (project_type in ('kit', 'turnkey')),
  status           text          not null default 'planning'
                                 check (status in ('planning', 'permitting', 'materials', 'build',
                                                   'punch_list', 'closed_won', 'on_hold', 'cancelled')),
  customer_name    text,
  customer_email   text,
  customer_phone   text,
  site_address     text,
  site_city        text,
  site_county      text,
  contract_amount  numeric(10,2),
  target_close_date date,
  building_size    text,
  notes            text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- project_hit_list
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists project_hit_list (
  id           uuid        primary key default gen_random_uuid(),
  project_id   uuid        not null references projects(id) on delete cascade,
  created_at   timestamptz not null default now(),
  position     integer     not null default 0,
  title        text        not null,
  note         text,
  assignee     text,
  due_date     date,
  priority     text        not null default 'normal'
               check (priority in ('blocking', 'normal', 'waiting')),
  completed_at timestamptz
);

-- ─────────────────────────────────────────────────────────────────────────────
-- project_updates
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists project_updates (
  id           uuid        primary key default gen_random_uuid(),
  project_id   uuid        not null references projects(id) on delete cascade,
  created_at   timestamptz not null default now(),
  author       text,
  body         text        not null,
  update_type  text        not null default 'note'
               check (update_type in ('note', 'status_change', 'customer_comm', 'vendor_comm'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- project_checklist_items
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists project_checklist_items (
  id           uuid        primary key default gen_random_uuid(),
  project_id   uuid        not null references projects(id) on delete cascade,
  created_at   timestamptz not null default now(),
  category     text        not null check (category in ('checklist', 'permitting')),
  position     integer     not null default 0,
  label        text        not null,
  completed_at timestamptz,
  value        text,
  field_type   text        not null default 'checkbox'
               check (field_type in ('checkbox', 'data'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists projects_status_idx
  on projects (status);

create index if not exists projects_lead_id_idx
  on projects (lead_id);

create index if not exists project_hit_list_project_position_idx
  on project_hit_list (project_id, position);

create index if not exists project_updates_project_created_idx
  on project_updates (project_id, created_at desc);

create index if not exists project_checklist_items_project_category_position_idx
  on project_checklist_items (project_id, category, position);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
alter table projects                enable row level security;
alter table project_hit_list        enable row level security;
alter table project_updates         enable row level security;
alter table project_checklist_items enable row level security;

-- Allow all (matches existing leads/activities pattern)
create policy "Allow all" on projects
  for all using (true) with check (true);

create policy "Allow all" on project_hit_list
  for all using (true) with check (true);

create policy "Allow all" on project_updates
  for all using (true) with check (true);

create policy "Allow all" on project_checklist_items
  for all using (true) with check (true);
