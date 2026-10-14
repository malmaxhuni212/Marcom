CREATE TABLE "campaign_briefs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"input_method" varchar(16) NOT NULL,
	"stored_file_id" uuid,
	"source_text" text NOT NULL,
	"content_hash" char(64) NOT NULL,
	"parser_name" varchar(80),
	"parser_version" varchar(40),
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_briefs_version_check" CHECK ("campaign_briefs"."version" > 0),
	CONSTRAINT "campaign_briefs_input_method_check" CHECK ("campaign_briefs"."input_method" in ('form', 'paste', 'upload')),
	CONSTRAINT "campaign_briefs_upload_file_check" CHECK ("campaign_briefs"."input_method" <> 'upload' or "campaign_briefs"."stored_file_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "campaign_config_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"brief_id" uuid,
	"version" integer NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"objective" text NOT NULL,
	"primary_cta" text NOT NULL,
	"success_event" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"exclusions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"messaging_guidance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"followup_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"proposal_operation_id" uuid,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_config_versions_version_check" CHECK ("campaign_config_versions"."version" > 0),
	CONSTRAINT "campaign_config_versions_schema_version_check" CHECK ("campaign_config_versions"."schema_version" > 0),
	CONSTRAINT "campaign_config_versions_row_version_check" CHECK ("campaign_config_versions"."row_version" > 0),
	CONSTRAINT "campaign_config_versions_status_check" CHECK ("campaign_config_versions"."status" in ('draft', 'in_review', 'approved', 'superseded', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "campaign_field_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"config_version_id" uuid NOT NULL,
	"field_key" varchar(80) NOT NULL,
	"label" varchar(160) NOT NULL,
	"field_type" varchar(24) NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"filterable" boolean DEFAULT true NOT NULL,
	"sensitivity" varchar(16) DEFAULT 'normal' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_field_definitions_key_check" CHECK ("campaign_field_definitions"."field_key" ~ '^[a-z][a-z0-9_]{0,79}$'),
	CONSTRAINT "campaign_field_definitions_type_check" CHECK ("campaign_field_definitions"."field_type" in ('text', 'long_text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'url', 'email', 'single_select', 'multi_select')),
	CONSTRAINT "campaign_field_definitions_sensitivity_check" CHECK ("campaign_field_definitions"."sensitivity" in ('normal', 'personal', 'restricted')),
	CONSTRAINT "campaign_field_definitions_sort_order_check" CHECK ("campaign_field_definitions"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_membership_id" uuid,
	"title" varchar(200) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"active_config_version_id" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_row_version_check" CHECK ("campaigns"."row_version" > 0),
	CONSTRAINT "campaigns_status_check" CHECK ("campaigns"."status" in ('draft', 'configuration_review', 'ready', 'researching', 'active', 'paused', 'completed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "message_template_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"config_version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"template_key" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"channel" varchar(24) NOT NULL,
	"subject_template" text,
	"body_template" text NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_template_versions_version_check" CHECK ("message_template_versions"."version" > 0),
	CONSTRAINT "message_template_versions_channel_check" CHECK ("message_template_versions"."channel" in ('email', 'sms', 'linkedin', 'x', 'facebook', 'instagram', 'other')),
	CONSTRAINT "message_template_versions_status_check" CHECK ("message_template_versions"."status" in ('draft', 'approved', 'superseded', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "search_plan_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"config_version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"batch_size" integer NOT NULL,
	"enrichment_depth" varchar(16) NOT NULL,
	"query_families" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"limitations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_plan_versions_batch_size_check" CHECK ("search_plan_versions"."batch_size" between 1 and 50),
	CONSTRAINT "search_plan_versions_schema_version_check" CHECK ("search_plan_versions"."schema_version" > 0),
	CONSTRAINT "search_plan_versions_row_version_check" CHECK ("search_plan_versions"."row_version" > 0),
	CONSTRAINT "search_plan_versions_status_check" CHECK ("search_plan_versions"."status" in ('draft', 'in_review', 'approved', 'superseded', 'rejected')),
	CONSTRAINT "search_plan_versions_enrichment_depth_check" CHECK ("search_plan_versions"."enrichment_depth" in ('basic', 'detailed'))
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"storage_key" text NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"declared_mime_type" varchar(120),
	"detected_mime_type" varchar(120) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" char(64) NOT NULL,
	"status" varchar(24) NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "stored_files_size_check" CHECK ("stored_files"."size_bytes" > 0),
	CONSTRAINT "stored_files_status_check" CHECK ("stored_files"."status" in ('stored', 'extracting', 'ready', 'rejected', 'failed', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_briefs_campaign_id_unique" ON "campaign_briefs" USING btree ("campaign_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_config_versions_campaign_id_unique" ON "campaign_config_versions" USING btree ("campaign_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_workspace_id_unique" ON "campaigns" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_stored_file_id_stored_files_id_fk" FOREIGN KEY ("stored_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_created_by_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_config_versions" ADD CONSTRAINT "campaign_config_versions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_config_versions" ADD CONSTRAINT "campaign_config_versions_created_by_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_config_versions" ADD CONSTRAINT "campaign_config_versions_brief_fk" FOREIGN KEY ("campaign_id","brief_id") REFERENCES "public"."campaign_briefs"("campaign_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_field_definitions" ADD CONSTRAINT "campaign_field_definitions_config_version_id_campaign_config_versions_id_fk" FOREIGN KEY ("config_version_id") REFERENCES "public"."campaign_config_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_membership_fk" FOREIGN KEY ("workspace_id","owner_membership_id") REFERENCES "public"."workspace_memberships"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template_versions" ADD CONSTRAINT "message_template_versions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template_versions" ADD CONSTRAINT "message_template_versions_created_by_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template_versions" ADD CONSTRAINT "message_template_versions_config_fk" FOREIGN KEY ("campaign_id","config_version_id") REFERENCES "public"."campaign_config_versions"("campaign_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_plan_versions" ADD CONSTRAINT "search_plan_versions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_plan_versions" ADD CONSTRAINT "search_plan_versions_created_by_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_plan_versions" ADD CONSTRAINT "search_plan_versions_config_fk" FOREIGN KEY ("campaign_id","config_version_id") REFERENCES "public"."campaign_config_versions"("campaign_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_creator_membership_fk" FOREIGN KEY ("workspace_id","created_by_membership_id") REFERENCES "public"."workspace_memberships"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_briefs_campaign_version_unique" ON "campaign_briefs" USING btree ("campaign_id","version");--> statement-breakpoint
CREATE INDEX "campaign_briefs_campaign_created_idx" ON "campaign_briefs" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_config_versions_campaign_version_unique" ON "campaign_config_versions" USING btree ("campaign_id","version");--> statement-breakpoint
CREATE INDEX "campaign_config_versions_campaign_status_version_idx" ON "campaign_config_versions" USING btree ("campaign_id","status","version");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_field_definitions_config_key_unique" ON "campaign_field_definitions" USING btree ("config_version_id","field_key");--> statement-breakpoint
CREATE INDEX "campaign_field_definitions_config_sort_idx" ON "campaign_field_definitions" USING btree ("config_version_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_workspace_slug_unique" ON "campaigns" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_status_updated_idx" ON "campaigns" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_template_versions_campaign_template_version_unique" ON "message_template_versions" USING btree ("campaign_id","template_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "message_template_versions_campaign_id_unique" ON "message_template_versions" USING btree ("campaign_id","id");--> statement-breakpoint
CREATE INDEX "message_template_versions_campaign_status_idx" ON "message_template_versions" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "search_plan_versions_campaign_version_unique" ON "search_plan_versions" USING btree ("campaign_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "search_plan_versions_campaign_id_unique" ON "search_plan_versions" USING btree ("campaign_id","id");--> statement-breakpoint
CREATE INDEX "search_plan_versions_campaign_status_version_idx" ON "search_plan_versions" USING btree ("campaign_id","status","version");--> statement-breakpoint
CREATE UNIQUE INDEX "stored_files_storage_key_unique" ON "stored_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "stored_files_workspace_sha256_idx" ON "stored_files" USING btree ("workspace_id","sha256");
