/**
 * Liberar mesa (release table).
 *
 * After a comanda closes or is cancelled, checks if the table still has other open
 * non-delivery comandas. If not, marks the table as "disponivel" (available).
 * If mesaId is null/undefined, returns early.
 *
 * This function MUST be called within an already-open transaction to prevent race conditions.
 * It locks the mesa row (SELECT FOR UPDATE) before counting.
 */
import { and, eq, ne } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";

export async function liberarMesaSeVazia(
  tx: any,
  mesaId: string | null | undefined,
  restauranteId: string
): Promise<void> {
  if (!mesaId) {
    return;
  }

  // Lock the mesa row to prevent race conditions
  const mesaLocked = await tx
    .select()
    .from(schema.mesas)
    .where(eq(schema.mesas.id, mesaId))
    .for("update");

  if (mesaLocked.length === 0) {
    return;
  }

  // Count remaining open non-delivery comandas for this mesa and restaurant
  const openComandasCount = await tx
    .select()
    .from(schema.comandas)
    .where(
      and(
        eq(schema.comandas.mesaId, mesaId),
        eq(schema.comandas.restauranteId, restauranteId),
        eq(schema.comandas.status, "aberta"),
        ne(schema.comandas.tipo, "delivery")
      )
    );

  // If no open comandas remain, mark mesa as available
  if (openComandasCount.length === 0) {
    await tx
      .update(schema.mesas)
      .set({ status: "disponivel" })
      .where(eq(schema.mesas.id, mesaId));
  }
}
