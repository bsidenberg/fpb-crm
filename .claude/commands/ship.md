---
description: Verify, review, commit, and push the current changes
---

Ship the current working-tree changes:

1. Run the full verification loop: `npm run lint`, `npm test`, `npm run build`.
   Fix failures before proceeding — never commit red.
2. Launch the `code-reviewer` agent on the diff. Apply fixes for anything it
   flags as FIX FIRST, then re-run step 1.
3. Write tests for any new pure logic (lib/, utils/) touched by this change if
   none exist yet.
4. Commit with a clear conventional message (feat/fix/perf/chore scope), and
   push to the current branch with `git push -u origin <branch>`.

$ARGUMENTS
