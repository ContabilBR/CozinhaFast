import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, sql, inArray, or, and } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import { user } from "../db/schema/auth-schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant } from "../utils/auth.js";
import { resolveGarcomId } from "../utils/garcom.js";
import { realtimeHub } from "../realtime/hub.js";

interface CreateComandaBody {
  mesaId?: string;
  mesa_id?: string;
  garcomId?: string;
  garcom_id?: string;
  itens?: Array<{
    prato_id: string;
    quantidade: number;
    preco_unitario: number;
    observacao?: string;
  }>;
}

interface CreatePedidosBody {
  items: Array<{
    prato_id: string;
    quantidade: number;
    observacao?: string;
    preco_unitario: number;
  }>;
}

interface FecharComandaBody {
  gorjeta?: number;
  num_pessoas?: number;
}

export function registerOrderRoutes(app: App) {
  // GET /api/comandas - List all comandas for authenticated user
  app.fastify.get<{ Querystring: { status?: string } }>(
    "/api/comandas",
    {
      schema: {
        description: "List all comandas for authenticated user (requires authentication)",
        tags: ["comandas"],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["aberta", "fechada", "cancelada"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              comandas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    mesa_id: { type: "string", format: "uuid" },
                    mesa_numero: { type: ["number", "null"] },
                    garcom_id: { type: ["string", "null"] },
                    status: { type: "string" },
                    total: { type: "number" },
                    created_at: { type: "string", format: "date-time" },
                    closed_at: { type: ["string", "null"], format: "date-time" },
                    item_count: { type: "number" },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const authUserId = authUser.id;
        const userRole = authUser.role?.toLowerCase() ?? "";
        const isManager = ["gerente", "admin", "administrador"].includes(userRole);

        app.logger.info(
          { authUserId, status: request.query.status, userRole, isManager },
          "Listing comandas for user"
        );

        // Build SQL query with GROUP BY and COUNT, calculating total from pedidos
        let sqlQuery = sql`
          SELECT
            c.id,
            c.mesa_id,
            m.numero AS mesa_numero,
            c.garcom_id,
            c.status,
            c.created_at,
            c.closed_at,
            COUNT(p.id)::integer AS item_count,
            COALESCE(SUM(p.quantidade * p.preco_unitario), 0) as total
          FROM comandas c
          LEFT JOIN mesas m ON m.id = c.mesa_id
          LEFT JOIN pedidos p ON p.comanda_id = c.id
        `;

        const restauranteId = requireTenant(authUser);

        // Add WHERE clause conditionally based on role — always filter by tenant
        if (!isManager) {
          sqlQuery = sql`${sqlQuery} WHERE c.restaurante_id = ${restauranteId}::uuid AND c.garcom_id = ${authUserId}`;
          if (request.query.status) {
            sqlQuery = sql`${sqlQuery} AND c.status = ${request.query.status}`;
          }
        } else {
          sqlQuery = sql`${sqlQuery} WHERE c.restaurante_id = ${restauranteId}::uuid`;
          if (request.query.status) {
            sqlQuery = sql`${sqlQuery} AND c.status = ${request.query.status}`;
          }
        }

        sqlQuery = sql`${sqlQuery}
          GROUP BY c.id, c.mesa_id, m.numero, c.garcom_id, c.status, c.created_at, c.closed_at
          ORDER BY c.created_at DESC
        `;

        const comandas = await (app.db as any).execute(sqlQuery) as any[];

        app.logger.info({ count: comandas.length }, "Comandas retrieved");

        return reply.code(200).send({
          comandas: comandas.map((c: any) => ({
            id: c.id,
            mesa_id: c.mesa_id,
            mesa_numero: Number(c.mesa_numero),
            garcom_id: c.garcom_id,
            status: c.status,
            total: Number(c.total),
            created_at: c.created_at ? new Date(c.created_at).toISOString() : null,
            closed_at: c.closed_at ? new Date(c.closed_at).toISOString() : null,
            item_count: Number(c.item_count),
          })),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list comandas");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/comandas - Open a new comanda for a table
  app.fastify.post<{ Body: CreateComandaBody }>(
    "/api/comandas",
    {
      schema: {
        description: "Open a new comanda for a table with optional items (requires authentication)",
        tags: ["comandas"],
        body: {
          type: "object",
          properties: {
            mesa_id: { type: "string", format: "uuid" },
            mesaId: { type: "string", format: "uuid" },
            garcom_id: { type: "string" },
            garcomId: { type: "string" },
            itens: {
              type: "array",
              items: {
                type: "object",
                required: ["prato_id", "quantidade", "preco_unitario"],
                properties: {
                  prato_id: { type: "string", format: "uuid" },
                  quantidade: { type: "number" },
                  preco_unitario: { type: "number" },
                  observacao: { type: "string" },
                },
              },
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              comanda: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  mesa_id: { type: "string", format: "uuid" },
                  mesa_numero: { type: "number" },
                  garcom_id: { type: "string" },
                  status: { type: "string" },
                  total: { type: "string" },
                  created_at: { type: "string", format: "date-time" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateComandaBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const mesaId = request.body.mesa_id || request.body.mesaId;

        if (!mesaId) {
          return reply.code(400).send({ error: "mesa_id is required" });
        }

        const restauranteId = requireTenant(authUser);
        if (!restauranteId) {
          return reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        // Check if mesa exists
        const mesaRecords = await app.db
          .select()
          .from(schema.mesas)
          .where(eq(schema.mesas.id, mesaId))
          .limit(1);

        if (!mesaRecords.length) {
          return reply.code(404).send({ error: "Mesa not found" });
        }

        const mesa = mesaRecords[0];

        // Store garcom_id as the authenticated user's id (text, stable across deploys)
        const garcomId = authUser.id;

        app.logger.info(
          {
            mesaId,
            garcomId,
            restauranteId,
            authUserEmail: authUser.email,
          },
          "Creating comanda with auth user id as garcom_id"
        );

        // Calculate total from items before insertion
        let initialTotal = "0";
        if (request.body.itens && request.body.itens.length > 0) {
          const calculatedTotal = request.body.itens.reduce((sum, item) => {
            return sum + (item.quantidade * item.preco_unitario);
          }, 0);
          initialTotal = calculatedTotal.toString();
        }

        // Use transaction to ensure all operations succeed together
        const comanda = await (app.db as any).transaction(async (tx: any) => {
          // Insert comanda with calculated total and mesa_numero
          const [newComanda] = await tx
            .insert(schema.comandas)
            .values({
              mesaId,
              mesaNumero: mesa.numero,
              garcomId,
              status: "aberta",
              total: initialTotal,
              restauranteId,
            })
            .returning();

          // Insert pedido items if provided
          if (request.body.itens && request.body.itens.length > 0) {
            app.logger.info({ itemCount: request.body.itens.length }, "Inserting pedido items");

            const itemsToInsert = request.body.itens.map((item) => ({
              comandaId: newComanda.id,
              pratoId: item.prato_id,
              quantidade: item.quantidade,
              precoUnitario: item.preco_unitario.toString(),
              observacao: item.observacao || null,
              status: "pendente" as any,
              restauranteId,
            }));

            await tx
              .insert(schema.pedidos)
              .values(itemsToInsert);

            app.logger.info({ itemCount: request.body.itens.length }, "Pedido items inserted");

            // Update comanda total to ensure consistency with pedidos
            await tx
              .execute(sql`UPDATE comandas SET total = (
                SELECT COALESCE(SUM(quantidade * preco_unitario), 0) FROM pedidos WHERE comanda_id = ${newComanda.id}
              ) WHERE id = ${newComanda.id}`);
          }

          // Update mesa status to ocupada
          await tx
            .update(schema.mesas)
            .set({ status: "ocupada" })
            .where(eq(schema.mesas.id, mesaId));

          return newComanda;
        });

        app.logger.info({ comandaId: comanda.id, mesaId }, "Comanda created successfully");

        // Publish realtime event
        try {
          const restauranteId = requireTenant(authUser);
          realtimeHub.publish(restauranteId, {
            type: "comanda.created",
            entityId: comanda.id,
            occurredAt: new Date().toISOString(),
          });
        } catch (err) {
          app.logger.error({ err }, "Failed to publish comanda.created event");
        }

        return reply.code(201).send({
          comanda: {
            id: comanda.id,
            mesa_id: comanda.mesaId,
            mesa_numero: comanda.mesaNumero,
            garcom_id: comanda.garcomId,
            status: comanda.status,
            total: comanda.total,
            created_at: comanda.createdAt ? new Date(comanda.createdAt).toISOString() : null,
          },
        });
      } catch (error) {
        app.logger.error({ err: error, body: request.body }, "Failed to create comanda");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/comandas/:id - Get a comanda by ID with pedidos and mesa info
  app.fastify.get<{ Params: { id: string } }>(
    "/api/comandas/:id",
    {
      schema: {
        description: "Get a comanda by ID with pedidos and mesa info (requires authentication)",
        tags: ["comandas"],
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
              mesa_id: { type: "string", format: "uuid" },
              mesa_numero: { type: ["number", "null"] },
              garcom_id: { type: ["string", "null"] },
              status: { type: "string" },
              total: { type: "string" },
              created_at: { type: "string", format: "date-time" },
              mesa: {
                type: "object",
                properties: {
                  numero: { type: "number" },
                },
              },
              pedidos: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    prato_id: { type: "string", format: "uuid" },
                    quantidade: { type: "number" },
                    preco_unitario: { type: "string" },
                    observacao: { type: ["string", "null"] },
                    status: { type: "string" },
                    created_at: { type: "string", format: "date-time" },
                    prato: {
                      type: "object",
                      properties: {
                        nome: { type: "string" },
                        imagem_url: { type: ["string", "null"] },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const restauranteId = requireTenant(session);
        app.logger.info({ comandaId: request.params.id }, "Getting comanda");

        // Get comanda with mesa_numero from JOIN with mesas
        const comandas = await app.db
          .select({
            id: schema.comandas.id,
            mesaId: schema.comandas.mesaId,
            mesaNumero: schema.mesas.numero,
            garcomId: schema.comandas.garcomId,
            status: schema.comandas.status,
            total: schema.comandas.total,
            createdAt: schema.comandas.createdAt,
          })
          .from(schema.comandas)
          .leftJoin(schema.mesas, eq(schema.mesas.id, schema.comandas.mesaId))
          .where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));

        if (!comandas.length) {
          return reply.code(404).send({ error: "Comanda not found" });
        }

        const c = comandas[0];

        // Get pedidos with prato details
        const pedidos_data = await app.db
          .select({
            id: schema.pedidos.id,
            pratoId: schema.pedidos.pratoId,
            pratoNome: schema.pratos.nome,
            imagemUrl: schema.pratos.imagemUrl,
            quantidade: schema.pedidos.quantidade,
            precoUnitario: schema.pedidos.precoUnitario,
            observacao: schema.pedidos.observacao,
            status: schema.pedidos.status,
            createdAt: schema.pedidos.createdAt,
          })
          .from(schema.pedidos)
          .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
          .where(eq(schema.pedidos.comandaId, request.params.id));

        app.logger.info({ comandaId: request.params.id, itemsCount: pedidos_data.length }, "Comanda retrieved successfully");

        return reply.code(200).send({
          id: c.id,
          mesa_id: c.mesaId,
          mesa_numero: c.mesaNumero,
          garcom_id: c.garcomId,
          status: c.status,
          total: c.total,
          created_at: c.createdAt.toISOString(),
          mesa: {
            numero: c.mesaNumero,
          },
          pedidos: pedidos_data.map((p) => ({
            id: p.id,
            prato_id: p.pratoId,
            quantidade: p.quantidade,
            preco_unitario: p.precoUnitario,
            observacao: p.observacao,
            status: p.status,
            created_at: p.createdAt.toISOString(),
            prato: {
              nome: p.pratoNome,
              imagem_url: p.imagemUrl,
            },
          })),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get comanda");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/comandas/:id/pedidos - Add multiple pedidos to a comanda
  app.fastify.post<{ Params: { id: string }; Body: CreatePedidosBody }>(
    "/api/comandas/:id/pedidos",
    {
      schema: {
        description: "Add multiple pedidos to a comanda (requires authentication)",
        tags: ["comandas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["items"],
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                required: ["prato_id", "quantidade", "preco_unitario"],
                properties: {
                  prato_id: { type: "string", format: "uuid" },
                  quantidade: { type: "number" },
                  observacao: { type: ["string", "null"] },
                  preco_unitario: { type: "number" },
                },
              },
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              pedidos: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    comanda_id: { type: "string", format: "uuid" },
                    prato_id: { type: "string", format: "uuid" },
                    quantidade: { type: "number" },
                    preco_unitario: { type: "string" },
                    observacao: { type: ["string", "null"] },
                    status: { type: "string" },
                    created_at: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: CreatePedidosBody }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const comandaId = request.params.id;

        if (!request.body.items || !Array.isArray(request.body.items) || request.body.items.length === 0) {
          return reply.code(400).send({ error: "items array is required and must not be empty" });
        }

        // Verify comanda exists
        const comandas = await app.db
          .select()
          .from(schema.comandas)
          .where(eq(schema.comandas.id, comandaId))
          .limit(1);

        if (!comandas.length) {
          return reply.code(404).send({ error: "Comanda not found" });
        }

        const comanda = comandas[0];

        // Resolve garcom_id and verify ownership
        const { garcomId: resolvedGarcomId } = await resolveGarcomId(app, authUser.email, authUser.id);

        if (comanda.garcomId !== resolvedGarcomId) {
          app.logger.warn(
            { comandaId, expectedGarcomId: resolvedGarcomId, actualGarcomId: comanda.garcomId },
            "Unauthorized access to comanda"
          );
          return reply.code(403).send({ error: "Unauthorized access to this comanda" });
        }

        // Verify all pratos exist
        const uniquePratoIds = Array.from(new Set(request.body.items.map((item) => item.prato_id)));
        const pratos = await app.db
          .select({ id: schema.pratos.id })
          .from(schema.pratos)
          .where(inArray(schema.pratos.id, uniquePratoIds));

        if (pratos.length !== uniquePratoIds.length) {
          return reply.code(404).send({ error: "One or more pratos not found" });
        }

        app.logger.info({ comandaId, itemsCount: request.body.items.length }, "Adding pedidos to comanda");

        // Insert all items
        const insertedPedidos = await app.db
          .insert(schema.pedidos)
          .values(
            request.body.items.map((item) => ({
              comandaId,
              pratoId: item.prato_id,
              quantidade: item.quantidade,
              precoUnitario: item.preco_unitario.toString(),
              observacao: item.observacao || null,
              status: "pendente" as any,
              restauranteId: authUser.restauranteId,
            }))
          )
          .returning();

        // Recalculate total: SUM(quantidade * preco_unitario)
        const allPedidos = await app.db
          .select()
          .from(schema.pedidos)
          .where(eq(schema.pedidos.comandaId, comandaId));

        const total = allPedidos.reduce((sum, p) => {
          return sum + parseFloat(p.precoUnitario) * p.quantidade;
        }, 0);

        // Update comanda total
        await app.db
          .update(schema.comandas)
          .set({ total: total.toString() })
          .where(eq(schema.comandas.id, comandaId));

        app.logger.info(
          { comandaId, insertedCount: insertedPedidos.length, newTotal: total },
          "Pedidos added successfully"
        );

        // Publish realtime event for each pedido created
        try {
          const restauranteId = requireTenant(authUser);
          for (const pedido of insertedPedidos) {
            realtimeHub.publish(restauranteId, {
              type: "pedido.created",
              entityId: pedido.id,
              occurredAt: new Date().toISOString(),
              payload: { comanda_id: comandaId, status: pedido.status },
            });
          }
        } catch (pubErr) {
          app.logger.debug({ err: pubErr }, "Failed to publish pedido.created event");
        }

        return reply.code(201).send({
          pedidos: insertedPedidos.map((p) => ({
            id: p.id,
            comanda_id: p.comandaId,
            prato_id: p.pratoId,
            quantidade: p.quantidade,
            preco_unitario: p.precoUnitario,
            observacao: p.observacao,
            status: p.status,
            created_at: p.createdAt.toISOString(),
          })),
        });
      } catch (error) {
        app.logger.error({ err: error, body: request.body }, "Failed to add pedidos to comanda");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/comandas/:id/gorjeta — atualizar gorjeta da comanda
  app.fastify.put<{ Params: { id: string }; Body: { gorjeta: number } }>(
    "/api/comandas/:id/gorjeta",
    async (request: FastifyRequest<{ Params: { id: string }; Body: { gorjeta: number } }>, reply: FastifyReply) => {
      try {
        const session = await customRequireAuth(app, request, reply);
        if (!session) return;
        const restauranteId = requireTenant(session);
        const comanda = await app.db.select().from(schema.comandas).where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));
        if (!comanda.length) return reply.code(404).send({ error: "Comanda não encontrada" });
        if (comanda[0].status !== "aberta") return reply.code(400).send({ error: "Comanda não está aberta" });
        const gorjeta = Math.max(0, (request.body as any)?.gorjeta || 0);
        const subtotal = parseFloat(comanda[0].subtotal || comanda[0].total || "0");
        const novoTotal = subtotal + gorjeta;
        await app.db.update(schema.comandas).set({ total: novoTotal.toString(), gorjeta: gorjeta.toString() }).where(eq(schema.comandas.id, request.params.id));
        return reply.code(200).send({ subtotal, gorjeta, total: novoTotal });
      } catch (err) {
        return reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // POST /api/comandas/:id/fechar - Close and archive a comanda
  app.fastify.post<{ Params: { id: string }; Body: FecharComandaBody }>(
    "/api/comandas/:id/fechar",
    {
      schema: {
        description: "Close and archive a comanda with optional tip and split information",
        tags: ["comandas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          properties: {
            gorjeta: { type: "number", default: 0 },
            num_pessoas: { type: "integer", default: 0 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              mesa_numero: { type: "number" },
              subtotal: { type: "number" },
              gorjeta: { type: "number" },
              total_final: { type: "number" },
              num_pessoas: { type: ["number", "null"] },
              valor_por_pessoa: { type: ["number", "null"] },
              created_at: { type: "string", format: "date-time" },
              closed_at: { type: "string", format: "date-time" },
              itens: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    prato_nome: { type: "string" },
                    quantidade: { type: "number" },
                    preco_unitario: { type: "number" },
                    subtotal_item: { type: "number" },
                  },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: FecharComandaBody }>,
      reply: FastifyReply
    ) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const restauranteId = requireTenant(session);
        if (!restauranteId) {
          return reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        app.logger.info({ comandaId: request.params.id, restauranteId }, "Closing and archiving comanda");

        // STEP 1: First query mesa_id before any archive logic
        const mesaIdResult = await app.db
          .select({ mesaId: schema.comandas.mesaId })
          .from(schema.comandas)
          .where(eq(schema.comandas.id, request.params.id));

        if (!mesaIdResult.length) {
          return reply.code(404).send({ error: "Comanda not found" });
        }

        const mesaId = mesaIdResult[0].mesaId;
        app.logger.info({ comandaId: request.params.id, mesaId }, "Comanda found, mesa_id extracted");

        // Fetch full comanda details with mesa info for response
        const comandas = await app.db
          .select({
            id: schema.comandas.id,
            mesaId: schema.comandas.mesaId,
            mesaNumero: schema.mesas.numero,
            garcomId: schema.comandas.garcomId,
            status: schema.comandas.status,
            total: schema.comandas.total,
            createdAt: schema.comandas.createdAt,
          })
          .from(schema.comandas)
          .leftJoin(schema.mesas, eq(schema.mesas.id, schema.comandas.mesaId))
          .where(eq(schema.comandas.id, request.params.id));

        const comanda = comandas[0];

        // Check if comanda is open
        if (comanda.status !== "aberta") {
          return reply.code(400).send({ error: "comanda não está aberta" });
        }

        // Extract parameters with defaults, parse gorjeta as float
        const gorjetaValue = parseFloat((request.body.gorjeta?.toString()) ?? "0");
        const numPessoas = request.body.num_pessoas ?? 0;

        // Calculate totals
        const subtotal = parseFloat(comanda.total || "0");
        const totalFinal = subtotal + gorjetaValue;
        const valorPorPessoa = numPessoas > 0 ? totalFinal / numPessoas : null;

        // Capture timestamps
        const createdAt = comanda.createdAt;
        const closedAt = new Date();

        // Fetch pedidos before transaction to include in response
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
          .where(eq(schema.pedidos.comandaId, request.params.id));

        // Build itens array from pedidos
        const itens = pedidos.map((p) => ({
          prato_nome: p.pratoNome || "N/A",
          quantidade: p.quantidade,
          preco_unitario: parseFloat(p.precoUnitario || "0"),
          subtotal_item: p.quantidade * parseFloat(p.precoUnitario || "0"),
        }));

        // Verificar pagamentos
        const pagamentosComanda = await app.db
          .select()
          .from(schema.pagamentos)
          .where(eq(schema.pagamentos.comandaId, request.params.id));

        const totalPagoConfirmado = pagamentosComanda
          .filter((p: any) => p.status === "confirmado")
          .reduce((sum: number, p: any) => sum + parseFloat(p.valor), 0);

        const pagamentosPendentes = pagamentosComanda.filter((p: any) => p.status === "pendente");

        if (pagamentosPendentes.length > 0) {
          return reply.code(400).send({ error: "Existem pagamentos pendentes (ex: Pix aguardando confirmação). Confirme ou cancele antes de fechar." });
        }

        if (pagamentosComanda.length > 0 && totalPagoConfirmado < totalFinal - 0.01) {
          return reply.code(400).send({ error: `Total pago (R$ ${totalPagoConfirmado.toFixed(2)}) é menor que o total da comanda (R$ ${totalFinal.toFixed(2)}).` });
        }

        // STEP 2: Run the archive logic
        await (app.db as any).transaction(async (tx: any) => {
          // Copy comanda to historico with status 'fechada'
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
            restauranteId,
          });

          // Copy pedidos to historico
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

          // Copiar pagamentos para histórico
          if (pagamentosComanda.length > 0) {
            await tx.insert(schema.pagamentosHistorico).values(
              pagamentosComanda.filter((p: any) => p.status === "confirmado").map((p: any) => ({
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

            // Deletar pagamentos da comanda
            await tx.delete(schema.pagamentos).where(eq(schema.pagamentos.comandaId, request.params.id));
          }

          // Update comanda with subtotal and gorjeta before deleting
          await tx
            .update(schema.comandas)
            .set({
              subtotal: subtotal.toString(),
              gorjeta: gorjetaValue.toString(),
            })
            .where(eq(schema.comandas.id, request.params.id));

          // Delete pedidos
          await tx
            .delete(schema.pedidos)
            .where(eq(schema.pedidos.comandaId, request.params.id));

          // Delete comanda
          await tx
            .delete(schema.comandas)
            .where(eq(schema.comandas.id, request.params.id));

          // STEP 3: After archive, ALWAYS release mesa to disponivel
          if (mesaId) {
            try {
              await tx
                .update(schema.mesas)
                .set({ status: "disponivel" })
                .where(eq(schema.mesas.id, mesaId));

              app.logger.info({ mesaId }, "Mesa released to disponivel");
            } catch (err) {
              app.logger.error({ mesaId, error: (err as any).message }, "Failed to release mesa");
              throw err;
            }
          }
        });

        app.logger.info(
          { comandaId: request.params.id, subtotal, gorjeta: gorjetaValue, totalFinal, itemCount: itens.length },
          `[fechar] comanda ${request.params.id}: subtotal=${subtotal}, gorjeta=${gorjetaValue}, total=${totalFinal}`
        );

        // Publish realtime event
        try {
          realtimeHub.publish(restauranteId, {
            type: "comanda.closed",
            entityId: request.params.id,
            occurredAt: new Date().toISOString(),
          });
        } catch (err) {
          app.logger.error({ err }, "Failed to publish comanda.closed event");
        }

        return reply.code(200).send({
          success: true,
          mesa_numero: comanda.mesaNumero,
          subtotal,
          gorjeta: gorjetaValue,
          total_final: totalFinal,
          num_pessoas: numPessoas > 0 ? numPessoas : null,
          valor_por_pessoa: valorPorPessoa,
          created_at: createdAt.toISOString(),
          closed_at: closedAt.toISOString(),
          itens,
          pagamentos: pagamentosComanda.filter((p: any) => p.status === "confirmado").map((p: any) => ({
            forma_pagamento: p.formaPagamento,
            valor: parseFloat(p.valor),
            troco: parseFloat(p.troco || "0"),
          })),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to close and archive comanda");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/comandas/:id/cancelar - Cancel a comanda
  app.fastify.put<{ Params: { id: string } }>(
    "/api/comandas/:id/cancelar",
    {
      schema: {
        description: "Cancel a comanda",
        tags: ["comandas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: { type: "object" },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ comandaId: request.params.id }, "Canceling comanda");

        const existing = await app.db
          .select()
          .from(schema.comandas)
          .where(eq(schema.comandas.id, request.params.id));

        if (!existing.length) {
          return reply.code(404).send({ error: "Comanda not found" });
        }

        const [updated] = await app.db
          .update(schema.comandas)
          .set({
            status: "cancelada",
            closedAt: new Date(),
          })
          .where(eq(schema.comandas.id, request.params.id))
          .returning();

        // Check if mesa still has open comandas
        const remainingComandasResult = await (app.db as any).execute(
          sql`SELECT COUNT(*) as count FROM comandas WHERE mesa_id = ${updated.mesaId} AND status = 'aberta'`
        ) as any[];

        const remainingCount = remainingComandasResult[0]?.count || 0;

        // Update mesa status to 'disponivel' only if no more open comandas
        if (remainingCount === 0) {
          await app.db
            .update(schema.mesas)
            .set({ status: "disponivel" })
            .where(eq(schema.mesas.id, updated.mesaId));
        }

        app.logger.info({ comandaId: updated.id }, "Comanda cancelled successfully");

        // Publish realtime event
        try {
          const restauranteId = requireTenant(session);
          realtimeHub.publish(restauranteId, {
            type: "comanda.cancelled",
            entityId: updated.id,
            occurredAt: new Date().toISOString(),
          });
        } catch (err) {
          app.logger.error({ err }, "Failed to publish comanda.cancelled event");
        }

        return reply.code(200).send({
          id: updated.id,
          mesa_id: updated.mesaId,
          mesa_numero: updated.mesaNumero,
          garcom_id: updated.garcomId,
          status: updated.status,
          total: updated.total,
          closed_at: updated.closedAt?.toISOString(),
          created_at: updated.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to cancel comanda");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/comandas/:id - Delete a comanda and all its pedidos
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/comandas/:id",
    {
      schema: {
        description: "Delete a comanda and all its pedidos",
        tags: ["comandas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          204: { description: "Comanda deleted successfully" },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ comandaId: request.params.id }, "Deleting comanda");

        const existing = await app.db
          .select()
          .from(schema.comandas)
          .where(eq(schema.comandas.id, request.params.id));

        if (!existing.length) {
          app.logger.warn({ comandaId: request.params.id }, "Comanda not found");
          return reply.code(404).send({ error: "Comanda not found" });
        }

        const comanda = existing[0];

        // Delete all pedidos for this comanda
        app.logger.debug({ comandaId: request.params.id }, "Deleting pedidos for comanda");
        await app.db
          .delete(schema.pedidos)
          .where(eq(schema.pedidos.comandaId, request.params.id));

        // Delete the comanda
        await app.db
          .delete(schema.comandas)
          .where(eq(schema.comandas.id, request.params.id));

        // Update mesa status back to disponivel
        await app.db
          .update(schema.mesas)
          .set({ status: "disponivel" })
          .where(eq(schema.mesas.id, comanda.mesaId));

        app.logger.info({ comandaId: request.params.id }, "Comanda deleted successfully");

        return reply.code(204).send();
      } catch (error) {
        app.logger.error({ err: error, comandaId: request.params.id }, "Failed to delete comanda");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PATCH /api/pedidos/:id/observacao - Update pedido observacao
  interface UpdateObservacaoBody {
    observacao: string;
  }

  app.fastify.patch<{ Params: { id: string }; Body: UpdateObservacaoBody }>(
    "/api/pedidos/:id/observacao",
    {
      schema: {
        description: "Update observacao for a pedido",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["observacao"],
          properties: {
            observacao: { type: "string" },
          },
        },
        response: {
          200: {
            description: "Pedido updated successfully",
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              comanda_id: { type: "string", format: "uuid" },
              prato_id: { type: ["string", "null"], format: "uuid" },
              quantidade: { type: "number" },
              preco_unitario: { type: "string" },
              observacao: { type: ["string", "null"] },
              status: { type: "string" },
              created_at: { type: "string", format: "date-time" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateObservacaoBody }>,
      reply: FastifyReply
    ) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ pedidoId: request.params.id }, "Updating pedido observacao");

        const existing = await app.db
          .select()
          .from(schema.pedidos)
          .where(eq(schema.pedidos.id, request.params.id));

        if (!existing.length) {
          app.logger.warn({ pedidoId: request.params.id }, "Pedido not found");
          return reply.code(404).send({ error: "Pedido not found" });
        }

        const [updated] = await app.db
          .update(schema.pedidos)
          .set({
            observacao: request.body.observacao,
          })
          .where(eq(schema.pedidos.id, request.params.id))
          .returning();

        app.logger.info({ pedidoId: updated.id }, "Pedido observacao updated successfully");

        return reply.code(200).send({
          id: updated.id,
          comanda_id: updated.comandaId,
          prato_id: updated.pratoId,
          quantidade: updated.quantidade,
          preco_unitario: updated.precoUnitario,
          observacao: updated.observacao,
          status: updated.status,
          created_at: updated.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error, pedidoId: request.params.id }, "Failed to update pedido observacao");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/mesas/:id/comanda - Get the current open comanda for a mesa
  app.fastify.get<{ Params: { id: string } }>(
    "/api/mesas/:id/comanda",
    {
      schema: {
        description: "Get the current open comanda for a mesa with its pedidos",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              comanda: {
                type: ["object", "null"],
                properties: {
                  id: { type: "string", format: "uuid" },
                  mesa_id: { type: "string", format: "uuid" },
                  mesa_numero: { type: "number" },
                  garcom_id: { type: "string" },
                  garcom_nome: { type: "string" },
                  garcom_email: { type: "string" },
                  status: { type: "string" },
                  total: { type: "string" },
                  created_at: { type: ["string", "null"], format: "date-time" },
                  pedidos: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string", format: "uuid" },
                        prato_id: { type: ["string", "null"], format: "uuid" },
                        prato_nome: { type: ["string", "null"] },
                        prato_descricao: { type: ["string", "null"] },
                        prato_imagem: { type: ["string", "null"] },
                        quantidade: { type: "number" },
                        preco_unitario: { type: "string" },
                        observacao: { type: ["string", "null"] },
                        status: { type: "string" },
                        created_at: { type: ["string", "null"], format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const mesaId = request.params.id;
        app.logger.info({ mesaId }, "Fetching current open comanda for mesa");

        // Validate that mesa exists
        const mesaExists = await app.db
          .select({ id: schema.mesas.id })
          .from(schema.mesas)
          .where(eq(schema.mesas.id, mesaId as any));

        if (!mesaExists.length) {
          app.logger.warn({ mesaId }, "Mesa not found");
          return reply.code(404).send({ error: "Mesa não encontrada" });
        }

        // Query to find the most recent open comanda with dynamic total calculation
        const comandaQuery = sql`
          SELECT
            c.id AS comanda_id,
            c.mesa_id,
            c.mesa_numero,
            c.garcom_id,
            c.status AS comanda_status,
            c.created_at AS comanda_created_at,
            COALESCE(u.name, us.nome, 'Garçom') AS garcom_nome,
            COALESCE(u.email, us.email) AS garcom_email,
            COALESCE(SUM(p.quantidade * p.preco_unitario), 0)::float as total
          FROM comandas c
          LEFT JOIN "user" u ON u.id = c.garcom_id
          LEFT JOIN usuarios us ON us.id::text = c.garcom_id
          LEFT JOIN pedidos p ON p.comanda_id = c.id
          WHERE c.mesa_id = ${mesaId} AND c.status = 'aberta'
          GROUP BY c.id, c.mesa_id, c.mesa_numero, c.garcom_id, c.status, c.created_at, u.name, u.email, us.nome, us.email
          ORDER BY c.created_at DESC
          LIMIT 1
        `;

        const comandaResult = await (app.db as any).execute(comandaQuery) as any[];

        if (!comandaResult || comandaResult.length === 0) {
          app.logger.info({ mesaId }, "No open comanda found for mesa");
          return reply.code(200).send({ comanda: null });
        }

        const comandaRow = comandaResult[0];

        // Query to get pedidos for this comanda
        const pedidosQuery = sql`
          SELECT
            p.id,
            p.prato_id,
            p.quantidade,
            p.preco_unitario::float as preco_unitario,
            p.observacao,
            p.status,
            p.created_at,
            pr.nome AS prato_nome,
            pr.descricao AS prato_descricao,
            pr.imagem_url AS prato_imagem
          FROM pedidos p
          LEFT JOIN pratos pr ON p.prato_id = pr.id
          WHERE p.comanda_id = ${comandaRow.comanda_id}
          ORDER BY p.created_at ASC
        `;

        const pedidosResult = await (app.db as any).execute(pedidosQuery) as any[];

        app.logger.info({ comandaId: comandaRow.comanda_id, pedidoCount: pedidosResult.length }, "Comanda and pedidos retrieved");

        return reply.code(200).send({
          comanda: {
            id: comandaRow.comanda_id,
            mesa_id: comandaRow.mesa_id,
            mesa_numero: comandaRow.mesa_numero,
            garcom_id: comandaRow.garcom_id,
            garcom_nome: comandaRow.garcom_nome,
            garcom_email: comandaRow.garcom_email,
            status: comandaRow.comanda_status,
            total: comandaRow.total,
            created_at: comandaRow.comanda_created_at ? new Date(comandaRow.comanda_created_at).toISOString() : null,
            pedidos: pedidosResult.map((p: any) => ({
              id: p.id,
              prato_id: p.prato_id,
              prato_nome: p.prato_nome,
              prato_descricao: p.prato_descricao,
              prato_imagem: p.prato_imagem,
              quantidade: p.quantidade,
              preco_unitario: p.preco_unitario,
              observacao: p.observacao,
              status: p.status,
              created_at: p.created_at ? new Date(p.created_at).toISOString() : null,
            })),
          },
        });
      } catch (error) {
        app.logger.error({ err: error, mesaId: request.params.id }, "Failed to fetch comanda for mesa");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/mesas/:id/historico - Get full historical data for a mesa
  app.fastify.get<{ Params: { id: string } }>(
    "/api/mesas/:id/historico",
    {
      schema: {
        description: "Get full historical data for a mesa (archived and active comandas with pedidos)",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              mesa: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  numero: { type: "number" },
                  status: { type: "string" },
                  capacidade: { type: "number" },
                },
              },
              resumo: {
                type: "object",
                properties: {
                  total_arrecadado: { type: "number" },
                  total_comandas: { type: "number" },
                  total_pedidos: { type: "number" },
                  top_pratos: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        prato_nome: { type: "string" },
                        total_quantidade: { type: "number" },
                        total_receita: { type: "number" },
                      },
                    },
                  },
                },
              },
              comandas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    status: { type: "string" },
                    total: { type: "number" },
                    subtotal: { type: "number" },
                    gorjeta: { type: "number" },
                    garcom_id: { type: ["string", "null"] },
                    garcom_nome: { type: "string" },
                    created_at: { type: ["string", "null"], format: "date-time" },
                    closed_at: { type: ["string", "null"], format: "date-time" },
                    source: { type: "string", enum: ["historico", "ativa"] },
                    pedidos: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          prato_nome: { type: "string" },
                          quantidade: { type: "number" },
                          preco_unitario: { type: "number" },
                          observacao: { type: ["string", "null"] },
                          status: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const mesaId = request.params.id;
        app.logger.info({ mesaId }, "Fetching historical data for mesa");

        // Step 1: Fetch mesa
        const mesaResult = await app.db
          .select()
          .from(schema.mesas)
          .where(eq(schema.mesas.id, mesaId))
          .limit(1);

        if (!mesaResult.length) {
          return reply.code(404).send({ error: "Mesa não encontrada" });
        }

        const mesa = mesaResult[0];

        // Step 2: Fetch archived comandas with garcom names via LEFT JOIN
        const archivedComandasResult = await (app.db as any).execute(
          sql`
            SELECT
              ch.id, ch.mesa_id, ch.mesa_numero, ch.garcom_id, ch.status,
              ch.total, ch.subtotal, ch.gorjeta,
              ch.created_at, ch.closed_at, ch.archived_at,
              COALESCE(u.nome, 'Não informado') as garcom_nome
            FROM comandas_historico ch
            LEFT JOIN usuarios u ON u.id::text = ch.garcom_id
            WHERE ch.mesa_id = ${mesaId}
            ORDER BY ch.created_at DESC
          `
        ) as any[];

        // Step 3: Fetch active comandas with garcom names via LEFT JOIN
        const activeComandasResult = await (app.db as any).execute(
          sql`
            SELECT
              c.id, c.mesa_id, c.mesa_numero, c.garcom_id, c.status,
              c.total, c.subtotal, c.gorjeta,
              c.created_at, c.closed_at,
              COALESCE(u.nome, 'Não informado') as garcom_nome
            FROM comandas c
            LEFT JOIN usuarios u ON u.id::text = c.garcom_id
            WHERE c.mesa_id = ${mesaId}
            ORDER BY c.created_at DESC
          `
        ) as any[];

        // Collect all comanda IDs for the query below
        const archivedComandasIds = archivedComandasResult.map((c) => c.id);
        const activeComandasIds = activeComandasResult.map((c) => c.id);

        // Step 4: Fetch archived pedidos
        let archivedPedidosMap: Record<string, any[]> = {};
        if (archivedComandasIds.length > 0) {
          const archivedPedidosResult = await app.db
            .select()
            .from(schema.pedidosHistorico)
            .where(inArray(schema.pedidosHistorico.comandaId, archivedComandasIds));

          for (const pedido of archivedPedidosResult) {
            if (!archivedPedidosMap[pedido.comandaId]) {
              archivedPedidosMap[pedido.comandaId] = [];
            }
            archivedPedidosMap[pedido.comandaId].push({
              id: pedido.id,
              prato_nome: pedido.pratoNome,
              quantidade: pedido.quantidade,
              preco_unitario: parseFloat(pedido.precoUnitario || "0"),
              observacao: pedido.observacao,
              status: pedido.status,
            });
          }
        }

        // Step 5: Fetch active pedidos with prato info
        let activePedidosMap: Record<string, any[]> = {};
        if (activeComandasIds.length > 0) {
          const activePedidosResult = await app.db
            .select({
              id: schema.pedidos.id,
              comandaId: schema.pedidos.comandaId,
              quantidade: schema.pedidos.quantidade,
              precoUnitario: schema.pedidos.precoUnitario,
              observacao: schema.pedidos.observacao,
              status: schema.pedidos.status,
              pratoNome: schema.pratos.nome,
            })
            .from(schema.pedidos)
            .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
            .where(inArray(schema.pedidos.comandaId, activeComandasIds));

          for (const pedido of activePedidosResult) {
            if (!activePedidosMap[pedido.comandaId]) {
              activePedidosMap[pedido.comandaId] = [];
            }
            activePedidosMap[pedido.comandaId].push({
              id: pedido.id,
              prato_nome: pedido.pratoNome || "N/A",
              quantidade: pedido.quantidade,
              preco_unitario: parseFloat(pedido.precoUnitario || "0"),
              observacao: pedido.observacao,
              status: pedido.status,
            });
          }
        }

        // Step 6: Merge and tag comandas, sort by created_at DESC
        const allComandasWithSource = [
          ...archivedComandasResult.map((c) => ({
            ...c,
            source: "historico" as const,
          })),
          ...activeComandasResult.map((c) => ({
            ...c,
            source: "ativa" as const,
          })),
        ];

        allComandasWithSource.sort((a, b) => {
          const dateA = new Date(a.created_at).getTime();
          const dateB = new Date(b.created_at).getTime();
          return dateB - dateA; // DESC order
        });

        // Build comandas response with pedidos
        const comandasResponse = allComandasWithSource.map((comanda) => {
          const pedidos =
            comanda.source === "historico"
              ? archivedPedidosMap[comanda.id] || []
              : activePedidosMap[comanda.id] || [];

          const closedAtField = comanda.source === "historico" ? comanda.archived_at : comanda.closed_at;

          return {
            id: comanda.id,
            status: comanda.status,
            total: parseFloat(comanda.total || "0"),
            subtotal: parseFloat(comanda.subtotal || "0"),
            gorjeta: parseFloat(comanda.gorjeta || "0"),
            garcom_id: comanda.garcom_id || null,
            garcom_nome: comanda.garcom_nome,
            created_at: comanda.created_at ? new Date(comanda.created_at).toISOString() : null,
            closed_at: closedAtField ? new Date(closedAtField).toISOString() : null,
            source: comanda.source,
            pedidos,
          };
        });

        // Step 9: Compute resumo (using subtotal for revenue)
        const totalArrecadado =
          archivedComandasResult.reduce((sum, c) => sum + parseFloat(c.subtotal || "0"), 0) +
          activeComandasResult.reduce((sum, c) => sum + parseFloat(c.subtotal || "0"), 0);

        const totalComandasCount = archivedComandasResult.length + activeComandasResult.length;

        const totalPedidosCount =
          Object.values(archivedPedidosMap).reduce((sum, pedidos) => sum + pedidos.length, 0) +
          Object.values(activePedidosMap).reduce((sum, pedidos) => sum + pedidos.length, 0);

        // Compute top_pratos from both archived and active pedidos
        let topPratosMap: Record<string, { total_quantidade: number; total_receita: number }> = {};

        // Aggregate from archived pedidos
        for (const pedido of Object.values(archivedPedidosMap).flat()) {
          const pratoNome = pedido.prato_nome;
          if (!topPratosMap[pratoNome]) {
            topPratosMap[pratoNome] = { total_quantidade: 0, total_receita: 0 };
          }
          topPratosMap[pratoNome].total_quantidade += pedido.quantidade;
          topPratosMap[pratoNome].total_receita += pedido.quantidade * pedido.preco_unitario;
        }

        // Aggregate from active pedidos
        for (const pedido of Object.values(activePedidosMap).flat()) {
          const pratoNome = pedido.prato_nome;
          if (!topPratosMap[pratoNome]) {
            topPratosMap[pratoNome] = { total_quantidade: 0, total_receita: 0 };
          }
          topPratosMap[pratoNome].total_quantidade += pedido.quantidade;
          topPratosMap[pratoNome].total_receita += pedido.quantidade * pedido.preco_unitario;
        }

        // Convert to array, sort by total_quantidade DESC, take top 10
        const topPratos = Object.entries(topPratosMap)
          .map(([prato_nome, data]) => ({
            prato_nome,
            total_quantidade: data.total_quantidade,
            total_receita: parseFloat(data.total_receita.toFixed(2)),
          }))
          .sort((a, b) => b.total_quantidade - a.total_quantidade)
          .slice(0, 10);

        app.logger.info(
          {
            mesaId,
            archivedComandasCount: archivedComandasResult.length,
            activeComandasCount: activeComandasResult.length,
            totalArrecadado,
            topPratosCount: topPratos.length,
          },
          "Historical data retrieved successfully"
        );

        return reply.code(200).send({
          mesa: {
            id: mesa.id,
            numero: mesa.numero,
            status: mesa.status,
            capacidade: mesa.capacidade,
          },
          resumo: {
            total_arrecadado: totalArrecadado,
            total_comandas: totalComandasCount,
            total_pedidos: totalPedidosCount,
            top_pratos: topPratos,
          },
          comandas: comandasResponse,
        });
      } catch (error) {
        app.logger.error({ err: error, mesaId: request.params.id }, "Failed to fetch mesa historico");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/cozinha/comandas - Get active comandas for kitchen display (requires authentication)
  app.fastify.get(
    "/api/cozinha/comandas",
    {
      schema: {
        description: "Get all comandas for kitchen display system (requires authentication)",
        tags: ["cozinha"],
        response: {
          200: {
            type: "object",
            properties: {
              comandas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    numero_comanda: { type: "string" },
                    mesa_numero: { type: ["number", "null"] },
                    created_at: { type: "string", format: "date-time" },
                    garcom_id: { type: "string" },
                    garcom_nome: { type: "string" },
                    status: { type: "string" },
                    total: { type: "string" },
                    total_itens: { type: "number" },
                    pedidos: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          prato_nome: { type: "string" },
                          tempo_preparo_min: { type: ["number", "null"] },
                          quantidade: { type: "number" },
                          status: { type: "string" },
                          observacao: { type: ["string", "null"] },
                          created_at: { type: "string", format: "date-time" },
                        },
                      },
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
        const tenantId = authUser.restauranteId;
        app.logger.info({ tenantId }, "Fetching comandas for kitchen display");

        // Query to get all comandas for this tenant with garcom info from usuarios table
        const comandasQuery = sql`
          SELECT
            c.id,
            c.mesa_numero,
            c.garcom_id,
            c.status,
            c.total,
            c.created_at,
            COALESCE(u.nome, 'Não informado') as garcom_nome
          FROM comandas c
          LEFT JOIN usuarios u ON u.id::text = c.garcom_id
          WHERE c.restaurante_id = ${tenantId}::uuid
          ORDER BY c.created_at DESC
        `;

        const comandasResult = await (app.db as any).execute(comandasQuery) as any[];

        // Query to get all pedidos for this tenant with prato names
        const pedidosQuery = sql`
          SELECT
            p.id,
            p.comanda_id,
            COALESCE(pr.nome, 'Prato') as prato_nome,
            pr.tempo_preparo_min,
            p.quantidade,
            p.status,
            p.observacao,
            p.created_at
          FROM pedidos p
          LEFT JOIN pratos pr ON pr.id = p.prato_id
          WHERE p.restaurante_id = ${tenantId}::uuid
          ORDER BY p.created_at ASC
        `;

        const pedidosResult = await (app.db as any).execute(pedidosQuery) as any[];

        // Group pedidos by comanda_id for efficient lookup
        const pedidosByComandaId = new Map<string, any[]>();
        for (const pedido of pedidosResult) {
          const comandaId = pedido.comanda_id;
          if (!pedidosByComandaId.has(comandaId)) {
            pedidosByComandaId.set(comandaId, []);
          }
          pedidosByComandaId.get(comandaId)!.push(pedido);
        }

        app.logger.info({ tenantId, count: comandasResult.length }, "Comandas retrieved for kitchen display");

        // Transform results to the expected format
        const comandas = comandasResult.map((row: any) => {
          // Extract last 8 characters of UUID and uppercase it (equivalent to RIGHT(c.id::text, 8))
          const uuidStr = String(row.id);
          const numeroComanda = uuidStr.slice(-8).toUpperCase();

          // Get pedidos for this comanda
          const comandaPedidos = pedidosByComandaId.get(row.id) || [];
          const totalItens = comandaPedidos.reduce((sum, p) => sum + (Number(p.quantidade) || 0), 0);

          return {
            id: row.id,
            numero_comanda: numeroComanda,
            mesa_numero: row.mesa_numero ? Number(row.mesa_numero) : null,
            created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
            garcom_id: row.garcom_id || null,
            garcom_nome: row.garcom_nome || "Não informado",
            status: row.status,
            total: row.total,
            total_itens: totalItens,
            pedidos: comandaPedidos.map((p: any) => ({
              id: p.id,
              prato_nome: p.prato_nome || "Prato",
              tempo_preparo_min: p.tempo_preparo_min !== null && p.tempo_preparo_min !== undefined ? Number(p.tempo_preparo_min) : null,
              quantidade: Number(p.quantidade) || 0,
              status: p.status,
              observacao: p.observacao || null,
              created_at: p.created_at ? new Date(p.created_at).toISOString() : null,
            })),
          };
        });

        return reply.code(200).send({ comandas });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to fetch comandas for kitchen");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
