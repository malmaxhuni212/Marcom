CREATE TABLE "auth_login_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"identifier_hash" char(64) NOT NULL,
	"source_hash" char(64),
	"succeeded" boolean NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_normalized" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credential_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "users"
SET
	"username_normalized" = 'legacy-' || replace("id"::text, '-', ''),
	"credential_version" = 1,
	"password_changed_at" = coalesce("updated_at", "created_at", now())
WHERE "auth_method" = 'password';--> statement-breakpoint
ALTER TABLE "auth_login_attempts" ADD CONSTRAINT "auth_login_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_login_attempts_identifier_time_idx" ON "auth_login_attempts" USING btree ("workspace_id","identifier_hash","attempted_at");--> statement-breakpoint
CREATE INDEX "auth_login_attempts_cleanup_idx" ON "auth_login_attempts" USING btree ("attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_normalized_unique" ON "users" USING btree ("username_normalized") WHERE "users"."username_normalized" is not null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_password_identity_check" CHECK ("users"."auth_method" <> 'password' or (
        "users"."username_normalized" is not null
        and "users"."password_hash" is not null
        and "users"."credential_version" >= 1
        and "users"."password_changed_at" is not null
      ));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_credential_version_check" CHECK ("users"."credential_version" >= 0);
