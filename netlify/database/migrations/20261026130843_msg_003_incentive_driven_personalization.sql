ALTER TABLE "message_drafts" ADD COLUMN "alternative_opening" text;--> statement-breakpoint
ALTER TABLE "personalization_profiles" ADD COLUMN "personalization_angle" text;--> statement-breakpoint
ALTER TABLE "personalization_profiles" ADD COLUMN "recipient_incentive" text;--> statement-breakpoint
ALTER TABLE "personalization_profiles" ADD COLUMN "recommended_channel" varchar(32);--> statement-breakpoint
ALTER TABLE "personalization_profiles" ADD COLUMN "confidence" varchar(16);--> statement-breakpoint
ALTER TABLE "personalization_profiles" ADD CONSTRAINT "personalization_profiles_confidence_check" CHECK ("personalization_profiles"."confidence" is null or "personalization_profiles"."confidence" in ('high', 'medium', 'low'));