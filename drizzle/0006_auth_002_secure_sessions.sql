CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"csrf_token_hash" char(64) NOT NULL,
	"credential_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(160),
	CONSTRAINT "auth_sessions_credential_version_check" CHECK ("auth_sessions"."credential_version" >= 1),
	CONSTRAINT "auth_sessions_expiry_order_check" CHECK ("auth_sessions"."idle_expires_at" > "auth_sessions"."created_at"
        and "auth_sessions"."absolute_expires_at" > "auth_sessions"."created_at"
        and "auth_sessions"."idle_expires_at" <= "auth_sessions"."absolute_expires_at"),
	CONSTRAINT "auth_sessions_revocation_check" CHECK ((
        "auth_sessions"."revoked_at" is null and "auth_sessions"."revocation_reason" is null
      ) or (
        "auth_sessions"."revoked_at" is not null and "auth_sessions"."revocation_reason" is not null
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_memberships_workspace_user_id_unique" ON "workspace_memberships" USING btree ("workspace_id","user_id","id");--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_membership_fk" FOREIGN KEY ("workspace_id","user_id","membership_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_unique" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_active_idx" ON "auth_sessions" USING btree ("workspace_id","user_id","absolute_expires_at") WHERE "auth_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_cleanup_idx" ON "auth_sessions" USING btree ("absolute_expires_at","revoked_at");
