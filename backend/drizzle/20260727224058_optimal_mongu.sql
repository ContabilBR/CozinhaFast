DROP INDEX IF EXISTS "idx_categoria_pratos_restaurante_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_categorias_restaurante_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_comandas_restaurante_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_comandas_historico_restaurante_id";--> statement-breakpoint
-- mesas_restaurante_numero_unique may exist as a bare index (from
-- black_queen_noir's CREATE UNIQUE INDEX) or as the backing index of a
-- table constraint (from backfill_restaurante_id's ADD CONSTRAINT) —
-- Postgres refuses a plain DROP INDEX on the latter, so handle both.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesas_restaurante_numero_unique') THEN
    ALTER TABLE "mesas" DROP CONSTRAINT "mesas_restaurante_numero_unique";
  ELSIF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'mesas_restaurante_numero_unique') THEN
    DROP INDEX "mesas_restaurante_numero_unique";
  END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "idx_mesas_restaurante_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_pedidos_restaurante_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_pedidos_historico_restaurante_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_pratos_restaurante_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_profiles_restaurante_id";--> statement-breakpoint
-- Same bare-index-vs-constraint-backed-index situation as mesas above.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_restaurante_email_unique') THEN
    ALTER TABLE "usuarios" DROP CONSTRAINT "usuarios_restaurante_email_unique";
  ELSIF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'usuarios_restaurante_email_unique') THEN
    DROP INDEX "usuarios_restaurante_email_unique";
  END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "idx_usuarios_restaurante_id";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesas_numero_unique') THEN
    ALTER TABLE "mesas" ADD CONSTRAINT "mesas_numero_unique" UNIQUE("numero");
  END IF;
END $$;