import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, sql, desc, and } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import { realtimeHub } from "../realtime/hub.js";
import { cancelarPedido, MOTIVOS_CANCELAMENTO, ROLES_ATENDIMENTO } from "../services/cancelamento-pedido.js";

interface CreatePedidoBody {
  comanda_id?: string;
  comandaId?: string;
  prato_id?: string;
  pratoId?: string;
  quantidade?: number;
  observacao?: string;
}

interface UpdatePedidoStatusBody {
  status: string;
}

// Helper function to normalize decimal values (comma to dot)
function normalizeDecimal(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value.replace(',', '.'));
  return value;
}

export function registerOrderItemRoutes(app: App) {
  // GET /api/pedidos - List all pedidos for authenticated user
  app.fastify.get<{ Querystring: { comanda_id?: string } }>(
    "/api/pedidos",
    {
      schema: {
        description: "List all pedidos for authenticated user (requires authentication)",
        tags: ["pedidos"],
        querystring: {
          type: "object",
          properties: {
            comanda_id: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              pedidos: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    comanda_id: { type: "string", format: "uuid" },
                    prato_id: { type: "string", format: "uuid", nullable: true },
                    prato_nome: { type: "string", nullable: true },
                    quantidade: { type: "number" },
                    preco_unitario: { type: "string" },
                    observacao: { type: "string", nullable: true },
                    status: { type: "string" },
                    created_at: { type: "string", format: "date-time" },
                    mesa_numero: { type: "number" },
                    comanda_status: { type: "string" },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { comanda_id?: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const authUserId = authUser.id;
        const userRole = authUser.role?.toLowerCase() ?? "";
        const isManager = ["gerente", "admin", "administrador"].includes(userRole);
        const comandaIdFilter = request.query.comanda_id;

        app.logger.info({ authUserId, userRole, isManager, comandaIdFilter }, "Listing pedidos for user");

        const restauranteId = requireTenant(authUser);
        if (!restauranteId) {
          return reply.code(401).send({ error: "Nenhum restaurante associado" });
        }

        const tenantCondition = eq(schema.comandas.restauranteId, restauranteId);

        let whereCondition;
        if (comandaIdFilter) {
          // comanda_id filter: return all pedidos for that comanda within the tenant
          whereCondition = and(
            tenantCondition,
            eq(schema.pedidos.comandaId, comandaIdFilter)
          );
        } else if (isManager) {
          // Manager: all pedidos for the restaurant
          whereCondition = tenantCondition;
        } else {
          // Garcom: only their own comandas, scoped to tenant
          whereCondition = and(
            tenantCondition,
            eq(schema.comandas.garcomId, authUserId)
          );
        }

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
            pratoDescricao: schema.pratos.descricao,
            pratoImagem: schema.pratos.imagemUrl,
            mesaNumero: schema.mesas.numero,
            comandaStatus: schema.comandas.status,
            garcomId: schema.comandas.garcomId,
          })
          .from(schema.pedidos)
          .innerJoin(schema.comandas, eq(schema.pedidos.comandaId, schema.comandas.id))
          .leftJoin(schema.mesas, eq(schema.mesas.id, schema.comandas.mesaId))
          .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
          .where(whereCondition)
          .orderBy(desc(schema.pedidos.createdAt));

        app.logger.info({ count: pedidos.length }, "Pedidos retrieved");

        return reply.code(200).send({
          pedidos: pedidos.map((p) => ({
            id: p.id,
            comanda_id: p.comandaId,
            prato_id: p.pratoId,
            quantidade: p.quantidade,
            preco_unitario: p.precoUnitario,
            observacao: p.observacao,
            status: p.status,
            created_at: p.createdAt ? new Date(p.createdAt).toISOString() : null,
            prato_nome: p.pratoNome,
            prato_descricao: p.pratoDescricao,
            prato_imagem: p.pratoImagem,
            mesa_numero: p.mesaNumero,
            comanda_status: p.comandaStatus,
            garcom_id: p.garcomId,
          })),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list pedidos");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/pedidos - Create a new pedido
  app.fastify.post<{ Body: CreatePedidoBody }>(
    "/api/pedidos",
    {
      schema: {
        description: "Create a new pedido",
        tags: ["pedidos"],
        body: {
          type: "object",
          required: ["comanda_id", "prato_id"],
          properties: {
            comanda_id: { type: "string", format: "uuid" },
            comandaId: { type: "string", format: "uuid" },
            prato_id: { type: "string", format: "uuid" },
            pratoId: { type: "string", format: "uuid" },
            quantidade: { type: "number" },
            observacao: { type: "string", nullable: true },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              pedido: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  comanda_id: { type: "string" },
                  prato_id: { type: "string" },
                  quantidade: { type: "number" },
                  preco_unitario: { type: "string" },
                  observacao: { type: "string", nullable: true },
                  status: { type: "string" },
                  created_at: { type: "string" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreatePedidoBody }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const comandaId = request.body.comanda_id || request.body.comandaId;
        const pratoId = request.body.prato_id || request.body.pratoId;

        if (!comandaId || !pratoId) {
          return reply.code(400).send({ error: "comanda_id and prato_id are required" });
        }

        const restauranteId = requireTenant(session);
        if (!restauranteId) {
          return reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        app.logger.info({ comandaId, pratoId, restauranteId }, "Creating pedido");

        // Look up prato to get price
        const prato = await app.db
          .select()
          .from(schema.pratos)
          .where(eq(schema.pratos.id, pratoId))
          .limit(1);

        if (!prato.length) {
          return reply.code(404).send({ error: "Prato not found" });
        }

        // Check if comanda exists
        const comanda = await app.db
          .select()
          .from(schema.comandas)
          .where(eq(schema.comandas.id, comandaId))
          .limit(1);

        if (!comanda.length) {
          return reply.code(404).send({ error: "Comanda not found" });
        }

        const quantidade = request.body.quantidade || 1;
        const precoUnitario = prato[0].preco;
        const itemTotal = parseFloat(precoUnitario) * quantidade;

        const [pedido] = await app.db
          .insert(schema.pedidos)
          .values({
            comandaId,
            pratoId,
            quantidade,
            precoUnitario,
            observacao: request.body.observacao,
            status: "pendente",
            restauranteId,
          })
          .returning();

        // Update comanda total
        const subtotalResult = await app.db
          .select({
            subtotal: sql<string>`COALESCE(SUM(quantidade * preco_unitario) FILTER (WHERE status <> 'cancelado'), 0)`,
          })
          .from(schema.pedidos)
          .where(eq(schema.pedidos.comandaId, comandaId));

        const subtotalValue = subtotalResult[0]?.subtotal || "0";
        const subtotal = parseFloat(String(subtotalValue));

        const comandaData = await app.db
          .select({ gorjeta: schema.comandas.gorjeta })
          .from(schema.comandas)
          .where(eq(schema.comandas.id, comandaId));

        const gorjetaValue = comandaData[0]?.gorjeta || "0";
        const gorjeta = parseFloat(String(gorjetaValue));
        const newTotal = (subtotal + gorjeta).toFixed(2);

        await app.db
          .update(schema.comandas)
          .set({ subtotal: subtotal.toString(), total: newTotal })
          .where(eq(schema.comandas.id, comandaId));

        app.logger.info({ pedidoId: pedido.id }, "Pedido created successfully");

        // Publish realtime event
        try {
          realtimeHub.publish(restauranteId, {
            type: "pedido.created",
            entityId: pedido.id,
            occurredAt: new Date().toISOString(),
          });
        } catch (err) {
          app.logger.error({ err }, "Failed to publish pedido.created event");
        }

        return reply.code(201).send({
          pedido: {
            id: pedido.id,
            comanda_id: pedido.comandaId,
            prato_id: pedido.pratoId,
            quantidade: pedido.quantidade,
            preco_unitario: pedido.precoUnitario,
            observacao: pedido.observacao,
            status: pedido.status,
            created_at: pedido.createdAt.toISOString(),
          },
        });
      } catch (error) {
        app.logger.error({ err: error, body: request.body }, "Failed to create pedido");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/pedidos/:id - Get a pedido
  app.fastify.get<{ Params: { id: string } }>(
    "/api/pedidos/:id",
    {
      schema: {
        description: "Get a pedido by ID",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              comanda_id: { type: "string", format: "uuid" },
              prato_id: { type: "string", format: "uuid", nullable: true },
              prato_nome: { type: "string" },
              mesa_numero: { type: ["number", "null"] },
              quantidade: { type: "number" },
              preco_unitario: { type: "string" },
              observacao: { type: "string", nullable: true },
              status: { type: "string" },
              created_at: { type: "string", format: "date-time" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ pedidoId: request.params.id }, "Getting pedido");

        const pedidos = await app.db
          .select({
            id: schema.pedidos.id,
            comandaId: schema.pedidos.comandaId,
            pratoId: schema.pedidos.pratoId,
            pratoNome: schema.pratos.nome,
            quantidade: schema.pedidos.quantidade,
            precoUnitario: schema.pedidos.precoUnitario,
            observacao: schema.pedidos.observacao,
            status: schema.pedidos.status,
            createdAt: schema.pedidos.createdAt,
            mesaNumero: schema.comandas.mesaNumero,
          })
          .from(schema.pedidos)
          .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
          .leftJoin(schema.comandas, eq(schema.pedidos.comandaId, schema.comandas.id))
          .where(eq(schema.pedidos.id, request.params.id));

        if (!pedidos.length) {
          return reply.code(404).send({ error: "Pedido not found" });
        }

        const p = pedidos[0];
        return reply.code(200).send({
          id: p.id,
          comanda_id: p.comandaId,
          prato_id: p.pratoId,
          prato_nome: p.pratoNome || "Desconhecido",
          mesa_numero: p.mesaNumero,
          quantidade: p.quantidade,
          preco_unitario: p.precoUnitario,
          observacao: p.observacao,
          status: p.status,
          created_at: p.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get pedido");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/pedidos/:id/status - Update pedido status
  app.fastify.put<{ Params: { id: string }; Body: UpdatePedidoStatusBody }>(
    "/api/pedidos/:id/status",
    {
      schema: {
        description: "Update pedido status",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["pendente", "em_preparo", "pronto", "entregue", "cancelado"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              comandaId: { type: "string" },
              pratoId: { type: "string" },
              quantidade: { type: "number" },
              precoUnitario: { type: "string" },
              observacao: { type: "string", nullable: true },
              status: { type: "string" },
              createdAt: { type: "string" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdatePedidoStatusBody }>,
      reply: FastifyReply
    ) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ pedidoId: request.params.id, status: request.body.status }, "Updating pedido status");

        const restauranteIdAtual = requireTenant(session);
        if (!restauranteIdAtual) {
          return reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        // Cancelar tem rota própria (motivo obrigatório, permissões e registro de quem cancelou)
        if (request.body.status === "cancelado") {
          return reply.code(400).send({ error: "Para cancelar um item use PUT /api/pedidos/:id/cancelar (motivo obrigatório)." });
        }

        const existing = await app.db
          .select()
          .from(schema.pedidos)
          .where(and(eq(schema.pedidos.id, request.params.id), eq(schema.pedidos.restauranteId, restauranteIdAtual)));

        if (!existing.length) {
          return reply.code(404).send({ error: "Pedido not found" });
        }

        if (existing[0].status === "cancelado") {
          return reply.code(409).send({ error: "Item cancelado não pode mudar de status." });
        }

        const [updated] = await app.db
          .update(schema.pedidos)
          .set({ status: request.body.status as any })
          .where(eq(schema.pedidos.id, request.params.id))
          .returning();

        app.logger.info({ pedidoId: updated.id }, "Pedido status updated successfully");

        // Publish realtime event, enriched with mesa/prato info so clients
        // (e.g. the garcom-facing "prato pronto" notification) don't need a
        // follow-up fetch just to render something useful.
        try {
          const restauranteId = requireTenant(session);

          let mesaNumero: number | null = null;
          let pratoNome: string | null = null;
          try {
            const [enriched] = await app.db
              .select({
                mesaNumero: schema.comandas.mesaNumero,
                pratoNome: schema.pratos.nome,
              })
              .from(schema.pedidos)
              .innerJoin(schema.comandas, eq(schema.pedidos.comandaId, schema.comandas.id))
              .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
              .where(eq(schema.pedidos.id, updated.id))
              .limit(1);
            if (enriched) {
              mesaNumero = enriched.mesaNumero;
              pratoNome = enriched.pratoNome;
            }
          } catch (enrichErr) {
            app.logger.warn({ err: enrichErr }, "Failed to enrich pedido.status_changed event, publishing minimal payload");
          }

          realtimeHub.publish(restauranteId, {
            type: "pedido.status_changed",
            entityId: updated.id,
            occurredAt: new Date().toISOString(),
            payload: {
              status: updated.status,
              comanda_id: updated.comandaId,
              mesa_numero: mesaNumero,
              prato_nome: pratoNome,
            },
          });
        } catch (err) {
          app.logger.error({ err }, "Failed to publish pedido.status_changed event");
        }

        return reply.code(200).send({
          id: updated.id,
          comandaId: updated.comandaId,
          pratoId: updated.pratoId,
          quantidade: updated.quantidade,
          precoUnitario: updated.precoUnitario,
          observacao: updated.observacao,
          status: updated.status,
          createdAt: updated.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update pedido status");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/pedidos/:id/cancelar - Cancela um item (item cancelado não é venda)
  app.fastify.put<{ Params: { id: string }; Body: { motivo: string; detalhe?: string } }>(
    "/api/pedidos/:id/cancelar",
    {
      schema: {
        description:
          "Cancela um item de uma comanda aberta. Item cancelado não conta como venda. Itens pendentes podem ser cancelados por garçom, gerente ou administrador; itens já em preparo ou prontos, só por gerente ou administrador (ficam marcados como perda). Item entregue não pode ser cancelado.",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["motivo"],
          properties: {
            motivo: { type: "string", enum: [...MOTIVOS_CANCELAMENTO] },
            detalhe: { type: "string", maxLength: 300 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              id: { type: "string" },
              comanda_id: { type: "string" },
              status: { type: "string" },
              cancelado_apos_inicio: { type: "boolean" },
              subtotal_comanda: { type: "number" },
              total_comanda: { type: "number" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { motivo: string; detalhe?: string } }>,
      reply: FastifyReply
    ) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      // Cozinheiro não cancela item: só garçom e papéis gerenciais
      if (!requireRole(session, ROLES_ATENDIMENTO, reply)) return;

      try {
        const restauranteId = requireTenant(session);
        if (!restauranteId) {
          return reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        const detalhe = request.body.detalhe?.trim() || null;
        if (request.body.motivo === "outro" && !detalhe) {
          return reply.code(400).send({ error: "Informe o detalhe do motivo quando o motivo for 'outro'." });
        }

        const resultado = await cancelarPedido(app, {
          restauranteId,
          pedidoId: request.params.id,
          motivo: request.body.motivo as any,
          detalhe,
          canceladoPor: { id: session.id, nome: session.name, role: session.role },
        });

        switch (resultado.tipo) {
          case "nao_encontrado":
            return reply.code(404).send({ error: "Pedido not found" });
          case "comanda_nao_aberta":
            return reply.code(409).send({ error: "Só é possível cancelar itens de uma comanda aberta." });
          case "ja_cancelado":
            return reply.code(409).send({ error: "Item já está cancelado." });
          case "ja_entregue":
            return reply.code(409).send({ error: "Item já entregue não pode ser cancelado. Cortesia e estorno ainda não estão disponíveis." });
          case "requer_gestor":
            return reply.code(403).send({ error: "Só gerente ou administrador pode cancelar um item que já está em preparo ou pronto." });
        }

        return reply.code(200).send({
          success: true,
          id: resultado.pedidoId,
          comanda_id: resultado.comandaId,
          status: "cancelado",
          cancelado_apos_inicio: resultado.canceladoAposInicio,
          subtotal_comanda: resultado.subtotalComanda,
          total_comanda: resultado.totalComanda,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to cancel pedido");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/pedidos/:id - Update a pedido
  app.fastify.put<{ Params: { id: string }; Body: { quantidade?: number; observacao?: string; status?: string } }>(
    "/api/pedidos/:id",
    {
      schema: {
        description: "Update a pedido (requires authentication)",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          properties: {
            quantidade: { type: "number" },
            observacao: { type: "string" },
            status: { type: "string", enum: ["pendente", "em_preparo", "pronto", "entregue", "cancelado"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              comanda_id: { type: "string", format: "uuid" },
              prato_id: { type: "string", format: "uuid", nullable: true },
              quantidade: { type: "number" },
              preco_unitario: { type: "string" },
              observacao: { type: "string", nullable: true },
              status: { type: "string" },
              createdAt: { type: "string", format: "date-time" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { quantidade?: number; observacao?: string; status?: string } }>,
      reply: FastifyReply
    ) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ pedidoId: request.params.id, body: request.body }, "Updating pedido");

        const restauranteIdAtual = requireTenant(session);
        if (!restauranteIdAtual) {
          return reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        // Cancelar tem rota própria (motivo obrigatório, permissões e registro de quem cancelou)
        if (request.body.status === "cancelado") {
          return reply.code(400).send({ error: "Para cancelar um item use PUT /api/pedidos/:id/cancelar (motivo obrigatório)." });
        }

        const existing = await app.db
          .select()
          .from(schema.pedidos)
          .where(and(eq(schema.pedidos.id, request.params.id), eq(schema.pedidos.restauranteId, restauranteIdAtual)));

        if (!existing.length) {
          return reply.code(404).send({ error: "Pedido not found" });
        }

        if (existing[0].status === "cancelado") {
          return reply.code(409).send({ error: "Item cancelado não pode ser alterado." });
        }

        const pedido = existing[0];
        const updates: any = {};

        if (request.body.quantidade !== undefined) {
          updates.quantidade = request.body.quantidade;
        }
        if (request.body.observacao !== undefined) {
          updates.observacao = request.body.observacao;
        }
        if (request.body.status !== undefined) {
          updates.status = request.body.status as any;
        }

        const [updated] = await app.db
          .update(schema.pedidos)
          .set(updates)
          .where(eq(schema.pedidos.id, request.params.id))
          .returning();

        // Recalculate and update parent comanda's total
        const subtotalResult = await app.db
          .select({
            subtotal: sql<string>`COALESCE(SUM(quantidade * preco_unitario) FILTER (WHERE status <> 'cancelado'), 0)`,
          })
          .from(schema.pedidos)
          .where(eq(schema.pedidos.comandaId, pedido.comandaId));

        const subtotalValue = subtotalResult[0]?.subtotal || "0";
        const subtotal = parseFloat(String(subtotalValue));

        const gorjetaResult = await app.db
          .select({ gorjeta: schema.comandas.gorjeta })
          .from(schema.comandas)
          .where(eq(schema.comandas.id, pedido.comandaId));

        const gorjetaValue = gorjetaResult[0]?.gorjeta || "0";
        const gorjeta = parseFloat(String(gorjetaValue));
        const newTotal = (subtotal + gorjeta).toFixed(2);

        await app.db
          .update(schema.comandas)
          .set({ subtotal: subtotal.toString(), total: newTotal })
          .where(eq(schema.comandas.id, pedido.comandaId));

        app.logger.info({ pedidoId: updated.id }, "Pedido updated successfully");

        // Publish realtime event if status changed
        try {
          const restauranteId = requireTenant(session);
          if (request.body.status !== undefined && request.body.status !== pedido.status) {
            realtimeHub.publish(restauranteId, {
              type: "pedido.status_changed",
              entityId: updated.id,
              occurredAt: new Date().toISOString(),
              payload: { new_status: request.body.status, old_status: pedido.status },
            });
          } else {
            realtimeHub.publish(restauranteId, {
              type: "pedido.updated",
              entityId: updated.id,
              occurredAt: new Date().toISOString(),
              payload: { quantidade: request.body.quantidade, observacao: request.body.observacao },
            });
          }
        } catch (pubErr) {
          app.logger.debug({ err: pubErr }, "Failed to publish pedido event");
        }

        return reply.code(200).send({
          id: updated.id,
          comanda_id: updated.comandaId,
          prato_id: updated.pratoId,
          quantidade: updated.quantidade,
          preco_unitario: updated.precoUnitario.toString(),
          observacao: updated.observacao,
          status: updated.status,
          createdAt: updated.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update pedido");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/pedidos/:id - Delete a pedido
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/pedidos/:id",
    {
      schema: {
        description: "Delete a pedido (requires authentication)",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          204: {},
          404: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const restauranteId = requireTenant(session);
        if (!restauranteId) {
          return reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        app.logger.info({ pedidoId: request.params.id, restauranteId }, "Deleting pedido");

        // Step a: Fetch the pedido (somente do restaurante de quem chama)
        const existing = await app.db
          .select()
          .from(schema.pedidos)
          .where(and(eq(schema.pedidos.id, request.params.id), eq(schema.pedidos.restauranteId, restauranteId)));

        if (!existing.length) {
          return reply.code(404).send({ error: "Pedido not found" });
        }

        const pedido = existing[0];

        // Step b: Fetch prato nome
        let pratoNome: string | null = null;
        if (pedido.pratoId) {
          const pratoResult = await app.db
            .select({ nome: schema.pratos.nome })
            .from(schema.pratos)
            .where(eq(schema.pratos.id, pedido.pratoId));

          if (pratoResult.length) {
            pratoNome = pratoResult[0].nome;
          }
        }

        // Step c: Delete the pedido
        await app.db.delete(schema.pedidos).where(eq(schema.pedidos.id, request.params.id));

        // Publish realtime event for pedido.deleted
        try {
          realtimeHub.publish(restauranteId, {
            type: "pedido.deleted",
            entityId: request.params.id,
            occurredAt: new Date().toISOString(),
            payload: { comanda_id: pedido.comandaId, prato_id: pedido.pratoId },
          });
        } catch (pubErr) {
          app.logger.debug({ err: pubErr }, "Failed to publish pedido.deleted event");
        }

        // Step d: Recalculate and update parent comanda's total
        const subtotalResult = await app.db
          .select({
            subtotal: sql<string>`COALESCE(SUM(quantidade * preco_unitario) FILTER (WHERE status <> 'cancelado'), 0)`,
          })
          .from(schema.pedidos)
          .where(eq(schema.pedidos.comandaId, pedido.comandaId));

        const subtotalValue = subtotalResult[0]?.subtotal || "0";
        const subtotal = parseFloat(String(subtotalValue));

        const gorjetaResult = await app.db
          .select({ gorjeta: schema.comandas.gorjeta })
          .from(schema.comandas)
          .where(eq(schema.comandas.id, pedido.comandaId));

        const gorjetaValue = gorjetaResult[0]?.gorjeta || "0";
        const gorjeta = parseFloat(String(gorjetaValue));
        const newTotal = (subtotal + gorjeta).toFixed(2);

        await app.db
          .update(schema.comandas)
          .set({ subtotal: subtotal.toString(), total: newTotal })
          .where(eq(schema.comandas.id, pedido.comandaId));

        // Step e: Check remaining pedidos count
        const remainingPedidos = await app.db
          .select()
          .from(schema.pedidos)
          .where(eq(schema.pedidos.comandaId, pedido.comandaId));

        const remainingCount = remainingPedidos.length;

        // Step f: If no more pedidos, archive the comanda and pedido
        if (remainingCount === 0) {
          // Fetch the comanda with denormalized mesa_numero
          const comandaInfo = await app.db
            .select({
              id: schema.comandas.id,
              mesaId: schema.comandas.mesaId,
              garcomId: schema.comandas.garcomId,
              status: schema.comandas.status,
              total: schema.comandas.total,
              createdAt: schema.comandas.createdAt,
              closedAt: schema.comandas.closedAt,
              mesaNumero: schema.comandas.mesaNumero,
            })
            .from(schema.comandas)
            .where(eq(schema.comandas.id, pedido.comandaId));

          if (comandaInfo.length) {
            const comanda = comandaInfo[0];

            // Archive comanda and pedido using Drizzle ORM
            await app.db.insert(schema.comandasHistorico).values({
              id: comanda.id,
              mesaId: comanda.mesaId,
              mesaNumero: comanda.mesaNumero,
              garcomId: comanda.garcomId,
              status: comanda.status,
              total: comanda.total as any,
              createdAt: comanda.createdAt,
              closedAt: comanda.closedAt,
              archivedAt: new Date(),
              restauranteId,
            });

            await app.db.insert(schema.pedidosHistorico).values({
              id: pedido.id,
              comandaId: pedido.comandaId,
              pratoId: pedido.pratoId,
              pratoNome,
              quantidade: pedido.quantidade,
              precoUnitario: pedido.precoUnitario as any,
              observacao: pedido.observacao,
              status: pedido.status,
              createdAt: pedido.createdAt,
              archivedAt: new Date(),
              restauranteId,
            });

            await app.db.delete(schema.comandas).where(eq(schema.comandas.id, pedido.comandaId));

            await app.db
              .update(schema.mesas)
              .set({ status: "disponivel" })
              .where(eq(schema.mesas.id, comanda.mesaId));

            app.logger.info(
              { pedidoId: request.params.id, comandaId: pedido.comandaId },
              "Pedido deleted and comanda archived"
            );

            return reply.code(204).send();
          }
        }

        app.logger.info({ pedidoId: request.params.id }, "Pedido deleted successfully");

        return reply.code(204).send();
      } catch (error) {
        app.logger.error({ err: error }, "Failed to delete pedido");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
