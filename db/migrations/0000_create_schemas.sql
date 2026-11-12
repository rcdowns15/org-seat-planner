-- Custom migration (hand-written). Creates the three schemas so a brand-new database (Neon) needs
-- no manual setup. IF NOT EXISTS because the local Docker volume's init script
-- (db/init/01-schemas.sql) already created them. dbt creates its own analytics_* schemas.
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS workday;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS analytics;
