# BR-01 — Foundation

**Status:** todo · **Depends on:** — · **Milestone:** M1

## Goal
The repo builds, tests, and lints green locally and in CI, and the planning docs describe the project.

## Why it matters
Every later little rock leans on these checks; the reviewer and CI can only enforce what exists.

## Scope
In: scaffold verification, CI on pull requests, project rules in `CLAUDE.md`, fixtures for offline tests.
Out: product features.

## Key risks / open questions
- …

## Exit criteria
- Every command under "Checks" in `CLAUDE.md` passes locally and in CI on `main`.
- `CLAUDE.md` "Project rules" and `docs/MASTER_PLAN.md` are filled in for this project.

## Little rocks

### LR-01-01 · Verify scaffold and CI · status: todo · depends: — · owner: agent
Confirm the harness scaffold works end to end and CI runs on pull requests.
- [ ] Every command under "Checks" in `CLAUDE.md` passes on a clean clone
- [ ] CI runs on a PR and passes; the README quickstart works as written

### LR-01-02 · Project rules and plan · status: todo · depends: — · owner: rob
Fill in the north star, cut line, big rocks, and "Project rules" with the navigator.
- [ ] `docs/MASTER_PLAN.md` has a north star, a cut line, and at least three big rocks with specs
- [ ] `CLAUDE.md` "Project rules" and "Domain edge cases" list this project's rules
