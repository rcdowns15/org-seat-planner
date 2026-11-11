# Master Plan — Org Seat Planner

## North star
What exists, for whom, when this succeeds. One short paragraph.

## What a hiring manager should see in 5 minutes
1. …
2. A README case study: problem → architecture → data model → measurement → tradeoffs.
3. Clean repo hygiene: CI, tests, small commits tied to issues.

## Principles
- **Thin slice first.** Get a small sample flowing end to end before scaling.
- **Measure, don't vibe.** Quality claims are numbers in the repo.
- (project-specific principles)

## Portfolio-ready cut line
What "portfolio-ready" means, and the explicit list of little rocks on the cut line. Everything
after it improves the project but must not block using it.

## Big rocks
| ID | Big rock | Depends on | Exit criteria (summary) | Status |
|---|---|---|---|---|
| BR-01 | [Foundation](specs/BR-01-foundation.md) | — | Repo, CI, checks green on fixtures | todo |

## Sequencing
```
BR-01 ─▶ BR-02 ─▶ …
```

## Review checkpoints
- Before BR-01: plan review (gstack `plan-ceo-review` / `plan-eng-review`).
- Every little rock: reviewer agent before its PR; Rob merges every PR. Agents never merge.
- Every big rock: reviewer in big-rock mode once its little rocks are merged.
