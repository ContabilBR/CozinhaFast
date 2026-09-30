-- Add the stable identity link before deploying the new garcons routes.
-- Deliberately no email backfill: existing pairs require verified IDs and restaurant.
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "better_auth_user_id" text;
--> statement-breakpoint
DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'usuarios'::regclass AND conname = 'usuarios_better_auth_user_id_unique'
  ) THEN
    ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_better_auth_user_id_unique" UNIQUE ("better_auth_user_id");
  END IF;
END $;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'usuarios'::regclass
      AND conname = 'usuarios_better_auth_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "usuarios"
      ADD CONSTRAINT "usuarios_better_auth_user_id_user_id_fk"
      FOREIGN KEY ("better_auth_user_id") REFERENCES "user" ("id") ON DELETE SET NULL;
  END IF;
END;
$;
