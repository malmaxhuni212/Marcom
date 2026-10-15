INSERT INTO "workspaces" (
	"id",
	"name",
	"slug",
	"status",
	"default_timezone"
) VALUES (
	'10000000-0000-4000-8000-000000000001',
	'MARCOM Local Pilot',
	'marcom-local-pilot',
	'active',
	'Europe/London'
) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "users" (
	"id",
	"email",
	"email_normalized",
	"display_name",
	"auth_method",
	"status"
) VALUES (
	'10000000-0000-4000-8000-000000000002',
	'local-pilot@invalid.local',
	'local-pilot@invalid.local',
	'Local Pilot User',
	'local_actor',
	'active'
) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "workspace_memberships" (
	"id",
	"workspace_id",
	"user_id",
	"status",
	"joined_at"
) VALUES (
	'10000000-0000-4000-8000-000000000003',
	'10000000-0000-4000-8000-000000000001',
	'10000000-0000-4000-8000-000000000002',
	'active',
	CURRENT_TIMESTAMP
) ON CONFLICT DO NOTHING;
