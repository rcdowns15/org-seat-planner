# Master Plan — Org Seat Planner

## North star
By **Monday 2026-11-16** (the hiring-manager interview), a public GitHub repo and a live Vercel demo
show a **thin slice through every layer** of a people-data operations system at a fictional company,
Second Republic Bank:
1. **Write-back tool:** an engineering leader drags a person to an open seat in another squad. The
   server validates the move, saves it with optimistic locking, and appends it to an audit trail.
2. **Workday pipeline:** a biweekly mock Workday report is validated, ingested and cleaned with dbt.
3. **Reconciliation:** dbt compares HRIS facts with the leaders' plan to produce headcount vs.
   plan, what changed since the last report, and exceptions to drive to zero.

The functionality is deliberately small enough for Rob to build and fully understand by Monday.
Each component is built the way the real system would be (server-side validation, version-checked
writes, append-only audit, a swappable ingest reader, layered and tested dbt models), so it's
obvious how it grows into live Workday API ingestion, self-serve leader workflows and
executive reporting. The specs for that growth (BR-05…BR-08) are in the repo as the roadmap.

## What a hiring manager should see in 5 minutes
1. **Live demo:** pick a leader, drag a person to an open seat in another squad, pick an effective
   date, save. Try a move outside the leader's org and see a clear error. Click "simulate another
   leader's edit", save again, and get a conflict with a refresh prompt. Open the seat's history.
   Open "Under the hood": the seat's `version` went up, here are the new audit rows, and here's the
   exact SQL the save ran. Then the reconciliation preset: after the 11-15 Workday report, a
   terminated worker still holds a seat, and here's what changed in the refresh.
2. **README as a case study:** problem → architecture → data model → how write-back stays correct →
   how the pipeline stays correct → what's tested → production mapping (Built / Planned) → roadmap.
3. **Repo hygiene:** CI on every PR, tests for every validation rule, the locking logic and the
   reconciliation rules, small PRs tied to little rocks, decisions logged with reasons.

## Principles
- **Thin slice through every layer, then depth.** One move end to end, one report end to end, and
  one reconciliation end to end beat a polished single layer.
- **Simple enough to explain, shaped like the real thing.** Conventional patterns, small files, no
  abstraction that wouldn't survive "walk me through this", but the seams sit where production
  would need them (reader interface, schemas per system, append-only audit).
- **Measure, don't vibe.** Every little rock has acceptance criteria you can show with a command,
  test, or query.
- **Deploy early.** Hello-world on Vercel + Neon on day 1.
- **Correctness lives on the server and in the database.** The UI is a convenience.
- **Mock data only.** Second Republic Bank is fictional. Nothing about any real employer or the
  interviewing company goes in this repo.
- **Honest docs.** Built and planned are labeled. "Here's the spec" is a fine interview answer;
  claiming unbuilt work is not.

## Timeline reality (read this first)
Today is Wed 2026-11-11 and the interview is Mon 2026-11-16: **four working days** (Thu–Sun).
Executors write the code. Rob's time goes into `rob`-owned setup, reviewing and merging PRs
(reviewing is how he learns the code), running orchestrator sessions, and rehearsing.

| | Little rocks | PRs to review | Rob-hours (est.) |
|---|---|---|---|
| Cut line (BR-01…BR-04 minus the post-interview items) | 27 (4 owned by Rob; +LR-03-06 D-034, +LR-02-10 split D-037) | 23 | ~20.25 h ≈ **~5 h/day for 4 days** |
| After the interview (rest of BR-02 and BR-04, BR-05…BR-08) | 19 | 18 | ~12 h |

Estimates: ~25 min per PR review, ~2.5 h of `rob` setup tasks, ~3 h of orchestrator and navigator
time, ~4–5 h of rehearsal and explainer study. **This is tight.** It fits only if Rob has about 5
hours a day (**Rob confirmed 5 h/day, 2026-11-11**), BR-02 and BR-03 run in parallel, and PRs are
reviewed the same day. If the schedule slips, drop items in this order (each is a small spec edit
for the navigator). Write-back extras go first and the pipeline goes last, because Workday
ingestion and reconciliation are the least replaceable part of the story for this role. The
write-back core (move, validation, locking, conflict) is never cut.
1. The "Last save: SQL executed" part of LR-02-08 (keep the preset queries)
2. LR-02-06 seat history panel
3. LR-03-05's Neon workflow (run the pipeline locally and against Neon from Rob's machine instead)
4. The `rpt_workday_changes` half of LR-03-04 (keep the exceptions report)

**Tripwire (D-034):** at Sat 11/14 18:00, if LR-02-08 or LR-03-04 isn't merged, item 1 drops
below the cut line automatically. This is the price of adding LR-03-06 with no swap.

