CREATE TABLE "app"."demo_reset_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"last_reset_at" timestamp with time zone NOT NULL,
	CONSTRAINT "demo_reset_state_single_row_check" CHECK ("app"."demo_reset_state"."id" = 1)
);
