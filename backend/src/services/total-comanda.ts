/**
 * Total da comanda.
 *
 * Única definição de "o que conta como venda": pedidos que NÃO estão cancelados.
 * Todo cálculo de total (fechamento, pagamentos, divisão de conta, totais gravados
 * na comanda) deve passar por aqui ou usar o mesmo filtro.
 */
import { eq, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";

export const STATUS_PEDIDO_CANCELADO = "cancelado";

/**
 * Soma quantidade x preço unitário dos pedidos não cancelados de uma comanda.
 * `executor` é o banco (app.db) ou uma transação (tx).
 */
export async function subtotalDaComanda(executor: any, comandaId: string): Promise<number> {
  const linhas = await executor
    .select({
      total: sql<string>`COALESCE(SUM(${schema.pedidos.quantidade} * CAST(${schema.pedidos.precoUnitario} AS DECIMAL(10,2))) FILTER (WHERE ${schema.pedidos.status} <> 'cancelado'), 0)`,
    })
    .from(schema.pedidos)
    .where(eq(schema.pedidos.comandaId, comandaId));
  return parseFloat(String(linhas[0]?.total ?? "0"));
}
