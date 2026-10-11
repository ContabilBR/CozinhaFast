CREATE TYPE "public"."modo_comanda" AS ENUM('mesa', 'individual');--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN "rotulo" text;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN "rotulo" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "modo_comanda" "modo_comanda" DEFAULT 'mesa' NOT NULL;