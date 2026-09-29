/**
 * Fechamento de comanda.
 *
 * Único módulo responsável pela regra de fechar uma comanda: confere pagamentos,
 * calcula o total, arquiva comanda, pedidos e pagamentos confirmados nas tabelas
 * *_historico (preservando o mesmo UUID), remove os registros ativos, libera a mesa
 * e avisa o tempo real.
 *
 * O módulo não conhece HTTP: recebe dados simples e devolve um resultado com desfecho
 * nomeado. A rota (routes/orders.ts) autentica, confere papéis, lê o corpo e traduz
 * o resultado para HTTP.
 *
 * Contrato de saída (não mudar sem revisar relatórios, histórico e fiscal):
 * - comandas_historico / pedidos_historico / pagamentos_historico mantêm o UUID original;
 * - só pagamentos CONFIRMADOS vão para o histórico;
 * - services/nfce-data.ts lê o histórico quando a comanda viva já não existe.
 *
 * ETAPA A (extração): comportamento idêntico ao do handler anterior, inclusive o que
 * ainda será corrigido nas próximas etapas:
 *  - a comanda é buscada só pelo id, SEM filtrar por restaurante;
 *  - a conferência "está aberta?" acontece FORA da transação;
 *  - o total é a soma de TODOS os pedidos (inclusive cancelados).
 */
