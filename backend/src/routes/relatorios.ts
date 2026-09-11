import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, sum, count, gte, lt, ne, and, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";

interface ResumoPeriodo {
  periodo: "hoje" | "7dias" | "mes" | "personalizado";
  dataInicio?: string;
  dataFim?: string;
}

function formatDateDDMMYYYY(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getPeriodBoundaries(queryPeriodo: any): { inicio: Date; fim: Date; label: string } | null {
  const periodo = queryPeriodo?.periodo || "hoje";
  const now = new Date();
  let inicio: Date;
  let fim: Date;
  let label: string;

  if (periodo === "hoje") {
    inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    fim = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    label = formatDateDDMMYYYY(inicio);
  } else if (periodo === "7dias") {
    const sixDaysAgo = new Date(now);
    sixDaysAgo.setDate(now.getDate() - 6);
    inicio = new Date(sixDaysAgo.getFullYear(), sixDaysAgo.getMonth(), sixDaysAgo.getDate(), 0, 0, 0, 0);
    fim = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    label = `${formatDateDDMMYYYY(inicio)} – ${formatDateDDMMYYYY(fim)}`;
  } else if (periodo === "mes") {
    inicio = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    fim = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    label = `${formatDateDDMMYYYY(inicio)} – ${formatDateDDMMYYYY(fim)}`;
  } else if (periodo === "personalizado") {
    const dataInicio = queryPeriodo?.dataInicio;
    const dataFim = queryPeriodo?.dataFim;

    if (!dataInicio || !dataFim) {
      return null;
    }

    try {
      const startDate = new Date(dataInicio);
      const endDate = new Date(dataFim);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return null;
      }

      inicio = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0);
      fim = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999);
      label = `${formatDateDDMMYYYY(inicio)} – ${formatDateDDMMYYYY(fim)}`;
    } catch {
      return null;
    }
  } else {
    return null;
  }

  return { inicio, fim, label };
}

