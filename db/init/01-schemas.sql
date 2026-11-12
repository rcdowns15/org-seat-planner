-- Local convenience only: runs on first start of the Docker volume.
-- LR-01-06's first migration also creates these (IF NOT EXISTS), so Neon needs no init script.
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS workday;
CREATE SCHEMA IF NOT EXISTS analytics;
