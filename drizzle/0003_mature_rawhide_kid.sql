CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"actor_type" varchar(24) NOT NULL,
	"actor_membership_id" uuid,
	"actor_service_account_id" uuid,
	"action" varchar(160) NOT NULL,
	"subject_type" varchar(80) NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" text,
	"safe_diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" uuid,
	"job_id" uuid,
	"ip_hash" char(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor_type_check" CHECK ("audit_events"."actor_type" in ('membership', 'service', 'system')),
	CONSTRAINT "audit_events_actor_reference_check" CHECK ((
        ("audit_events"."actor_type" = 'membership' and "audit_events"."actor_membership_id" is not null and "audit_events"."actor_service_account_id" is null)
        or ("audit_events"."actor_type" = 'service' and "audit_events"."actor_membership_id" is null and "audit_events"."actor_service_account_id" is not null)
        or ("audit_events"."actor_type" = 'system' and "audit_events"."actor_membership_id" is null and "audit_events"."actor_service_account_id" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_key" varchar(200) NOT NULL,
	"operation" varchar(120) NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"status" varchar(24) NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"resource_type" varchar(80),
	"resource_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_status_check" CHECK ("idempotency_records"."status" in ('processing', 'completed', 'failed')),
	CONSTRAINT "idempotency_records_response_status_check" CHECK ("idempotency_records"."response_status" is null or "idempotency_records"."response_status" between 100 and 599)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_membership_fk" FOREIGN KEY ("workspace_id","actor_membership_id") REFERENCES "public"."workspace_memberships"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_workspace_created_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_campaign_created_idx" ON "audit_events" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_subject_created_idx" ON "audit_events" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_request_idx" ON "audit_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "audit_events_job_idx" ON "audit_events" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_command_unique" ON "idempotency_records" USING btree ("workspace_id","actor_key","operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_idx" ON "idempotency_records" USING btree ("expires_at");