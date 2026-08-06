# FPB CRM

Lead-pipeline CRM for Florida Pole Barn. React 19 + Vite + Tailwind 4 (mostly
inline styles in practice) + Supabase (Postgres, realtime, edge functions).
Deployed on Vercel at fpbcrm-alpha.vercel.app.

## Commands

- `npm run dev` — Vite dev server
- `npm run lint` — ESLint; errors block, warnings tolerated
- `npm test` — Vitest unit tests (pure logic in lib/ and utils/)
- `npm run build` — production build (also the fastest full type/syntax check)

Before committing: run all three. `/verify` runs the loop; `/ship` runs it plus
code review, commit, and push.

## Architecture

- `src/App.jsx` — auth gate (Supabase password login), then routes under
  `LeadsProvider` + `Layout`: `/` Board, `leads/:id`, `followups`, `projects`,
  `projects/:id`, `map`, `analytics`.
- `src/context/LeadsProvider.jsx` — the only shared cache. Fetches all leads +
  activity counts, computes scores client-side, subscribes to realtime on
  `leads` (100ms debounce, queues events during drag, falls back to 30s polling
  on channel error). Only Board consumes it; other pages fetch directly.
- `src/components/KanbanBoard.jsx` — optimistic drag-and-drop stage changes
  with rollback on failure. Columns are virtualized (@tanstack/react-virtual);
  LeadCard and KanbanColumn are memoized.
- `src/lib/` — pure helpers: `stages.js` (stage/source/tag constants),
  `followup.js` (local-date strings), `haversine.js`, `geocode.js` (calls the
  geocode edge function, never Google directly), `scoreLeads.js` in utils/.
- `supabase/functions/` — Deno edge functions: `geocode` (cached Google
  geocoding), `daily-followup-digest` and `quote-followup-check` (Resend
  emails).

## Rules

- **Migrations are truth, schema.sql is stale.** Several live columns exist in
  neither file (added via dashboard). Verify against the live DB (Supabase MCP
  `list_tables`) before writing queries.
- **Stage ids live in two places**: `src/lib/stages.js` AND the
  `leads_stage_check` constraint (latest migration). Changing stages requires
  both, plus a check of the edge functions —
  `quote-followup-check` still references pre-rename stage names (known bug).
- **Dates**: follow-up dates are local-time `YYYY-MM-DD` strings compared
  lexically (`lib/followup.js`). Never mix with `new Date('YYYY-MM-DD')`
  (parses UTC) without intent.
- **Don't break the board's perf scaffolding**: no new inline object/array/
  function props to KanbanColumn/LeadCard; keep per-stage arrays referentially
  stable.
- **Realtime + optimistic state**: optimistic rows use `tmp_` id prefixes and
  realtime payloads dedup against them. Preserve that contract when touching
  LeadsProvider, KanbanBoard, or LeadDetail activities.
- Pure logic goes in `src/lib/` or `src/utils/` with a colocated `*.test.js`.
  UI components are not unit-tested; keep logic out of them.
- Env: browser uses `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_GOOGLE_MAPS_API_KEY` (Maps JS only). Server/edge secrets:
  `GOOGLE_MAPS_SERVER_KEY`, `RESEND_API_KEY`, service-role keys. Never put
  server keys in VITE_ vars.

## Workflow

Plan → implement → verify (`/verify`) → review (code-reviewer agent) → commit.
For multi-file features, use plan mode first. For risky refactors
(LeadsProvider, KanbanBoard), state the invariants you're preserving before
editing. CI (.github/workflows/ci.yml) runs lint + test + build on every push
and PR; keep it green.

## Known debt (do not "fix" casually — each is a scoped task)

- `react-hooks/set-state-in-effect` downgraded to warn (~10 sites to refactor).
- RLS: `leads`/`activities` have RLS off; other tables have allow-all policies.
- `quote_sent_at` is set optimistically in KanbanBoard but never persisted, so
  `quote-followup-check` has no reliable input (and queries old stage names).
- Single 1.26MB JS chunk — needs route-level code splitting.
- `LeadDetail.jsx` is 1331 lines; split before adding features there.
- `geocodeLead` hardcodes state "FL".
