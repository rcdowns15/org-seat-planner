# Org Seat Planner

A portfolio demo where engineering leaders edit org and seat data in a write-back app, a dbt pipeline models it, and a semantic layer serves consistent headcount metrics. Fictional company (Northwind Financial), mock data only.

> Work in progress. See `docs/MASTER_PLAN.md` for scope and status.

## Working in this repo with Claude Code
- Talk through progress and ideas: `claude --agent navigator`
- Run a navigator brief: `claude --agent orchestrator`, then paste the brief
- Do a specific little rock directly: in a normal `claude` session, `@agent-executor do LR-01-01`
- Planning docs live in `docs/`; agent definitions in `.claude/agents/`.
- Scaffolded from the `code/` harness template; `.copier-answers.yml` records the version.
