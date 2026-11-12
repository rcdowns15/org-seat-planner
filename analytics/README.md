# analytics/ (dbt)

dbt project for Org Seat Planner. Layers: `staging` (1:1 with sources: rename, cast, clean) →
`intermediate` → `marts`. Schemas: `analytics_staging`, `analytics_intermediate`, `analytics`
(see `macros/generate_schema_name.sql`). dbt only reads `app` and `workday`.

Currently built: sources for `workday.*` and `app.*`, `stg_workday__worker_report` (cleans the
messy Workday report rows), one `stg_app__*` model per app table, and a singular test proving
every raw report row maps to exactly one staged row.

## Run it

From the repo root, start Postgres, migrate and seed (`docker compose up -d db`, `pnpm db:migrate`,
`pnpm db:seed`), then:

```sh
cd analytics
uv sync                 # Python from .python-version; dbt versions pinned in pyproject.toml, locked in uv.lock
uv run dbt deps         # installs dbt_utils (pinned in packages.yml)
uv run dbt build        # build and test everything
```

Credentials come from `DBT_HOST`, `DBT_PORT`, `DBT_USER`, `DBT_PASSWORD`, `DBT_DBNAME` (and
optional `DBT_SSLMODE`, default `prefer`; use `require` on Neon). `profiles.yml` holds no secrets.
The local defaults are in `.env.example`; export them in your shell first (dbt does not read `.env`
files).
