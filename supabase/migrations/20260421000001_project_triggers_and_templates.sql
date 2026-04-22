-- Migration: project_triggers_and_templates
-- (1) updated_at auto-stamp trigger on projects
-- (2) seed_project_checklist() function for kit/turnkey checklists + permitting

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_projects_updated_at on projects;

create trigger set_projects_updated_at
  before update on projects
  for each row
  execute function set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- (2) Checklist seed function
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function seed_project_checklist(
  p_project_id   uuid,
  p_project_type text
)
  returns void
  language plpgsql
as $$
begin

  -- Idempotency guard: if any checklist rows already exist for this project, bail out
  if exists (
    select 1 from project_checklist_items
    where project_id = p_project_id
    limit 1
  ) then
    return;
  end if;

  -- ── Kit checklist ─────────────────────────────────────────────
  if p_project_type = 'kit' then
    insert into project_checklist_items (project_id, category, field_type, position, label) values
      (p_project_id, 'checklist', 'checkbox',  1, 'Deposit collected'),
      (p_project_id, 'checklist', 'checkbox',  2, 'Engineered drawings signed off by customer'),
      (p_project_id, 'checklist', 'checkbox',  3, 'Materials ordered (POs issued)'),
      (p_project_id, 'checklist', 'checkbox',  4, 'Materials staged at Causey Rd'),
      (p_project_id, 'checklist', 'checkbox',  5, 'Delivery scheduled with customer'),
      (p_project_id, 'checklist', 'checkbox',  6, 'Delivered to site'),
      (p_project_id, 'checklist', 'checkbox',  7, 'Customer confirmed receipt / punch items resolved'),
      (p_project_id, 'checklist', 'checkbox',  8, 'Project closed');

  -- ── Turnkey checklist ─────────────────────────────────────────
  elsif p_project_type = 'turnkey' then
    insert into project_checklist_items (project_id, category, field_type, position, label) values
      (p_project_id, 'checklist', 'checkbox',  1, 'Deposit collected'),
      (p_project_id, 'checklist', 'checkbox',  2, 'Engineered drawings signed off by customer'),
      (p_project_id, 'checklist', 'checkbox',  3, 'Materials ordered (POs issued)'),
      (p_project_id, 'checklist', 'checkbox',  4, 'Materials staged at Causey Rd'),
      (p_project_id, 'checklist', 'checkbox',  5, 'Build crew scheduled'),
      (p_project_id, 'checklist', 'checkbox',  6, 'Site prep / slab ready'),
      (p_project_id, 'checklist', 'checkbox',  7, 'Materials delivered to site'),
      (p_project_id, 'checklist', 'checkbox',  8, 'Framing complete'),
      (p_project_id, 'checklist', 'checkbox',  9, 'Framing inspection passed'),
      (p_project_id, 'checklist', 'checkbox', 10, 'Dry-in complete'),
      (p_project_id, 'checklist', 'checkbox', 11, 'Final walkthrough with customer'),
      (p_project_id, 'checklist', 'checkbox', 12, 'Punch list cleared / project closed');

  else
    raise exception 'seed_project_checklist: unknown project_type "%". Expected ''kit'' or ''turnkey''.', p_project_type;
  end if;

  -- ── Permitting items (same for both types) ────────────────────
  insert into project_checklist_items (project_id, category, field_type, position, label) values
    (p_project_id, 'permitting', 'data',     1, 'County'),
    (p_project_id, 'permitting', 'data',     2, 'Wind zone'),
    (p_project_id, 'permitting', 'data',     3, 'Permit #'),
    (p_project_id, 'permitting', 'data',     4, 'Permit submitted date'),
    (p_project_id, 'permitting', 'data',     5, 'Permit approved date'),
    (p_project_id, 'permitting', 'checkbox', 6, 'Footer inspection'),
    (p_project_id, 'permitting', 'checkbox', 7, 'Framing inspection'),
    (p_project_id, 'permitting', 'checkbox', 8, 'Final / CO');

end;
$$;