import { eq, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { realtimeHub } from "../realtime/hub.js";

export interface QuemFechou {
  id: string;
  nome: string;
  role: string;
}

export interface EntradaFechamento {
  restauranteId: string;
  comandaId: string;
  gorjeta: number;
  fechadoPor: QuemFechou;
}

export interface ItemFechado {
  prato_nome: string;
  quantidade: number;
  preco_unitario: number;
  subtotal_item: number;
}

export interface PagamentoFechado {
  forma_pagamento: string;
  valor: number;
  troco: number;
}

export type ResultadoFechamento =
  | {
      tipo: "fechada";
      mesaNumero: number | null;
      subtotal: number;
      gorjeta: number;
      totalFinal: number;
      createdAt: Date;
      closedAt: Date;
      itens: ItemFechado[];
      pagamentos: PagamentoFechado[];
    }
  | { tipo: "nao_encontrada" }
  | { tipo: "nao_aberta" }
  | { tipo: "pagamentos_pendentes" }
  | { tipo: "pago_a_menos"; totalPago: number; totalDevido: number };

type HubDeEventos = Pick<typeof realtimeHub, "publish">;

export async function fecharComanda(
  app: App,
  entrada: EntradaFechamento,
  hub: HubDeEventos = realtimeHub
): Promise<ResultadoFechamento> {
  const { restauranteId, comandaId, fechadoPor } = entrada;
  const gorjetaValue = entrada.gorjeta;

  // Comanda com o número da mesa (ETAPA A: sem filtro por restaurante, como antes)
  const comandas = await app.db
    .select({
      id: schema.comandas.id,
      mesaId: schema.comandas.mesaId,
      mesaNumero: schema.mesas.numero,
      garcomId: schema.comandas.garcomId,
      status: schema.comandas.status,
      total: schema.comandas.total,
      subtotal: schema.comandas.subtotal,
      createdAt: schema.comandas.createdAt,
    })
    .from(schema.comandas)
    .leftJoin(schema.mesas, eq(schema.mesas.id, schema.comandas.mesaId))
    .where(eq(schema.comandas.id, comandaId));

  if (!comandas.length) {
    return { tipo: "nao_encontrada" };
  }

  const comanda = comandas[0];
  const mesaId = comanda.mesaId;
  app.logger.info({ comandaId, mesaId }, "Comanda found, mesa_id extracted");

  if (comanda.status !== "aberta") {
    return { tipo: "nao_aberta" };
  }

  // Subtotal calculado a partir dos pedidos
  const subtotalResult = await app.db
    .select({
      total: sql<string>`COALESCE(SUM(${schema.pedidos.quantidade} * CAST(${schema.pedidos.precoUnitario} AS DECIMAL(10,2))), 0)`,
    })
    .from(schema.pedidos)
    .where(eq(schema.pedidos.comandaId, comandaId));
  const subtotal = parseFloat(subtotalResult[0]?.total ?? "0");
  app.logger.info({ comandaId, subtotalCalculated: subtotal }, "Subtotal dynamically calculated from pedidos");
  const totalFinal = subtotal + gorjetaValue;

  const createdAt = comanda.createdAt;
  const closedAt = new Date();

  // Pedidos (com nome do prato) antes da transação, para a resposta e o histórico
  const pedidos = await app.db
    .select({
      id: schema.pedidos.id,
      comandaId: schema.pedidos.comandaId,
      pratoId: schema.pedidos.pratoId,
      quantidade: schema.pedidos.quantidade,
      precoUnitario: schema.pedidos.precoUnitario,
      observacao: schema.pedidos.observacao,
      status: schema.pedidos.status,
      createdAt: schema.pedidos.createdAt,
      pratoNome: schema.pratos.nome,
    })
    .from(schema.pedidos)
    .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
    .where(eq(schema.pedidos.comandaId, comandaId));

  const itens: ItemFechado[] = pedidos.map((p) => ({
    prato_nome: p.pratoNome || "N/A",
    quantidade: p.quantidade,
    preco_unitario: parseFloat(p.precoUnitario || "0"),
    subtotal_item: p.quantidade * parseFloat(p.precoUnitario || "0"),
  }));

  // Verificação de pagamentos
  const pagamentosComanda = await app.db
    .select()
    .from(schema.pagamentos)
    .where(eq(schema.pagamentos.comandaId, comandaId));

  const totalPagoConfirmado = pagamentosComanda
    .filter((p: any) => p.status === "confirmado")
    .reduce((sum: number, p: any) => sum + parseFloat(p.valor), 0);

  const pagamentosPendentes = pagamentosComanda.filter((p: any) => p.status === "pendente");

  if (pagamentosPendentes.length > 0) {
    return { tipo: "pagamentos_pendentes" };
  }

  if (pagamentosComanda.length > 0 && totalPagoConfirmado < totalFinal - 0.01) {
    return { tipo: "pago_a_menos", totalPago: totalPagoConfirmado, totalDevido: totalFinal };
  }

  // Arquivamento numa única transação
  await (app.db as any).transaction(async (tx: any) => {
    // Copia a comanda para o histórico com status 'fechada'
    await tx.insert(schema.comandasHistorico).values({
      id: comanda.id,
      mesaId: comanda.mesaId,
      mesaNumero: comanda.mesaNumero,
      garcomId: comanda.garcomId,
      status: "fechada",
      total: totalFinal.toString(),
      subtotal: subtotal.toString(),
      gorjeta: gorjetaValue.toString(),
      createdAt: createdAt,
      closedAt: closedAt,
      archivedAt: closedAt,
      fechadoPorId: fechadoPor.id,
      fechadoPorNome: fechadoPor.nome,
      fechadoPorRole: fechadoPor.role,
      restauranteId,
    });

    // Copia os pedidos para o histórico
    if (pedidos.length > 0) {
      await tx.insert(schema.pedidosHistorico).values(
        pedidos.map((p) => ({
          id: p.id,
          comandaId: p.comandaId,
          pratoId: p.pratoId,
          pratoNome: p.pratoNome,
          quantidade: p.quantidade,
          precoUnitario: p.precoUnitario,
          observacao: p.observacao,
          status: p.status,
          createdAt: p.createdAt,
          archivedAt: closedAt,
          restauranteId,
        }))
      );
    }

    // Copia os pagamentos confirmados para o histórico e apaga os pagamentos da comanda
    if (pagamentosComanda.length > 0) {
      await tx.insert(schema.pagamentosHistorico).values(
        pagamentosComanda
          .filter((p: any) => p.status === "confirmado")
          .map((p: any) => ({
            id: p.id,
            comandaId: p.comandaId,
            formaPagamento: p.formaPagamento,
            status: p.status,
            valor: p.valor,
            troco: p.troco,
            pixTxId: p.pixTxId,
            referencia: p.referencia,
            confirmadoEm: p.confirmadoEm,
            createdAt: p.createdAt,
            archivedAt: closedAt,
            restauranteId,
          }))
      );

      await tx.delete(schema.pagamentos).where(eq(schema.pagamentos.comandaId, comandaId));
    }

    // Grava subtotal e gorjeta na comanda antes de apagá-la
    await tx
      .update(schema.comandas)
      .set({
        subtotal: subtotal.toString(),
        gorjeta: gorjetaValue.toString(),
      })
      .where(eq(schema.comandas.id, comandaId));

    // Apaga pedidos e comanda
    await tx.delete(schema.pedidos).where(eq(schema.pedidos.comandaId, comandaId));
    await tx.delete(schema.comandas).where(eq(schema.comandas.id, comandaId));

    // Depois de arquivar, SEMPRE libera a mesa (quando a comanda tinha mesa)
    if (mesaId) {
      try {
        await tx.update(schema.mesas).set({ status: "disponivel" }).where(eq(schema.mesas.id, mesaId));
        app.logger.info({ mesaId }, "Mesa released to disponivel");
      } catch (err) {
        app.logger.error({ mesaId, error: (err as any).message }, "Failed to release mesa");
        throw err;
      }
    }
  });

  app.logger.info(
    { comandaId, subtotal, gorjeta: gorjetaValue, totalFinal, itemCount: itens.length },
    `[fechar] comanda ${comandaId}: subtotal=${subtotal}, gorjeta=${gorjetaValue}, total=${totalFinal}`
  );

  // Evento de tempo real depois da transação confirmada; falha só vai para o log
  try {
    hub.publish(restauranteId, {
      type: "comanda.closed",
      entityId: comandaId,
      occurredAt: new Date().toISOString(),
    });
  } catch (err) {
    app.logger.error({ err }, "Failed to publish comanda.closed event");
  }

  return {
    tipo: "fechada",
    mesaNumero: comanda.mesaNumero,
    subtotal,
    gorjeta: gorjetaValue,
    totalFinal,
    createdAt,
    closedAt,
    itens,
    pagamentos: pagamentosComanda
      .filter((p: any) => p.status === "confirmado")
      .map((p: any) => ({
        forma_pagamento: p.formaPagamento,
        valor: parseFloat(p.valor),
        troco: parseFloat(p.troco || "0"),
      })),
  };
}
