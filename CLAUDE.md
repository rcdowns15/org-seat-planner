# Org Seat Planner — repo guide for every agent

A portfolio demo where engineering leaders edit org and seat data in a write-back app, a dbt pipeline models it, and a semantic layer serves consistent headcount metrics. Fictional company (Northwind Financial), mock data only.

## How work is organized
- `docs/MASTER_PLAN.md`: goal, portfolio-ready cut line, big rocks (BR), sequencing, review checkpoints, status rollup. Source of truth for priorities.
- `docs/specs/BR-XX-*.md`: one spec per big rock. Each contains its little rocks (LR) as issues with acceptance criteria. New specs and little rocks start from `docs/templates/`.
- `docs/PROGRESS.md`: "Where we stand" state block plus a dated log of what moved. Navigator owns it; the orchestrator adds one line per completed little rock.
- `docs/DECISIONS.md`: architecture and scope decisions with the why. Navigator owns it.
- `docs/PARKING_LOT.md`: good ideas that aren't in the plan. Navigator triages Rob's new ideas into a spec, the parking lot, or nowhere.

Little rock IDs look like `LR-02-03` (big rock 02, little rock 03); big rocks are `BR-02`. Reference them in branch names, commits, and PR titles.

## Agent roles
| Role | Runs as | Talks to | Does |
|---|---|---|---|
| navigator | Main session (`claude --agent navigator`) | Rob, orchestrator (through Rob) | Thinks with Rob, level-sets progress vs. goals, edits `docs/`, hands ready work to the orchestrator as a written brief that Rob pastes in. Writes no product code. |
| orchestrator | Top-level session (`claude --agent orchestrator`) | Rob (who relays the navigator's briefs and reports), executors, reviewer | Turns issues into a dispatch plan, spawns executors, verifies results, has them reviewed, opens PRs for Rob, updates issue status. |
| executor | Subagent spawned by orchestrator or Rob (`@agent-executor`) | whoever spawned it | Implements exactly one little rock in an isolated worktree, tests it, commits, reports. |
| reviewer | Subagent spawned by orchestrator | orchestrator | Read-only, independent review: every little rock before its PR opens, and each big rock once its little rocks are merged. Ranks findings P1 (blocks) / P2 (fix or waive) / P3 (note). |

## Models
Pinned so behavior doesn't drift between sessions; upgrade on purpose and log it in `docs/DECISIONS.md`.
- Main sessions (including gstack reviews): `claude-opus-5-5`, the default in `.claude/settings.json`.
- navigator, orchestrator and reviewer: `claude-opus-5-5`. executor: `claude-sonnet-5-5` by default. A little rock whose header says `executor model: opus` gets an Opus executor.
- Codex outside voice for gstack reviews: `gpt-6-luna` (`GSTACK_CODEX_MODEL` in `.claude/settings.json`). Pipe the prompt on stdin (`codex exec -`).

## Checkpoints and state
The "Where we stand" block at the top of `docs/PROGRESS.md` is the project's state file. Its fixed fields are: last updated, milestone, in flight, blocked, waiting on Rob, and next. Any session that changes plan state rewrites that block in place, adds a dated log line, and commits before ending. The navigator owns the block; the orchestrator updates it after each merged little rock. Start every session by reading it.

## Status values
`todo` → `ready` (deps met, criteria clear) → `in-progress` → `review` (PR open, awaiting Rob) → `done` (PR merged). Also `blocked` (say why) and `parked` (dropped from the plan; say why).

## Changing the plan
Plans change. Scale the paperwork to the size of the change:
- **Small** (tweak acceptance criteria, reorder little rocks, split a little rock): edit the spec and add a line to `docs/PROGRESS.md`.
- **Medium** (add or drop a little rock, swap a tool, park something): do the small steps, plus add a `docs/DECISIONS.md` entry. Dropped work gets status `parked`. Never delete it.
- **Big** (add or cut a big rock, change the north star or the portfolio-ready cut line): do the medium steps, plus update the big rocks table and sequencing in `docs/MASTER_PLAN.md`, and state the timeline impact.

Rules:
- **In-flight work on a changed item:** the orchestrator either finishes the current little rock and stops, or abandons the branch unmerged. No half-merged work.
- **Superseded decisions** are marked `superseded` (pointing to the decision that replaces them). Never erase them.
- **Commit the doc changes** after every plan change.

## Checks
Every little rock ends with all of these passing. Agents read this list instead of hardcoding it.
- (add this project's lint and test commands)

## Engineering conventions
- Secrets only in `.env` (gitignored). Never commit API keys or personal exports.
- Branch: `lr/LR-02-03-short-slug`; every commit message starts with the LR ID.
- **PR mode (on):** each verified and reviewed little rock becomes a GitHub PR titled with its LR ID, whose body carries the acceptance-criteria evidence and every reviewer finding with its disposition. Rob reviews and merges; agents never merge to `main`. A little rock is `review` while its PR is open and `done` once merged.

## Project rules
The reviewer checks every one of these on every little rock. Add a rule when a decision creates
one, and cite the decision ID. Domain edge cases worth testing also go here.
- No string-built SQL; queries use bound parameters.
- No secrets or keys in code or fixtures.
- (add project rules here, e.g. "every outbound fetch goes through `safe_fetch()` (D-0XX)")

### Domain edge cases
- (e.g. placeholder dates, zero/NULL coordinates, duplicate source IDs)
