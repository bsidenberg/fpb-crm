# FPB CRM

Internal lead-pipeline CRM for Florida Pole Barn: Kanban board with realtime
sync and drag-and-drop stages, lead scoring, follow-up tracking, a radius-
filtered map, project management for won jobs, and analytics.

**Stack:** React 19 · Vite · Supabase (Postgres, Realtime, Edge Functions) ·
Google Maps · Vercel

## Development

```sh
npm install
npm run dev      # local dev server
npm run lint     # eslint
npm test         # vitest unit tests
npm run build    # production build
```

Required env (`.env`, not committed):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GOOGLE_MAPS_API_KEY=   # browser Maps JS key (Map page only)
```

Server-side secrets (`GOOGLE_MAPS_SERVER_KEY`, `RESEND_API_KEY`, service-role
keys) live in Supabase edge-function config, never in VITE_ vars.

## Repo map

- `src/pages/` — Board (Kanban), LeadDetail, FollowUps, Projects, Map, Analytics
- `src/context/LeadsProvider.jsx` — shared leads cache + realtime subscription
- `src/lib/`, `src/utils/` — pure logic (stages, dates, distance, scoring),
  unit-tested with colocated `*.test.js`
- `supabase/migrations/` — schema source of truth
- `supabase/functions/` — Deno edge functions (geocoding, email digests)
- `CLAUDE.md` — working conventions, invariants, and known debt

CI runs lint, tests, and build on every push and PR
(`.github/workflows/ci.yml`).
