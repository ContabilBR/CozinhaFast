BEGIN;
--> statement-breakpoint

-- Add restaurante_id columns to all tenant-aware tables
-- These are added as NULLABLE first to handle existing data
-- The NOT NULL constraint will be applied after data is backfilled
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS restaurante_id uuid;
--> statement-breakpoint
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS restaurante_id uuid;
--> statement-breakpoint
ALTER TABLE categoria_pratos ADD COLUMN IF NOT EXISTS restaurante_id uuid;
--> statement-breakpoint
ALTER TABLE pratos ADD COLUMN IF NOT EXISTS restaurante_id uuid;
--> statement-breakpoint
ALTER TABLE comandas ADD COLUMN IF NOT EXISTS restaurante_id uuid;
--> statement-breakpoint
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS restaurante_id uuid;
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS restaurante_id uuid;
--> statement-breakpoint
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS restaurante_id uuid;
--> statement-breakpoint
ALTER TABLE comandas_historico ADD COLUMN IF NOT EXISTS restaurante_id uuid;
--> statement-breakpoint
ALTER TABLE pedidos_historico ADD COLUMN IF NOT EXISTS restaurante_id uuid;
--> statement-breakpoint

COMMIT;
