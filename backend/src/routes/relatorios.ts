import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, sum, count, gte, lt, ne, and, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";

export function registerRelatoriosRoutes(app: App) {
  // GET /api/relatorios/resumo - Summary/Dashboard
  app.fastify.get(
    "/api/relatorios/resumo",
    {
      schema: {
        description: "Get summary/dashboard data (requires authentication)",
        tags: ["relatorios"],
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
          401: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      // Revenue and business metrics are management-level information —
      // garcom/cozinheiro should not see the restaurant's financials.
      if (!requireRole(authUser, ["administrador", "gerente"], reply)) return;

      try {
        const tenantId = requireTenant(authUser);
        app.logger.info({ tenantId }, "Getting resumo");

        // --- Period filter ---
        const query = request.query as {
          periodo?: string;
          dataInicio?: string;
          dataFim?: string;
        };
        const periodo = (query.periodo || "hoje") as "hoje" | "7dias" | "mes" | "personalizado";
        const dataInicio = query.dataInicio;
        const dataFim = query.dataFim;

        const now = new Date();
        let inicio: Date;
        let fim: Date = now;
        let periodoLabel: string;

        if (periodo === "hoje") {
          inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          periodoLabel = "Hoje";
        } else if (periodo === "7dias") {
          inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
          periodoLabel = "Últimos 7 dias";
        } else if (periodo === "mes") {
          inicio = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
          periodoLabel = "Este mês";
        } else {
          if (!dataInicio || !dataFim) {
            return reply.code(400).send({ error: "dataInicio e dataFim são obrigatórios para periodo=personalizado" });
          }
          const di = new Date(dataInicio);
          const df = new Date(dataFim);
          inicio = new Date(di.getFullYear(), di.getMonth(), di.getDate(), 0, 0, 0, 0);
          fim = new Date(df.getFullYear(), df.getMonth(), df.getDate(), 23, 59, 59, 999);
          const fmt = (d: Date) =>
            `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
          periodoLabel = `${fmt(inicio)} – ${fmt(fim)}`;
        }

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

        // Receita no período
        const receitaPeriodoComandasResult = await app.db
          .select({ total: sum(schema.comandas.subtotal) })
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.restauranteId, tenantId as any),
            eq(schema.comandas.status, "fechada"),
            gte(schema.comandas.closedAt, inicio),
            lt(schema.comandas.closedAt, fim)
          ));
        const receitaPeriodoHistoricoResult = await app.db
          .select({ total: sum(schema.comandasHistorico.subtotal) })
          .from(schema.comandasHistorico)
          .where(and(
            eq(schema.comandasHistorico.restauranteId, tenantId as any),
            eq(schema.comandasHistorico.status, "fechada"),
            gte(schema.comandasHistorico.closedAt, inicio),
            lt(schema.comandasHistorico.closedAt, fim)
          ));
        const receitaPeriodo =
          parseFloat(receitaPeriodoComandasResult[0]?.total || "0") +
          parseFloat(receitaPeriodoHistoricoResult[0]?.total || "0");

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

        // Average ticket — period-filtered
        const avgTicketComandasResult = await app.db
          .select({ total: sum(schema.comandas.subtotal), cnt: count() })
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.restauranteId, tenantId as any),
            eq(schema.comandas.status, "fechada"),
            gte(schema.comandas.closedAt, inicio),
            lt(schema.comandas.closedAt, fim)
          ));
        const avgTicketHistoricoResult = await app.db
          .select({ total: sum(schema.comandasHistorico.subtotal), cnt: count() })
          .from(schema.comandasHistorico)
          .where(and(
            eq(schema.comandasHistorico.restauranteId, tenantId as any),
            eq(schema.comandasHistorico.status, "fechada"),
            gte(schema.comandasHistorico.closedAt, inicio),
            lt(schema.comandasHistorico.closedAt, fim)
          ));
        const avgTicketTotal =
          parseFloat(avgTicketComandasResult[0]?.total || "0") +
          parseFloat(avgTicketHistoricoResult[0]?.total || "0");
        const avgTicketCount =
          (avgTicketComandasResult[0]?.cnt || 0) +
          (avgTicketHistoricoResult[0]?.cnt || 0);
        const avgTicket = avgTicketCount > 0 ? avgTicketTotal / avgTicketCount : 0;

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
              AND p.created_at >= ${inicio.toISOString()}::timestamptz
              AND p.created_at < ${fim.toISOString()}::timestamptz
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
              WHERE restaurante_id = ${tenantId}::uuid AND prato_nome IS NOT NULL
              AND created_at >= ${inicio.toISOString()}::timestamptz
              AND created_at < ${fim.toISOString()}::timestamptz
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

        // Orders by status - from both tables combined, period-filtered
        const comandasStatusResult = await app.db
          .select({ status: schema.comandas.status, count: count() })
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.restauranteId, tenantId as any),
            gte(schema.comandas.createdAt, inicio),
            lt(schema.comandas.createdAt, fim)
          ))
          .groupBy(schema.comandas.status);

        const comandasHistoricoStatusResult = await app.db
          .select({ status: schema.comandasHistorico.status, count: count() })
          .from(schema.comandasHistorico)
          .where(and(
            eq(schema.comandasHistorico.restauranteId, tenantId as any),
            gte(schema.comandasHistorico.createdAt, inicio),
            lt(schema.comandasHistorico.createdAt, fim)
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
            tenantId, totalMesas, mesasOcupadas, comandasAbertas, pedidosPendentes, receitaPeriodo, periodoLabel,
            totalRevenue, comandasHistoricoCount, totalOrders, openOrders, avgTicket, topDishesCount: topDishes.length
          },
          "Resumo retrieved successfully"
        );

        return reply.code(200).send({
          total_mesas: totalMesas,
          mesas_ocupadas: mesasOcupadas,
          comandas_abertas: comandasAbertas,
          pedidos_pendentes: pedidosPendentes,
          receita_periodo: receitaPeriodo,
          periodo_label: periodoLabel,
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
