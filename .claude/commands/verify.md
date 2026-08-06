---
description: Run the full verification loop (lint, tests, build) and fix what breaks
---

Run the verification loop for this repo and drive it to green:

1. `npm run lint` — must exit 0 (warnings are tolerated, errors are not)
2. `npm test` — all vitest suites must pass
3. `npm run build` — must complete

If any step fails, fix the cause and re-run the loop from the top. Do not
suppress rules or skip tests to get to green — fix the underlying issue, or
stop and report if the fix would change intended behavior. When all three pass,
summarize what was fixed in one or two lines.
