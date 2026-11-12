CREATE TABLE "workday"."ingest_runs" (
	"run_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workday"."ingest_runs_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_file" text NOT NULL,
	"file_sha256" text NOT NULL,
	"report_date" date,
	"row_count" integer NOT NULL,
	"status" text NOT NULL,
	"rejection_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_runs_status_check" CHECK ("workday"."ingest_runs"."status" in ('loaded', 'skipped', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "workday"."raw_worker_report" (
	"raw_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workday"."raw_worker_report_raw_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"report_date" date NOT NULL,
	"source_file" text NOT NULL,
	"file_sha256" text NOT NULL,
	"source_row" integer NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"worker_id" text NOT NULL,
	"worker_name" text NOT NULL,
	"work_email" text NOT NULL,
	"worker_type" text NOT NULL,
	"worker_status" text NOT NULL,
	"hire_date" text NOT NULL,
	"termination_date" text NOT NULL,
	"contract_end_date" text NOT NULL,
	"manager_id" text NOT NULL,
	"job_title" text NOT NULL,
	"supervisory_organization" text NOT NULL,
	"position_id" text NOT NULL,
	"cost_center" text NOT NULL,
	"location" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ingest_runs_file_sha256_idx" ON "workday"."ingest_runs" USING btree ("file_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_worker_report_file_row_key" ON "workday"."raw_worker_report" USING btree ("file_sha256","source_row");--> statement-breakpoint
CREATE INDEX "raw_worker_report_report_date_idx" ON "workday"."raw_worker_report" USING btree ("report_date");