CREATE TABLE "campaign_prospects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"config_version_id" uuid NOT NULL,
	"owner_membership_id" uuid,
	"source_method" varchar(24) NOT NULL,
	"research_status" varchar(32) NOT NULL,
	"engagement_status" varchar(32) DEFAULT 'not_started' NOT NULL,
	"fit_summary" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review_notes" text,
	"rejection_reason" text,
	"shortlisted_at" timestamp with time zone,
	"reviewed_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_prospects_source_check" CHECK ("campaign_prospects"."source_method" in ('manual', 'csv', 'provider')),
	CONSTRAINT "campaign_prospects_research_status_check" CHECK ("campaign_prospects"."research_status" in ('discovered', 'extracting', 'review_required', 'enrichment_requested', 'enrichment_failed', 'duplicate_review', 'shortlisted', 'rejected')),
	CONSTRAINT "campaign_prospects_engagement_status_check" CHECK ("campaign_prospects"."engagement_status" in ('not_started', 'drafting', 'draft_ready', 'approved', 'sent', 'followup_due', 'responded', 'closed', 'suppressed')),
	CONSTRAINT "campaign_prospects_rejection_reason_check" CHECK ("campaign_prospects"."research_status" <> 'rejected' or nullif(trim("campaign_prospects"."rejection_reason"), '') is not null)
);
--> statement-breakpoint
CREATE TABLE "contact_points" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"channel" varchar(32) NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"value_hash" char(64) NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"source_url" text,
	"retrieved_at" timestamp with time zone,
	"verification_status" varchar(32) DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_points_channel_check" CHECK ("contact_points"."channel" in ('email', 'phone', 'contact_form', 'linkedin', 'x', 'facebook', 'instagram', 'other')),
	CONSTRAINT "contact_points_verification_check" CHECK ("contact_points"."verification_status" in ('unverified', 'source_verified', 'invalid', 'suppressed'))
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_a_id" uuid NOT NULL,
	"prospect_b_id" uuid NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"basis" jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"resolved_by_membership_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_candidates_distinct_check" CHECK ("duplicate_candidates"."prospect_a_id" <> "duplicate_candidates"."prospect_b_id"),
	CONSTRAINT "duplicate_candidates_score_check" CHECK ("duplicate_candidates"."score" between 0 and 1),
	CONSTRAINT "duplicate_candidates_status_check" CHECK ("duplicate_candidates"."status" in ('pending', 'same', 'different', 'ignored'))
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_prospect_id" uuid NOT NULL,
	"field_key" varchar(80) NOT NULL,
	"value_json" jsonb NOT NULL,
	"source_url" text NOT NULL,
	"canonical_source_url" text NOT NULL,
	"source_title" text,
	"snippet" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"confidence" varchar(16) NOT NULL,
	"verification_status" varchar(24) NOT NULL,
	"research_result_id" uuid,
	"provider_operation_id" uuid,
	"evidence_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_items_field_key_check" CHECK ("evidence_items"."field_key" ~ '^[a-z][a-z0-9_]{0,79}$'),
	CONSTRAINT "evidence_items_confidence_check" CHECK ("evidence_items"."confidence" in ('high', 'medium', 'low')),
	CONSTRAINT "evidence_items_verification_check" CHECK ("evidence_items"."verification_status" in ('single_source', 'corroborated', 'contradicted', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "job_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"item_key" varchar(240) NOT NULL,
	"status" varchar(24) NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_category" text,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_items_status_check" CHECK ("job_items"."status" in ('pending', 'running', 'completed', 'failed', 'skipped')),
	CONSTRAINT "job_items_attempt_check" CHECK ("job_items"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"job_type" varchar(80) NOT NULL,
	"status" varchar(32) NOT NULL,
	"priority" smallint DEFAULT 100 NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_schema_version" integer DEFAULT 1 NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" varchar(200),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" varchar(120),
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"error_category" text,
	"error_detail" text,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('queued', 'running', 'waiting_rate_limit', 'retry_scheduled', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
	CONSTRAINT "jobs_priority_check" CHECK ("jobs"."priority" >= 0),
	CONSTRAINT "jobs_attempt_check" CHECK ("jobs"."attempt_count" >= 0 and "jobs"."max_attempts" > 0),
	CONSTRAINT "jobs_payload_version_check" CHECK ("jobs"."payload_schema_version" > 0),
	CONSTRAINT "jobs_terminal_time_check" CHECK ("jobs"."status" not in ('completed', 'completed_with_errors', 'failed', 'cancelled') or "jobs"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "prospect_identifiers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"identifier_type" varchar(32) NOT NULL,
	"provider_name" varchar(80),
	"display_value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_identifiers_type_check" CHECK ("prospect_identifiers"."identifier_type" in ('profile_url', 'website_domain', 'provider_entity')),
	CONSTRAINT "prospect_identifiers_provider_check" CHECK ("prospect_identifiers"."identifier_type" <> 'provider_entity' or "prospect_identifiers"."provider_name" is not null)
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" varchar(24) NOT NULL,
	"canonical_name" varchar(240) NOT NULL,
	"canonical_domain" varchar(255),
	"primary_url" text,
	"location_text" varchar(240),
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"merged_into_prospect_id" uuid,
	"normalization_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "prospects_entity_type_check" CHECK ("prospects"."entity_type" in ('person', 'organisation')),
	CONSTRAINT "prospects_status_check" CHECK ("prospects"."status" in ('active', 'merged', 'deleted')),
	CONSTRAINT "prospects_normalization_version_check" CHECK ("prospects"."normalization_version" > 0),
	CONSTRAINT "prospects_not_self_merged_check" CHECK ("prospects"."merged_into_prospect_id" is null or "prospects"."merged_into_prospect_id" <> "prospects"."id"),
	CONSTRAINT "prospects_merge_state_check" CHECK (("prospects"."status" = 'merged' and "prospects"."merged_into_prospect_id" is not null) or ("prospects"."status" <> 'merged' and "prospects"."merged_into_prospect_id" is null))
);
--> statement-breakpoint
CREATE TABLE "provider_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"job_id" uuid,
	"job_item_id" uuid,
	"campaign_prospect_id" uuid,
	"provider_kind" varchar(24) NOT NULL,
	"provider_name" varchar(80) NOT NULL,
	"model_name" varchar(160),
	"operation" varchar(120) NOT NULL,
	"status" varchar(24) NOT NULL,
	"external_request_id" varchar(255),
	"prompt_version" varchar(80),
	"schema_version" integer DEFAULT 1 NOT NULL,
	"input_hash" char(64) NOT NULL,
	"output_hash" char(64),
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_cost" numeric(14, 6),
	"currency" char(3),
	"latency_ms" integer,
	"error_category" text,
	"error_detail" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_operations_kind_check" CHECK ("provider_operations"."provider_kind" in ('search', 'ai')),
	CONSTRAINT "provider_operations_status_check" CHECK ("provider_operations"."status" in ('started', 'succeeded', 'failed', 'rejected')),
	CONSTRAINT "provider_operations_schema_version_check" CHECK ("provider_operations"."schema_version" > 0),
	CONSTRAINT "provider_operations_cost_check" CHECK ("provider_operations"."estimated_cost" is null or "provider_operations"."estimated_cost" >= 0),
	CONSTRAINT "provider_operations_latency_check" CHECK ("provider_operations"."latency_ms" is null or "provider_operations"."latency_ms" >= 0),
	CONSTRAINT "provider_operations_currency_check" CHECK (("provider_operations"."estimated_cost" is null and "provider_operations"."currency" is null) or ("provider_operations"."estimated_cost" is not null and "provider_operations"."currency" is not null))
);
--> statement-breakpoint
CREATE TABLE "research_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"research_run_id" uuid NOT NULL,
	"job_item_id" uuid,
	"query_key" varchar(120) NOT NULL,
	"provider_name" varchar(80) NOT NULL,
	"provider_result_id" varchar(255),
	"rank" integer,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text,
	"snippet" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(24) NOT NULL,
	"prospect_id" uuid,
	"campaign_prospect_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_results_job_item_id_unique" UNIQUE("job_item_id"),
	CONSTRAINT "research_results_status_check" CHECK ("research_results"."status" in ('received', 'duplicate', 'processing', 'accepted', 'rejected', 'failed')),
	CONSTRAINT "research_results_rank_check" CHECK ("research_results"."rank" is null or "research_results"."rank" > 0)
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"search_plan_version_id" uuid NOT NULL,
	"requested_count" integer NOT NULL,
	"found_count" integer DEFAULT 0 NOT NULL,
	"unique_count" integer DEFAULT 0 NOT NULL,
	"enriched_count" integer DEFAULT 0 NOT NULL,
	"review_required_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "research_runs_requested_count_check" CHECK ("research_runs"."requested_count" between 1 and 50),
	CONSTRAINT "research_runs_counts_check" CHECK ("research_runs"."found_count" >= 0 and "research_runs"."unique_count" >= 0 and "research_runs"."enriched_count" >= 0 and "research_runs"."review_required_count" >= 0 and "research_runs"."failed_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_workspace_id_unique" ON "prospects" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_prospects_workspace_id_unique" ON "campaign_prospects" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_workspace_id_unique" ON "jobs" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD CONSTRAINT "campaign_prospects_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD CONSTRAINT "campaign_prospects_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD CONSTRAINT "campaign_prospects_config_fk" FOREIGN KEY ("campaign_id","config_version_id") REFERENCES "public"."campaign_config_versions"("campaign_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD CONSTRAINT "campaign_prospects_owner_fk" FOREIGN KEY ("workspace_id","owner_membership_id") REFERENCES "public"."workspace_memberships"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD CONSTRAINT "campaign_prospects_reviewer_fk" FOREIGN KEY ("workspace_id","reviewed_by_membership_id") REFERENCES "public"."workspace_memberships"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_prospect_a_fk" FOREIGN KEY ("workspace_id","prospect_a_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_prospect_b_fk" FOREIGN KEY ("workspace_id","prospect_b_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_resolver_fk" FOREIGN KEY ("workspace_id","resolved_by_membership_id") REFERENCES "public"."workspace_memberships"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_campaign_prospect_id_campaign_prospects_id_fk" FOREIGN KEY ("campaign_prospect_id") REFERENCES "public"."campaign_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_research_result_id_research_results_id_fk" FOREIGN KEY ("research_result_id") REFERENCES "public"."research_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_provider_operation_id_provider_operations_id_fk" FOREIGN KEY ("provider_operation_id") REFERENCES "public"."provider_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_creator_fk" FOREIGN KEY ("workspace_id","created_by_membership_id") REFERENCES "public"."workspace_memberships"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_identifiers" ADD CONSTRAINT "prospect_identifiers_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_merged_into_fk" FOREIGN KEY ("workspace_id","merged_into_prospect_id") REFERENCES "public"."prospects"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_job_item_id_job_items_id_fk" FOREIGN KEY ("job_item_id") REFERENCES "public"."job_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_job_fk" FOREIGN KEY ("workspace_id","job_id") REFERENCES "public"."jobs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_campaign_prospect_fk" FOREIGN KEY ("workspace_id","campaign_prospect_id") REFERENCES "public"."campaign_prospects"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_job_item_id_job_items_id_fk" FOREIGN KEY ("job_item_id") REFERENCES "public"."job_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_campaign_prospect_id_campaign_prospects_id_fk" FOREIGN KEY ("campaign_prospect_id") REFERENCES "public"."campaign_prospects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_search_plan_fk" FOREIGN KEY ("campaign_id","search_plan_version_id") REFERENCES "public"."search_plan_versions"("campaign_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_prospects_campaign_prospect_unique" ON "campaign_prospects" USING btree ("campaign_id","prospect_id");--> statement-breakpoint
CREATE INDEX "campaign_prospects_campaign_research_updated_idx" ON "campaign_prospects" USING btree ("campaign_id","research_status","updated_at");--> statement-breakpoint
CREATE INDEX "campaign_prospects_campaign_engagement_updated_idx" ON "campaign_prospects" USING btree ("campaign_id","engagement_status","updated_at");--> statement-breakpoint
CREATE INDEX "campaign_prospects_owner_research_idx" ON "campaign_prospects" USING btree ("owner_membership_id","research_status");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_points_prospect_value_unique" ON "contact_points" USING btree ("workspace_id","channel","value_hash","prospect_id");--> statement-breakpoint
CREATE INDEX "contact_points_workspace_channel_hash_idx" ON "contact_points" USING btree ("workspace_id","channel","value_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_candidates_pair_unique" ON "duplicate_candidates" USING btree ("workspace_id",least("prospect_a_id", "prospect_b_id"),greatest("prospect_a_id", "prospect_b_id"));--> statement-breakpoint
CREATE INDEX "duplicate_candidates_workspace_status_score_idx" ON "duplicate_candidates" USING btree ("workspace_id","status","score");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_items_hash_unique" ON "evidence_items" USING btree ("campaign_prospect_id","evidence_hash");--> statement-breakpoint
CREATE INDEX "evidence_items_prospect_field_idx" ON "evidence_items" USING btree ("campaign_prospect_id","field_key");--> statement-breakpoint
CREATE INDEX "evidence_items_canonical_url_idx" ON "evidence_items" USING btree ("canonical_source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "job_items_job_key_unique" ON "job_items" USING btree ("job_id","item_key");--> statement-breakpoint
CREATE INDEX "job_items_job_status_idx" ON "job_items" USING btree ("job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_unique" ON "jobs" USING btree ("workspace_id","job_type","idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_campaign_created_idx" ON "jobs" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("priority","run_after","created_at");--> statement-breakpoint
CREATE INDEX "jobs_lease_recovery_idx" ON "jobs" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_identifiers_comparison_unique" ON "prospect_identifiers" USING btree ("workspace_id","identifier_type",coalesce("provider_name", ''),"normalized_value");--> statement-breakpoint
CREATE INDEX "prospect_identifiers_prospect_type_idx" ON "prospect_identifiers" USING btree ("prospect_id","identifier_type");--> statement-breakpoint
CREATE INDEX "prospects_workspace_name_idx" ON "prospects" USING btree ("workspace_id","canonical_name");--> statement-breakpoint
CREATE INDEX "prospects_workspace_domain_idx" ON "prospects" USING btree ("workspace_id","canonical_domain");--> statement-breakpoint
CREATE INDEX "prospects_workspace_status_idx" ON "prospects" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "provider_operations_campaign_created_idx" ON "provider_operations" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "provider_operations_provider_operation_created_idx" ON "provider_operations" USING btree ("provider_name","operation","created_at");--> statement-breakpoint
CREATE INDEX "provider_operations_job_item_idx" ON "provider_operations" USING btree ("job_id","job_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_results_provider_result_unique" ON "research_results" USING btree ("research_run_id","provider_name","provider_result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_results_canonical_url_unique" ON "research_results" USING btree ("research_run_id","canonical_url");--> statement-breakpoint
CREATE INDEX "research_results_run_status_rank_idx" ON "research_results" USING btree ("research_run_id","status","rank");--> statement-breakpoint
CREATE INDEX "research_results_campaign_prospect_idx" ON "research_results" USING btree ("campaign_prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_runs_job_unique" ON "research_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "research_runs_campaign_created_idx" ON "research_runs" USING btree ("campaign_id","created_at");
