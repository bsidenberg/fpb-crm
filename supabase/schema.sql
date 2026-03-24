-- FPB CRM Schema
-- Run this in Supabase: Dashboard > SQL Editor > New Query

-- Leads table
create table if not exists public.leads (
  id               uuid default gen_random_uuid() primary key,
  first_name       text not null,
  last_name        text not null,
  email            text,
  phone            text,
  company          text,
  city             text,
  zip              text,
  lead_source      text,
  stage            text not null default 'new'
                     check (stage in ('new','contacted','quote_sent','follow_up','won','lost')),
  estimated_value  numeric,
  barn_size        text,
  follow_up_date   date,
  temperature      text not null default 'warm'
                     check (temperature in ('cold','warm','hot')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Activities / notes table
create table if not exists public.activities (
  id          uuid default gen_random_uuid() primary key,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  type        text not null default 'note'
                check (type in ('note','call','email','visit','follow_up')),
  notes       text,
  scheduled_at  timestamptz,
  completed_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Auto-update updated_at on leads
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_updated_at
  before update on public.leads
  for each row execute function update_updated_at();

-- Row Level Security (enable after configuring auth if needed)
-- alter table public.leads enable row level security;
-- alter table public.activities enable row level security;

-- Indexes
create index if not exists leads_stage_idx on public.leads(stage);
create index if not exists leads_created_at_idx on public.leads(created_at desc);
create index if not exists activities_lead_id_idx on public.activities(lead_id);
create index if not exists activities_created_at_idx on public.activities(created_at desc);
