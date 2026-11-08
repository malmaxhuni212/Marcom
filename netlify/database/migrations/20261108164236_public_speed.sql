CREATE TABLE "guest_usage_quotas" (
	"guest_id_hash" char(64) PRIMARY KEY NOT NULL,
	"day_bucket" char(10) NOT NULL,
	"month_bucket" char(7) NOT NULL,
	"research_day_count" integer DEFAULT 0 NOT NULL,
	"research_month_count" integer DEFAULT 0 NOT NULL,
	"personalization_day_count" integer DEFAULT 0 NOT NULL,
	"personalization_month_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_usage_quotas_counts_bounds_check" CHECK ("guest_usage_quotas"."research_day_count" >= 0
        and "guest_usage_quotas"."research_day_count" <= 5
        and "guest_usage_quotas"."research_month_count" >= 0
        and "guest_usage_quotas"."research_month_count" <= 15
        and "guest_usage_quotas"."personalization_day_count" >= 0
        and "guest_usage_quotas"."personalization_day_count" <= 2
        and "guest_usage_quotas"."personalization_month_count" >= 0
        and "guest_usage_quotas"."personalization_month_count" <= 5)
);
--> statement-breakpoint
CREATE INDEX "guest_usage_quotas_updated_at_idx" ON "guest_usage_quotas" USING btree ("updated_at");