ALTER TABLE "campaigns"
ADD CONSTRAINT "campaigns_active_config_same_campaign_fk"
FOREIGN KEY ("id", "active_config_version_id")
REFERENCES "public"."campaign_config_versions"("campaign_id", "id")
ON DELETE RESTRICT
ON UPDATE NO ACTION;
