import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, desc, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant } from "../utils/auth.js";

export function registerHistoricoRoutes(app: App) {
  // GET /api/historico - Get all archived comandas with their pedidos
  app.fastify.get(
    "/api/historico",
    {
      schema: {
        description: "Get all archived comandas and their order items (requires authentication)",
        tags: ["historico"],
        response: {
          200: {
            description: "List of archived comandas with pedidos",
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                mesa_id: { type: ["string", "null"], format: "uuid" },
                mesa_numero: { type: ["integer", "null"] },
                garcom_id: { type: ["string", "null"] },
                garcom_nome: { type: "string" },
                status: { type: "string" },
                total: { type: "string" },
                created_at: { type: "string", format: "date-time" },
                closed_at: { type: ["string", "null"], format: "date-time" },
                archived_at: { type: "string", format: "date-time" },
                pedidos: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      prato_id: { type: ["string", "null"], format: "uuid" },
                      prato_nome: { type: ["string", "null"] },
                      quantidade: { type: "integer" },
                      preco_unitario: { type: "string" },
                      observacao: { type: ["string", "null"] },
                      status: { type: "string" },
                      created_at: { type: "string", format: "date-time" },
                      archived_at: { type: "string", format: "date-time" },
                    },
                  },
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

      try {
        const tenantId = requireTenant(authUser);
        app.logger.info({ tenantId }, "Fetching historico");

        // Query comandas_historico filtered by tenant with garcom info
        const comandasQuery = sql`
          SELECT
            ch.id,
            ch.mesa_id,
            ch.mesa_numero,
            ch.garcom_id,
            ch.status,
            ch.total,
            ch.created_at,
            ch.closed_at,
            ch.archived_at,
            COALESCE(u.nome, 'Não informado') as garcom_nome
          FROM comandas_historico ch
          LEFT JOIN usuarios u ON u.id::text = ch.garcom_id
          WHERE ch.restaurante_id = ${tenantId}::uuid
          ORDER BY ch.archived_at DESC
        `;

        const comandas = await (app.db as any).execute(comandasQuery) as any[];

        app.logger.info({ tenantId, count: comandas.length }, "Archived comandas retrieved");

        // For each comanda, fetch its pedidos from pedidos_historico
        const result = await Promise.all(
          comandas.map(async (comanda: any) => {
            const pedidos = await app.db
              .select()
              .from(schema.pedidosHistorico)
              .where(eq(schema.pedidosHistorico.comandaId, comanda.id))
              .then((allPedidos) =>
                allPedidos
                  .filter((p) => p.restauranteId === tenantId)
                  .sort((a, b) => {
                    const dateA = new Date(b.archivedAt).getTime();
                    const dateB = new Date(a.archivedAt).getTime();
                    return dateA - dateB;
                  })
              );

            return {
              id: comanda.id,
              mesa_id: comanda.mesa_id,
              mesa_numero: comanda.mesa_numero,
              garcom_id: comanda.garcom_id,
              garcom_nome: comanda.garcom_nome || "Não informado",
              status: comanda.status,
              total: comanda.total.toString(),
              created_at: new Date(comanda.created_at).toISOString(),
              closed_at: comanda.closed_at ? new Date(comanda.closed_at).toISOString() : null,
              archived_at: new Date(comanda.archived_at).toISOString(),
              pedidos: pedidos.map((p) => ({
                id: p.id,
                prato_id: p.pratoId,
                prato_nome: p.pratoNome,
                quantidade: p.quantidade,
                preco_unitario: p.precoUnitario.toString(),
                observacao: p.observacao,
                status: p.status,
                created_at: p.createdAt.toISOString(),
                archived_at: p.archivedAt.toISOString(),
              })),
            };
          })
        );

        app.logger.info({ tenantId, count: result.length }, "Historico fetched successfully");
        return result;
      } catch (error) {
        app.logger.error({ err: error }, "Failed to fetch historico");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