export function registerRelatoriosRoutes(app: App) {
  // GET /api/relatorios/resumo - Summary/Dashboard
  app.fastify.get(
    "/api/relatorios/resumo",
    {
      schema: {
        description: "Get summary/dashboard data with period filtering (requires administrador or gerente role)",
        tags: ["relatorios"],
        querystring: {
          type: "object",
          properties: {
            periodo: {
              type: "string",
              enum: ["hoje", "7dias", "mes", "personalizado"],
              description: "Time period filter",
            },
            dataInicio: {
              type: "string",
              description: "Start date in ISO 8601 format (required when periodo=personalizado)",
            },
            dataFim: {
              type: "string",
              description: "End date in ISO 8601 format (required when periodo=personalizado)",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              total_mesas: { type: "number" },
              mesas_ocupadas: { type: "number" },
              comandas_abertas: { type: "number" },
              pedidos_pendentes: { type: "number" },
              receita_periodo: { type: "number" },
              periodo_label: { type: "string" },
              total_revenue: { type: "number" },
              comandas_historico: { type: "number" },
              total_orders: { type: "number" },
              open_orders: { type: "number" },
              avg_ticket: { type: "number" },
              top_dishes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    dish_name: { type: "string" },
                    quantity_sold: { type: "number" },
                  },
                },
              },
              orders_by_status: {
                type: "object",
                properties: {
                  aberta: { type: "number" },
                  fechada: { type: "number" },
                  cancelada: { type: "number" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: ResumoPeriodo }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!requireRole(authUser, ["administrador", "gerente"], reply)) return;

      try {
        const tenantId = requireTenant(authUser);

        const periodBoundaries = getPeriodBoundaries(request.query);
        if (!periodBoundaries) {
          app.logger.warn(
            { query: request.query },
            "Invalid periodo or missing dataInicio/dataFim for personalizado"
          );
          return reply.code(400).send({ error: "Invalid period parameters" });
        }

        const { inicio, fim, label } = periodBoundaries;
        app.logger.info({ tenantId, periodo: request.query.periodo, label }, "Getting resumo");

        // Total mesas
        const totalMesasResult = await app.db
          .select({ count: count() })
          .from(schema.mesas)
          .where(eq(schema.mesas.restauranteId, tenantId as any));
        const totalMesas = totalMesasResult[0]?.count || 0;

        // Mesas ocupadas (status != 'disponivel')
        const mesasOcupadasResult = await app.db
          .select({ count: count() })
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.restauranteId, tenantId as any),
            ne(schema.mesas.status, "disponivel")
          ));
        const mesasOcupadas = mesasOcupadasResult[0]?.count || 0;

        // Comandas abertas
        const comandasAbertasResult = await app.db
          .select({ count: count() })
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.restauranteId, tenantId as any),
            eq(schema.comandas.status, "aberta")
          ));
        const comandasAbertas = comandasAbertasResult[0]?.count || 0;

        // Pedidos pendentes (only in open comandas)
        const pedidosPendentesResult = await app.db
          .select({ count: count() })
          .from(schema.pedidos)
          .innerJoin(schema.comandas, eq(schema.pedidos.comandaId, schema.comandas.id))
          .where(
            and(
              eq(schema.pedidos.restauranteId, tenantId as any),
              eq(schema.pedidos.status, "pendente"),
              eq(schema.comandas.status, "aberta")
            )
          );
        const pedidosPendentes = pedidosPendentesResult[0]?.count || 0;

        // Receita periodo - sum from both comandas and comandas_historico
        const receitaPeriodoComandasResult = await app.db
          .select({ total: sum(schema.comandas.subtotal) })
          .from(schema.comandas)
          .where(
            and(
              eq(schema.comandas.restauranteId, tenantId as any),
              eq(schema.comandas.status, "fechada"),
              gte(schema.comandas.closedAt, inicio),
              lt(schema.comandas.closedAt, new Date(fim.getTime() + 1))
            )
          );

        const receitaPeriodoHistoricoResult = await app.db
          .select({ total: sum(schema.comandasHistorico.subtotal) })
          .from(schema.comandasHistorico)
          .where(
            and(
              eq(schema.comandasHistorico.restauranteId, tenantId as any),
              eq(schema.comandasHistorico.status, "fechada"),
              gte(schema.comandasHistorico.closedAt, inicio),
              lt(schema.comandasHistorico.closedAt, new Date(fim.getTime() + 1))
            )
          );

        const receitaPeriodoCom = parseFloat(receitaPeriodoComandasResult[0]?.total || "0");
        const receitaPeriodoHist = parseFloat(receitaPeriodoHistoricoResult[0]?.total || "0");
        const receitaPeriodo = receitaPeriodoCom + receitaPeriodoHist;

        // Total revenue - sum of all closed comandas from both tables
        const totalRevenueComandasResult = await app.db
          .select({ total: sum(schema.comandas.subtotal) })
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.restauranteId, tenantId as any),
            eq(schema.comandas.status, "fechada")
          ));

        const totalRevenueHistoricoResult = await app.db
          .select({ total: sum(schema.comandasHistorico.subtotal) })
          .from(schema.comandasHistorico)
          .where(and(
            eq(schema.comandasHistorico.restauranteId, tenantId as any),
            eq(schema.comandasHistorico.status, "fechada")
          ));

        const totalRevenueCom = parseFloat(totalRevenueComandasResult[0]?.total || "0");
        const totalRevenueHist = parseFloat(totalRevenueHistoricoResult[0]?.total || "0");
        const totalRevenue = totalRevenueCom + totalRevenueHist;

        // Comandas historico count
        const comandasHistoricoCountResult = await app.db
          .select({ count: count() })
          .from(schema.comandasHistorico)
          .where(eq(schema.comandasHistorico.restauranteId, tenantId as any));
        const comandasHistoricoCount = comandasHistoricoCountResult[0]?.count || 0;

        // Total orders - count from both pedidos and pedidos_historico
        const totalPedidosResult = await app.db
          .select({ count: count() })
          .from(schema.pedidos)
          .where(eq(schema.pedidos.restauranteId, tenantId as any));
        const totalPedidosHist = await app.db
          .select({ count: count() })
          .from(schema.pedidosHistorico)
          .where(eq(schema.pedidosHistorico.restauranteId, tenantId as any));
        const totalOrders = (totalPedidosResult[0]?.count || 0) + (totalPedidosHist[0]?.count || 0);

        // Open orders (same as comandasAbertas)
        const openOrders = comandasAbertas;

        // Average ticket - calculate from period revenue and count of closed comandas in period
        const countClosedInPeriodCom = await app.db
          .select({ count: count() })
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.restauranteId, tenantId as any),
            eq(schema.comandas.status, "fechada"),
            gte(schema.comandas.closedAt, inicio),
            lt(schema.comandas.closedAt, new Date(fim.getTime() + 1))
          ));

        const countClosedInPeriodHist = await app.db
          .select({ count: count() })
          .from(schema.comandasHistorico)
          .where(and(
            eq(schema.comandasHistorico.restauranteId, tenantId as any),
            eq(schema.comandasHistorico.status, "fechada"),
            gte(schema.comandasHistorico.closedAt, inicio),
            lt(schema.comandasHistorico.closedAt, new Date(fim.getTime() + 1))
          ));

        const countClosedCom = countClosedInPeriodCom[0]?.count || 0;
        const countClosedHist = countClosedInPeriodHist[0]?.count || 0;
        const totalClosedCount = countClosedCom + countClosedHist;
        const avgTicket = totalClosedCount > 0 ? receitaPeriodo / totalClosedCount : 0;

        // Top 5 dishes - aggregate from both pedidos and pedidos_historico
        let topDishes: Array<{ dish_name: string; quantity_sold: number }> = [];
        try {
          const topDishesFromPedidosResult = await (app.db as any).execute(
            sql`
              SELECT
                pr.nome as dish_name,
                SUM(p.quantidade)::integer as quantity_sold
              FROM pedidos p
              INNER JOIN pratos pr ON p.prato_id = pr.id
              WHERE p.restaurante_id = ${tenantId}::uuid
                AND p.created_at >= ${inicio}
                AND p.created_at < ${new Date(fim.getTime() + 1)}
              GROUP BY pr.nome
              ORDER BY quantity_sold DESC
            `
          ) as any[];

          const topDishesFromHistoricoResult = await (app.db as any).execute(
            sql`
              SELECT
                prato_nome as dish_name,
                SUM(quantidade)::integer as quantity_sold
              FROM pedidos_historico
              WHERE restaurante_id = ${tenantId}::uuid
                AND prato_nome IS NOT NULL
                AND created_at >= ${inicio}
                AND created_at < ${new Date(fim.getTime() + 1)}
              GROUP BY prato_nome
              ORDER BY quantity_sold DESC
            `
          ) as any[];

          // Combine and aggregate results in JavaScript
          const dishMap = new Map<string, number>();

          if (Array.isArray(topDishesFromPedidosResult)) {
            for (const d of topDishesFromPedidosResult) {
              const key = d.dish_name || "Unknown";
              const count = parseInt(String(d.quantity_sold || 0));
              dishMap.set(key, (dishMap.get(key) || 0) + count);
            }
          }

          if (Array.isArray(topDishesFromHistoricoResult)) {
            for (const d of topDishesFromHistoricoResult) {
              const key = d.dish_name || "Unknown";
              const count = parseInt(String(d.quantity_sold || 0));
              dishMap.set(key, (dishMap.get(key) || 0) + count);
            }
          }

          topDishes = Array.from(dishMap.entries())
            .map(([dish_name, quantity_sold]) => ({ dish_name, quantity_sold }))
            .sort((a, b) => b.quantity_sold - a.quantity_sold)
            .slice(0, 5);
        } catch (dishError) {
          app.logger.warn({ err: dishError }, "Failed to get top dishes, using empty array");
          topDishes = [];
        }

        // Orders by status - from both tables combined within the period
        const comandasStatusResult = await app.db
          .select({ status: schema.comandas.status, count: count() })
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.restauranteId, tenantId as any),
            gte(schema.comandas.createdAt, inicio),
            lt(schema.comandas.createdAt, new Date(fim.getTime() + 1))
          ))
          .groupBy(schema.comandas.status);

        const comandasHistoricoStatusResult = await app.db
          .select({ status: schema.comandasHistorico.status, count: count() })
          .from(schema.comandasHistorico)
          .where(and(
            eq(schema.comandasHistorico.restauranteId, tenantId as any),
            gte(schema.comandasHistorico.createdAt, inicio),
            lt(schema.comandasHistorico.createdAt, new Date(fim.getTime() + 1))
          ))
          .groupBy(schema.comandasHistorico.status);

        const statusMap = new Map<string, number>();

        for (const row of comandasStatusResult) {
          const status = row.status || "aberta";
          statusMap.set(status, (statusMap.get(status) || 0) + (row.count || 0));
        }

        for (const row of comandasHistoricoStatusResult) {
          const status = row.status || "aberta";
          statusMap.set(status, (statusMap.get(status) || 0) + (row.count || 0));
        }

        const ordersByStatus = {
          aberta: statusMap.get("aberta") || 0,
          fechada: statusMap.get("fechada") || 0,
          cancelada: statusMap.get("cancelada") || 0,
        };

        app.logger.info(
          {
            tenantId,
            periodo: request.query.periodo,
            totalMesas,
            mesasOcupadas,
            comandasAbertas,
            pedidosPendentes,
            receitaPeriodo,
            totalRevenue,
            comandasHistoricoCount: comandasHistoricoCount,
            totalOrders,
            openOrders,
            avgTicket,
            topDishesCount: topDishes.length,
          },
          "Resumo retrieved successfully"
        );

        return reply.code(200).send({
          total_mesas: totalMesas,
          mesas_ocupadas: mesasOcupadas,
          comandas_abertas: comandasAbertas,
          pedidos_pendentes: pedidosPendentes,
          receita_periodo: receitaPeriodo,
          periodo_label: label,
          total_revenue: totalRevenue,
          comandas_historico: comandasHistoricoCount,
          total_orders: totalOrders,
          open_orders: openOrders,
          avg_ticket: avgTicket,
          top_dishes: topDishes,
          orders_by_status: ordersByStatus,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get resumo");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
