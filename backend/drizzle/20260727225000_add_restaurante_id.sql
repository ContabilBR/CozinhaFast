-- Add restaurante_id column to 10 tables with backfill
-- Phase 1: Ensure default restaurante exists
INSERT INTO "restaurante" ("id", "nome", "created_at", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', 'Restaurante Padrão', NOW(), NOW())
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Phase 2: Add restaurante_id as nullable to all tables (if not already present)
ALTER TABLE "mesas" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "categorias" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "categoria_pratos" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "pratos" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Phase 3: Backfill with default restaurante for rows with NULL restaurante_id
UPDATE "mesas" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
--> statement-breakpoint
UPDATE "categorias" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
--> statement-breakpoint
UPDATE "categoria_pratos" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
--> statement-breakpoint
UPDATE "pratos" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
--> statement-breakpoint
UPDATE "comandas" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
--> statement-breakpoint
UPDATE "pedidos" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
--> statement-breakpoint
UPDATE "profiles" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
--> statement-breakpoint
UPDATE "usuarios" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
--> statement-breakpoint
UPDATE "comandas_historico" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
--> statement-breakpoint
UPDATE "pedidos_historico" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
--> statement-breakpoint

-- Phase 4: Set restaurante_id to NOT NULL (profiles can remain nullable but we backfilled it anyway)
ALTER TABLE "mesas" ALTER COLUMN "restaurante_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "categorias" ALTER COLUMN "restaurante_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "categoria_pratos" ALTER COLUMN "restaurante_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "pratos" ALTER COLUMN "restaurante_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "comandas" ALTER COLUMN "restaurante_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "pedidos" ALTER COLUMN "restaurante_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "restaurante_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "comandas_historico" ALTER COLUMN "restaurante_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "pedidos_historico" ALTER COLUMN "restaurante_id" SET NOT NULL;
