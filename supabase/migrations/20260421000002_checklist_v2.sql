-- Migration: checklist_v2
-- (A) Add status column
-- (B) Add parent_id self-referencing FK + index
-- (C) Extend field_type check constraint to allow 'date'
-- (D) Drop all existing checklist rows (test data only)
-- (E) Rewrite seed_project_checklist() with new templates
-- (F) Reseed existing test project

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) status column
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE project_checklist_items
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'complete', 'not_applicable'));


-- ─────────────────────────────────────────────────────────────────────────────
-- (B) parent_id self-referencing FK
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE project_checklist_items
  ADD COLUMN parent_id uuid REFERENCES project_checklist_items(id) ON DELETE CASCADE;

CREATE INDEX project_checklist_items_parent_id_idx
  ON project_checklist_items(parent_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- (C) Extend field_type check constraint
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE project_checklist_items
  DROP CONSTRAINT IF EXISTS project_checklist_items_field_type_check;

ALTER TABLE project_checklist_items
  ADD CONSTRAINT project_checklist_items_field_type_check
  CHECK (field_type IN ('checkbox', 'data', 'date'));


-- ─────────────────────────────────────────────────────────────────────────────
-- (D) Drop all existing checklist items (test data only — safe to wipe)
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM project_checklist_items;


-- ─────────────────────────────────────────────────────────────────────────────
-- (E) Rewrite seed_project_checklist()
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION seed_project_checklist(
  p_project_id   uuid,
  p_project_type text
)
  RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  v_bldgdept_id     uuid;
  v_siteprep_id     uuid;
  v_permitsupport_id uuid;
BEGIN

  -- Idempotency guard: bail out if rows already exist for this project
  IF EXISTS (
    SELECT 1 FROM project_checklist_items
    WHERE project_id = p_project_id
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  IF p_project_type NOT IN ('kit', 'turnkey') THEN
    RAISE EXCEPTION 'seed_project_checklist: unknown project_type "%". Expected ''kit'' or ''turnkey''.', p_project_type;
  END IF;

  -- ── Turnkey checklist ─────────────────────────────────────────────────────
  IF p_project_type = 'turnkey' THEN

    -- pos 1: no parent
    INSERT INTO project_checklist_items (project_id, category, field_type, position, label)
      VALUES (p_project_id, 'checklist', 'checkbox', 1, 'Deposit');

    -- pos 2: parent — capture id for its children (3, 4)
    INSERT INTO project_checklist_items (project_id, category, field_type, position, label)
      VALUES (p_project_id, 'checklist', 'checkbox', 2, 'Are setup with building department')
      RETURNING id INTO v_bldgdept_id;

    -- pos 3, 4: children of pos 2
    INSERT INTO project_checklist_items (project_id, category, field_type, position, label, parent_id) VALUES
      (p_project_id, 'checklist', 'checkbox', 3, 'Insurance and all Bunker docs submitted', v_bldgdept_id),
      (p_project_id, 'checklist', 'checkbox', 4, 'PP inspector docs submitted',              v_bldgdept_id);

    -- pos 5–10: no parent
    INSERT INTO project_checklist_items (project_id, category, field_type, position, label) VALUES
      (p_project_id, 'checklist', 'checkbox', 5,  'Order plans'),
      (p_project_id, 'checklist', 'checkbox', 6,  'Develop site plan'),
      (p_project_id, 'checklist', 'checkbox', 7,  'Get all docs reviewed by inspector'),
      (p_project_id, 'checklist', 'checkbox', 8,  'Submitted to permit tech / building department'),
      (p_project_id, 'checklist', 'checkbox', 9,  'Daily check-in with permit tech'),
      (p_project_id, 'checklist', 'date',     10, 'Communicate with customer');

    -- pos 11: parent — capture id for its children (12, 13)
    INSERT INTO project_checklist_items (project_id, category, field_type, position, label)
      VALUES (p_project_id, 'checklist', 'checkbox', 11, 'Site prep needed')
      RETURNING id INTO v_siteprep_id;

    -- pos 12, 13: children of pos 11
    INSERT INTO project_checklist_items (project_id, category, field_type, position, label, parent_id) VALUES
      (p_project_id, 'checklist', 'checkbox', 12, 'Fill dirt ordered',    v_siteprep_id),
      (p_project_id, 'checklist', 'checkbox', 13, 'Site prep scheduled',  v_siteprep_id);

    -- pos 14–23: no parent
    INSERT INTO project_checklist_items (project_id, category, field_type, position, label) VALUES
      (p_project_id, 'checklist', 'checkbox', 14, 'Get PO ready for submittal to kits'),
      (p_project_id, 'checklist', 'checkbox', 15, 'Permit acquired'),
      (p_project_id, 'checklist', 'date',     16, 'Materials deposit invoice sent'),
      (p_project_id, 'checklist', 'checkbox', 17, 'Materials deposit received'),
      (p_project_id, 'checklist', 'checkbox', 18, 'Full PO submitted to kits'),
      (p_project_id, 'checklist', 'checkbox', 19, 'Schedule delivery with kits'),
      (p_project_id, 'checklist', 'checkbox', 20, 'Communicate and coordinate with customer'),
      (p_project_id, 'checklist', 'checkbox', 21, 'Schedule and order concrete'),
      (p_project_id, 'checklist', 'date',     22, 'Off-load delivery'),
      (p_project_id, 'checklist', 'checkbox', 23, 'Project start');

  -- ── Kit checklist ─────────────────────────────────────────────────────────
  ELSIF p_project_type = 'kit' THEN

    -- pos 1, 2: no parent
    INSERT INTO project_checklist_items (project_id, category, field_type, position, label) VALUES
      (p_project_id, 'checklist', 'checkbox', 1, 'Deposit'),
      (p_project_id, 'checklist', 'checkbox', 2, 'Order plans');

    -- pos 3: parent — capture id for its children (4, 5)
    INSERT INTO project_checklist_items (project_id, category, field_type, position, label)
      VALUES (p_project_id, 'checklist', 'checkbox', 3, 'Permit support for customer')
      RETURNING id INTO v_permitsupport_id;

    -- pos 4, 5: children of pos 3
    INSERT INTO project_checklist_items (project_id, category, field_type, position, label, parent_id) VALUES
      (p_project_id, 'checklist', 'checkbox', 4, 'Send stamped drawings to customer',       v_permitsupport_id),
      (p_project_id, 'checklist', 'checkbox', 5, 'Answer building dept questions as needed', v_permitsupport_id);

    -- pos 6–15: no parent
    INSERT INTO project_checklist_items (project_id, category, field_type, position, label) VALUES
      (p_project_id, 'checklist', 'checkbox', 6,  'Develop site plan'),
      (p_project_id, 'checklist', 'date',     7,  'Materials deposit invoice sent'),
      (p_project_id, 'checklist', 'checkbox', 8,  'Materials deposit received'),
      (p_project_id, 'checklist', 'checkbox', 9,  'Full PO submitted to kits'),
      (p_project_id, 'checklist', 'checkbox', 10, 'Schedule delivery with kits'),
      (p_project_id, 'checklist', 'date',     11, 'Communicate and coordinate with customer'),
      (p_project_id, 'checklist', 'date',     12, 'Confirm delivery date with customer'),
      (p_project_id, 'checklist', 'date',     13, 'Off-load delivery'),
      (p_project_id, 'checklist', 'checkbox', 14, 'Post-delivery customer check-in'),
      (p_project_id, 'checklist', 'checkbox', 15, 'Project closed');

  END IF;

  -- ── Permitting items — unchanged, same for both types ─────────────────────
  INSERT INTO project_checklist_items (project_id, category, field_type, position, label) VALUES
    (p_project_id, 'permitting', 'data',     1, 'County'),
    (p_project_id, 'permitting', 'data',     2, 'Wind zone'),
    (p_project_id, 'permitting', 'data',     3, 'Permit #'),
    (p_project_id, 'permitting', 'data',     4, 'Permit submitted date'),
    (p_project_id, 'permitting', 'data',     5, 'Permit approved date'),
    (p_project_id, 'permitting', 'checkbox', 6, 'Footer inspection'),
    (p_project_id, 'permitting', 'checkbox', 7, 'Framing inspection'),
    (p_project_id, 'permitting', 'checkbox', 8, 'Final / CO');

END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- (F) Reseed existing test project
-- ─────────────────────────────────────────────────────────────────────────────

SELECT seed_project_checklist(id, project_type)
FROM projects
WHERE name = 'Test Detail';
