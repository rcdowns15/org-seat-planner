CREATE TABLE "app"."divisions" (
	"division_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."divisions_division_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	CONSTRAINT "divisions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "app"."groups" (
	"group_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."groups_group_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"division_id" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "app"."headcount_plan" (
	"squad_id" integer NOT NULL,
	"quarter_start" date NOT NULL,
	"approved_seats" integer NOT NULL,
	CONSTRAINT "headcount_plan_pkey" PRIMARY KEY("squad_id","quarter_start"),
	CONSTRAINT "headcount_plan_approved_seats_check" CHECK ("app"."headcount_plan"."approved_seats" >= 0),
	CONSTRAINT "headcount_plan_quarter_start_check" CHECK ("app"."headcount_plan"."quarter_start" = date_trunc('quarter', "app"."headcount_plan"."quarter_start")::date)
);
--> statement-breakpoint
CREATE TABLE "app"."leaders" (
	"leader_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."leaders_leader_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"worker_id" text NOT NULL,
	"display_name" text NOT NULL,
	"scope_type" text NOT NULL,
	"division_id" integer,
	"group_id" integer,
	CONSTRAINT "leaders_worker_id_unique" UNIQUE("worker_id"),
	CONSTRAINT "leaders_scope_type_check" CHECK ("app"."leaders"."scope_type" in ('division', 'group')),
	CONSTRAINT "leaders_scope_matches_type_check" CHECK (("app"."leaders"."scope_type" = 'division' and "app"."leaders"."division_id" is not null and "app"."leaders"."group_id" is null)
       or ("app"."leaders"."scope_type" = 'group' and "app"."leaders"."group_id" is not null and "app"."leaders"."division_id" is null))
);
--> statement-breakpoint
CREATE TABLE "app"."seat_changes" (
	"change_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."seat_changes_change_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"move_id" uuid,
	"seat_id" integer NOT NULL,
	"change_type" text NOT NULL,
	"worker_id" text,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"from_worker_id" text,
	"to_worker_id" text,
	"actor_leader_id" integer NOT NULL,
	"effective_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverses_change_id" bigint,
	"note" text,
	CONSTRAINT "seat_changes_reverses_change_id_key" UNIQUE("reverses_change_id"),
	CONSTRAINT "seat_changes_change_type_check" CHECK ("app"."seat_changes"."change_type" in ('move_out', 'move_in', 'fill', 'vacate', 'reserve', 'release', 'undo', 'demo_touch')),
	CONSTRAINT "seat_changes_from_status_check" CHECK ("app"."seat_changes"."from_status" in ('filled', 'open', 'backfill', 'offer_accepted')),
	CONSTRAINT "seat_changes_to_status_check" CHECK ("app"."seat_changes"."to_status" in ('filled', 'open', 'backfill', 'offer_accepted')),
	CONSTRAINT "seat_changes_from_filled_has_worker_check" CHECK (("app"."seat_changes"."from_status" = 'filled') = ("app"."seat_changes"."from_worker_id" is not null)),
	CONSTRAINT "seat_changes_to_filled_has_worker_check" CHECK (("app"."seat_changes"."to_status" = 'filled') = ("app"."seat_changes"."to_worker_id" is not null)),
	CONSTRAINT "seat_changes_undo_reverses_check" CHECK (("app"."seat_changes"."change_type" = 'undo') = ("app"."seat_changes"."reverses_change_id" is not null)),
	CONSTRAINT "seat_changes_move_has_move_id_check" CHECK ("app"."seat_changes"."change_type" not in ('move_out', 'move_in') or "app"."seat_changes"."move_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "app"."seats" (
	"seat_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."seats_seat_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"squad_id" integer NOT NULL,
	"seat_type" text NOT NULL,
	"status" text NOT NULL,
	"worker_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_leader_id" integer,
	CONSTRAINT "seats_seat_type_check" CHECK ("app"."seats"."seat_type" in ('employee', 'contingent')),
	CONSTRAINT "seats_status_check" CHECK ("app"."seats"."status" in ('filled', 'open', 'backfill', 'offer_accepted')),
	CONSTRAINT "seats_filled_has_worker_check" CHECK (("app"."seats"."status" = 'filled') = ("app"."seats"."worker_id" is not null)),
	CONSTRAINT "seats_version_check" CHECK ("app"."seats"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."squads" (
	"squad_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."squads_squad_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"group_id" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "squads_group_id_name_key" UNIQUE("group_id","name")
);
--> statement-breakpoint
CREATE TABLE "workday"."workers" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"worker_type" text NOT NULL,
	"status" text NOT NULL,
	"hire_date" date NOT NULL,
	"termination_date" date,
	"manager_worker_id" text,
	"job_title" text NOT NULL,
	"supervisory_org" text NOT NULL,
	"position_id" text NOT NULL,
	"cost_center" text NOT NULL,
	"location" text NOT NULL,
	"as_of_report_date" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workers_worker_type_check" CHECK ("workday"."workers"."worker_type" in ('employee', 'contingent')),
	CONSTRAINT "workers_status_check" CHECK ("workday"."workers"."status" in ('active', 'leave', 'terminated'))
);
--> statement-breakpoint
ALTER TABLE "app"."groups" ADD CONSTRAINT "groups_division_id_divisions_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "app"."divisions"("division_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."headcount_plan" ADD CONSTRAINT "headcount_plan_squad_id_squads_squad_id_fk" FOREIGN KEY ("squad_id") REFERENCES "app"."squads"("squad_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."leaders" ADD CONSTRAINT "leaders_division_id_divisions_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "app"."divisions"("division_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."leaders" ADD CONSTRAINT "leaders_group_id_groups_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "app"."groups"("group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."seat_changes" ADD CONSTRAINT "seat_changes_seat_id_seats_seat_id_fk" FOREIGN KEY ("seat_id") REFERENCES "app"."seats"("seat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."seat_changes" ADD CONSTRAINT "seat_changes_actor_leader_id_leaders_leader_id_fk" FOREIGN KEY ("actor_leader_id") REFERENCES "app"."leaders"("leader_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."seat_changes" ADD CONSTRAINT "seat_changes_reverses_change_id_fkey" FOREIGN KEY ("reverses_change_id") REFERENCES "app"."seat_changes"("change_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."seats" ADD CONSTRAINT "seats_squad_id_squads_squad_id_fk" FOREIGN KEY ("squad_id") REFERENCES "app"."squads"("squad_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."seats" ADD CONSTRAINT "seats_updated_by_leader_id_leaders_leader_id_fk" FOREIGN KEY ("updated_by_leader_id") REFERENCES "app"."leaders"("leader_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."squads" ADD CONSTRAINT "squads_group_id_groups_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "app"."groups"("group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seats_worker_id_key" ON "app"."seats" USING btree ("worker_id") WHERE "app"."seats"."worker_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workers_position_id_active_key" ON "workday"."workers" USING btree ("position_id") WHERE "workday"."workers"."status" <> 'terminated';