### Day-by-day
| Day | Agents | Rob |
|---|---|---|
| Wed 11/11 (tonight) | — | LR-01-10 (Docker, long paths, pnpm); LR-01-01 (GitHub repo); confirm decisions |
| Thu 11/12 | BR-01: LR-01-02…04, 06…08 | LR-01-05 (Vercel + Neon), LR-01-09 (secrets, seed Neon); review ~6 PRs |
| Fri 11/13 | Thin slice LR-02-01…04 **in parallel with** LR-03-01, LR-03-02 | Review ~6 PRs; try a move locally |
| Sat 11/14 | LR-02-05, 06, 08, 10; LR-03-03…06; LR-04-01 | Review ~8 PRs; **18:00 tripwire check (D-034)** |
| Sun 11/15 | LR-04-02, LR-04-03 by 11:00. **Feature freeze at noon.** | LR-04-04 rehearsal; tag `v0.1-interview` |
| Mon 11/16 | — | Interview |

## Portfolio-ready cut line
**Before the interview (must):**
- BR-01: all (LR-01-01…09)
- BR-02: LR-02-01…06, LR-02-08 and LR-02-10 (board, move, validation, locking, conflict demo, history, SQL panel, effective-date ordering split from LR-02-03 per D-037)
- BR-03: all (LR-03-01…06): ingestion, staging, headcount vs. plan, changes, exceptions, `pnpm pipeline`, position-backfill fix (D-034)
- BR-04: LR-04-01…04 (demo reset, README, explainers, rehearsal)

**After the interview:** LR-02-07 (undo), LR-02-09 (audit log page), LR-04-05 (prod smoke workflow),
BR-05 (history, SCD2, daily facts), BR-06 (semantic layer), BR-07 (Workday API reader, TA and FP&A
reconciliation, exceptions UI, roles), BR-08 (dashboard).

## Big rocks
| ID | Big rock | Depends on | Exit criteria (summary) | Status | When |
|---|---|---|---|---|---|
| BR-01 | [Foundations](specs/BR-01-foundations.md) | — | App scaffold, CI, Postgres + migrations, deterministic seed + mock Workday reports, hello-world on Vercel + Neon | done (10/10 LRs; big-rock review 2026-11-12: pass, no P1) | Thu · cut line |
| BR-02 | [Seat board and write-back](specs/BR-02-seat-board-write-back.md) | BR-01 | Board, drag-and-drop move, server validation, optimistic locking, conflict demo, history, read-only SQL panel | in-progress (7/8 cut-line LRs done; LR-02-06 ready) | Fri–Sat · cut line (undo and audit page after) |
| BR-03 | [Workday ingestion and reconciliation](specs/BR-03-workday-ingestion-reconciliation.md) | BR-01 | Validated report ingest, dbt staging, headcount vs. plan, refresh changes, reconciliation exceptions, `pnpm pipeline` | in-progress (5/6 done; LR-03-05 ready) | Fri–Sat · cut line |
| BR-04 | [Demo-ready: README, explainers, rehearsal](specs/BR-04-demo-ready.md) | BR-02, BR-03 | Demo reset, README case study, two explainers, rehearsed five-minute demo | todo (LR-04-01 ready) | Sat–Sun · cut line (prod smoke after) |
| BR-05 | [Pipeline depth: history, SCD2, daily headcount](specs/BR-05-pipeline-history.md) | BR-03 | 18 months of reports, SCD2 from extracts, daily seat and headcount facts | todo | After |
| BR-06 | [Semantic layer](specs/BR-06-semantic-layer.md) | BR-05 | MetricFlow models, six metrics with point-in-time handling, CI validation | todo | After |
| BR-07 | [Workday API path, multi-source reconciliation](specs/BR-07-workday-api-multi-source.md) | BR-03 | API reader, TA + FP&A feeds, exceptions UI with resolution, DB roles, scheduled pipeline | todo | After |
| BR-08 | [Headcount dashboard](specs/BR-08-dashboard.md) | BR-05, BR-06 | Headcount, open seats, fill rate, plan vs. actual from marts; README v2 | todo | After |

## Sequencing
```
              ┌─▶ BR-02 Write-back ──────────────┐
BR-01 Found. ─┤                                  ├─▶ BR-04 Demo-ready ══ CUT LINE (Sun 11/15 noon) ══
              └─▶ BR-03 Ingestion + reconcile ───┘
                          │
                          ├─▶ BR-05 History ─▶ BR-06 Semantic layer ─▶ BR-08 Dashboard
                          └─▶ BR-07 Workday API + multi-source
```
BR-02 and BR-03 share only BR-01 and the SQL panel presets (LR-03-05 waits for LR-02-08), so they
run in parallel. The write-back thin slice is LR-02-01…04; the pipeline thin slice is LR-03-01…04.

## Review checkpoints
- Before BR-01: Rob confirms the `proposed` decisions in `DECISIONS.md` (or changes them).
- Every little rock: reviewer agent before its PR; Rob merges every PR. Agents never merge.
- Every big rock: reviewer in big-rock mode once its little rocks are merged.
- Sun 11/15 noon: feature freeze. After that, only docs fixes and bug fixes found in rehearsal.
