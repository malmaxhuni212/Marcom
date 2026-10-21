CREATE TABLE "message_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_prospect_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"channel" varchar(24) NOT NULL,
	"subject" text,
	"content" text NOT NULL,
	"copy_payload" jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"parent_draft_id" uuid,
	"generation_operation_id" uuid,
	"warnings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" char(64) NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_drafts_version_check" CHECK ("message_drafts"."version" > 0),
	CONSTRAINT "message_drafts_channel_check" CHECK ("message_drafts"."channel" in ('email', 'linkedin', 'multi_channel')),
	CONSTRAINT "message_drafts_status_check" CHECK ("message_drafts"."status" in ('draft', 'in_review', 'approved', 'rejected', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "personalization_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"campaign_prospect_id" uuid NOT NULL,
	"record_id" varchar(255) NOT NULL,
	"current_message_draft_id" uuid,
	"status" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personalization_profiles_status_check" CHECK ("personalization_profiles"."status" in ('draft', 'approved', 'rejected', 'needs_more_research', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "personalization_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"updated_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personalization_settings_row_version_check" CHECK ("personalization_settings"."row_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "message_drafts" ADD CONSTRAINT "message_drafts_campaign_prospect_id_campaign_prospects_id_fk" FOREIGN KEY ("campaign_prospect_id") REFERENCES "public"."campaign_prospects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_drafts" ADD CONSTRAINT "message_drafts_created_by_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_drafts" ADD CONSTRAINT "message_drafts_parent_fk" FOREIGN KEY ("parent_draft_id") REFERENCES "public"."message_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personalization_profiles" ADD CONSTRAINT "personalization_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personalization_profiles" ADD CONSTRAINT "personalization_profiles_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personalization_profiles" ADD CONSTRAINT "personalization_profiles_campaign_prospect_fk" FOREIGN KEY ("workspace_id","campaign_prospect_id") REFERENCES "public"."campaign_prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personalization_profiles" ADD CONSTRAINT "personalization_profiles_current_draft_fk" FOREIGN KEY ("current_message_draft_id") REFERENCES "public"."message_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personalization_settings" ADD CONSTRAINT "personalization_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personalization_settings" ADD CONSTRAINT "personalization_settings_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personalization_settings" ADD CONSTRAINT "personalization_settings_updater_fk" FOREIGN KEY ("workspace_id","updated_by_membership_id") REFERENCES "public"."workspace_memberships"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_drafts_prospect_channel_version_unique" ON "message_drafts" USING btree ("campaign_prospect_id","channel","version");--> statement-breakpoint
CREATE INDEX "message_drafts_prospect_status_created_idx" ON "message_drafts" USING btree ("campaign_prospect_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "personalization_profiles_campaign_record_unique" ON "personalization_profiles" USING btree ("campaign_id","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personalization_profiles_campaign_prospect_unique" ON "personalization_profiles" USING btree ("campaign_prospect_id");--> statement-breakpoint
CREATE INDEX "personalization_profiles_campaign_status_updated_idx" ON "personalization_profiles" USING btree ("campaign_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "personalization_settings_campaign_unique" ON "personalization_settings" USING btree ("campaign_id");