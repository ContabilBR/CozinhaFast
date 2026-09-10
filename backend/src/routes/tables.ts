import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, ne, and } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireRole } from "../utils/auth.js";

interface CreateMesaBody {
  numero: number;
  capacidade?: number;
  status?: string;
}

interface UpdateMesaBody {
  numero?: number;
  status?: string;
  capacidade?: number;
}

export function registerTableRoutes(app: App) {
  // GET /api/mesas - List all mesas ordered by numero, optional status filter
  app.fastify.get<{ Querystring: { status?: string } }>(
    "/api/mesas",
    {
      schema: {
        description: "List all mesas ordered by numero with optional status filter (requires authentication)",
        tags: ["mesas"],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["disponivel", "ocupada", "reservada"] },
          },
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                numero: { type: "number" },
                status: { type: "string", enum: ["disponivel", "ocupada", "reservada"] },
                capacidade: { type: "number" },
                created_at: { type: "string", format: "date-time" },
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
        const tenantId = authUser.restauranteId;
        app.logger.info({ tenantId, status: request.query.status }, "Listing mesas");

        let mesasQuery = app.db
          .select()
          .from(schema.mesas)
          .where(eq(schema.mesas.restauranteId, tenantId as any))
          .orderBy(schema.mesas.numero);

        if (request.query.status) {
          mesasQuery = app.db
            .select()
            .from(schema.mesas)
            .where(and(
              eq(schema.mesas.restauranteId, tenantId as any),
              eq(schema.mesas.status, request.query.status as any)
            ))
            .orderBy(schema.mesas.numero);
        }

        const mesas = await mesasQuery;
        app.logger.info({ tenantId, count: mesas.length }, "Mesas listed successfully");

        return mesas.map((m) => ({
          id: m.id,
          numero: m.numero,
          status: m.status,
          capacidade: m.capacidade,
          created_at: m.createdAt.toISOString(),
        }));
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list mesas");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/mesas - Create a new mesa
  app.fastify.post<{ Body: CreateMesaBody }>(
    "/api/mesas",
    {
      schema: {
        description: "Create a new mesa (requires admin/gerente role)",
        tags: ["mesas"],
        body: {
          type: "object",
          required: ["numero"],
          properties: {
            numero: { type: "number" },
            capacidade: { type: "number" },
            status: { type: "string", enum: ["disponivel", "ocupada", "reservada"] },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              numero: { type: "number" },
              status: { type: "string" },
              capacidade: { type: "number" },
              created_at: { type: "string", format: "date-time" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateMesaBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;

        // Check current database role
        const authUserProfile = await app.db
          .select()
          .from(schema.profiles)
          .where(and(
            eq(schema.profiles.userId, authUser.id),
            eq(schema.profiles.restauranteId, tenantId as any)
          ))
          .limit(1);

        const dbRole = authUserProfile.length > 0 ? authUserProfile[0].role?.toLowerCase() : authUser.role?.toLowerCase();
        const isAdmin = ["admin", "administrador", "gerente"].includes(dbRole ?? "");

        if (!isAdmin) {
          app.logger.warn({ tenantId }, "User lacks permission to create mesa");
          return reply.code(403).send({ error: "Forbidden" });
        }

        const { numero, capacidade = 4, status = "disponivel" } = request.body;

        if (!numero) {
          return reply.code(400).send({ error: "numero é obrigatório" });
        }

        app.logger.info({ tenantId, numero }, "Creating mesa");

        // Check for duplicate numero within same tenant
        const existing = await app.db
          .select()
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.restauranteId, tenantId as any),
            eq(schema.mesas.numero, numero)
          ))
          .limit(1);

        if (existing.length > 0) {
          app.logger.warn({ tenantId, numero }, "Mesa numero already exists");
          return reply.code(409).send({ error: "Mesa com este número já existe" });
        }

        const [newMesa] = await app.db
          .insert(schema.mesas)
          .values({
            numero,
            capacidade,
            status: status as any,
            restauranteId: tenantId as any,
            createdAt: new Date(),
          })
          .returning();

        app.logger.info({ mesaId: newMesa.id, tenantId }, "Mesa created successfully");

        return reply.code(201).send({
          id: newMesa.id,
          numero: newMesa.numero,
          status: newMesa.status,
          capacidade: newMesa.capacidade,
          created_at: newMesa.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to create mesa");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/mesas/:id - Get a single mesa by ID
  app.fastify.get<{ Params: { id: string } }>(
    "/api/mesas/:id",
    {
      schema: {
        description: "Get a single mesa by ID (requires authentication)",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              numero: { type: "number" },
              status: { type: "string" },
              capacidade: { type: "number" },
              created_at: { type: "string", format: "date-time" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;
        const { id } = request.params;

        app.logger.info({ tenantId, mesaId: id }, "Getting mesa");

        const mesa = await app.db
          .select()
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.id, id as any),
            eq(schema.mesas.restauranteId, tenantId as any)
          ))
          .limit(1);

        if (mesa.length === 0) {
          app.logger.warn({ tenantId, mesaId: id }, "Mesa not found");
          return reply.code(404).send({ error: "Mesa não encontrada" });
        }

        return reply.code(200).send({
          id: mesa[0].id,
          numero: mesa[0].numero,
          status: mesa[0].status,
          capacidade: mesa[0].capacidade,
          created_at: mesa[0].createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get mesa");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/mesas/:id - Update a mesa
  app.fastify.put<{ Params: { id: string }; Body: UpdateMesaBody }>(
    "/api/mesas/:id",
    {
      schema: {
        description: "Update a mesa (requires admin/gerente role)",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          properties: {
            numero: { type: "number" },
            status: { type: "string", enum: ["disponivel", "ocupada", "reservada"] },
            capacidade: { type: "number" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              numero: { type: "number" },
              status: { type: "string" },
              capacidade: { type: "number" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: UpdateMesaBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;

        // Check current database role
        const authUserProfile = await app.db
          .select()
          .from(schema.profiles)
          .where(and(
            eq(schema.profiles.userId, authUser.id),
            eq(schema.profiles.restauranteId, tenantId as any)
          ))
          .limit(1);

        const dbRole = authUserProfile.length > 0 ? authUserProfile[0].role?.toLowerCase() : authUser.role?.toLowerCase();
        const isAdmin = ["admin", "administrador", "gerente"].includes(dbRole ?? "");

        if (!isAdmin) {
          app.logger.warn({ tenantId }, "User lacks permission to update mesa");
          return reply.code(403).send({ error: "Forbidden" });
        }

        const { id } = request.params;
        const { numero, status, capacidade } = request.body;

        app.logger.info({ tenantId, mesaId: id }, "Updating mesa");

        // Check mesa belongs to tenant
        const existingMesa = await app.db
          .select()
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.id, id as any),
            eq(schema.mesas.restauranteId, tenantId as any)
          ))
          .limit(1);

        if (existingMesa.length === 0) {
          app.logger.warn({ tenantId, mesaId: id }, "Mesa not found");
          return reply.code(404).send({ error: "Mesa não encontrada" });
        }

        // Check for duplicate numero if changing it
        if (numero && numero !== existingMesa[0].numero) {
          const duplicate = await app.db
            .select()
            .from(schema.mesas)
            .where(and(
              eq(schema.mesas.restauranteId, tenantId as any),
              eq(schema.mesas.numero, numero),
              ne(schema.mesas.id, id as any)
            ))
            .limit(1);

          if (duplicate.length > 0) {
            app.logger.warn({ tenantId, numero }, "Duplicate mesa numero");
            return reply.code(409).send({ error: "Mesa com este número já existe" });
          }
        }

        const updateData = {
          ...(numero !== undefined && { numero }),
          ...(status && { status: status as any }),
          ...(capacidade !== undefined && { capacidade }),
        };

        const [updated] = await app.db
          .update(schema.mesas)
          .set(updateData)
          .where(eq(schema.mesas.id, id as any))
          .returning();

        app.logger.info({ mesaId: id }, "Mesa updated successfully");

        return reply.code(200).send({
          id: updated.id,
          numero: updated.numero,
          status: updated.status,
          capacidade: updated.capacidade,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update mesa");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/mesas/:id - Delete a mesa with cascading delete
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/mesas/:id",
    {
      schema: {
        description: "Delete a mesa with cascading delete (requires admin/gerente role)",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        response: {
          204: { description: "Mesa deleted successfully" },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          400: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;

        // Check current database role
        const authUserProfile = await app.db
          .select()
          .from(schema.profiles)
          .where(and(
            eq(schema.profiles.userId, authUser.id),
            eq(schema.profiles.restauranteId, tenantId as any)
          ))
          .limit(1);

        const dbRole = authUserProfile.length > 0 ? authUserProfile[0].role?.toLowerCase() : authUser.role?.toLowerCase();
        const isAdmin = ["admin", "administrador", "gerente"].includes(dbRole ?? "");

        if (!isAdmin) {
          app.logger.warn({ tenantId }, "User lacks permission to delete mesa");
          return reply.code(403).send({ error: "Forbidden" });
        }

        const { id } = request.params;

        app.logger.info({ tenantId, mesaId: id }, "Deleting mesa");

        // Check mesa belongs to tenant
        const mesa = await app.db
          .select()
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.id, id as any),
            eq(schema.mesas.restauranteId, tenantId as any)
          ))
          .limit(1);

        if (mesa.length === 0) {
          app.logger.warn({ tenantId, mesaId: id }, "Mesa not found");
          return reply.code(404).send({ error: "Mesa não encontrada" });
        }

        // Delete pedidos associated with this mesa's comandas
        const comandasForMesa = await app.db
          .select()
          .from(schema.comandas)
          .where(eq(schema.comandas.mesaId, id as any));

        for (const comanda of comandasForMesa) {
          await app.db.delete(schema.pedidos).where(eq(schema.pedidos.comandaId, comanda.id));
        }

        // Delete comandas
        await app.db.delete(schema.comandas).where(eq(schema.comandas.mesaId, id as any));

        // Delete mesa
        await app.db.delete(schema.mesas).where(eq(schema.mesas.id, id as any));

        app.logger.info({ mesaId: id }, "Mesa deleted successfully");
        return reply.code(204).send();
      } catch (error) {
        const errorStr = JSON.stringify(error).toLowerCase();
        const isFKError = errorStr.includes('foreign key') || errorStr.includes('restrict');
        if (isFKError) {
          app.logger.warn({ err: error }, "Cannot delete mesa - has dependent records");
          return reply.code(400).send({ error: "Não é possível deletar mesa com registros relacionados" });
        }
        app.logger.error({ err: error }, "Failed to delete mesa");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/mesas/:id/force - Force delete a mesa and all associated data
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/mesas/:id/force",
    {
      schema: {
        description: "Force delete a mesa and all associated data (requires admin/gerente role)",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        response: {
          204: { description: "Mesa force deleted successfully" },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;

        // Check current database role
        const authUserProfile = await app.db
          .select()
          .from(schema.profiles)
          .where(and(
            eq(schema.profiles.userId, authUser.id),
            eq(schema.profiles.restauranteId, tenantId as any)
          ))
          .limit(1);

        const dbRole = authUserProfile.length > 0 ? authUserProfile[0].role?.toLowerCase() : authUser.role?.toLowerCase();
        const isAdmin = ["admin", "administrador", "gerente"].includes(dbRole ?? "");

        if (!isAdmin) {
          app.logger.warn({ tenantId }, "User lacks permission to force delete mesa");
          return reply.code(403).send({ error: "Forbidden" });
        }

        const { id } = request.params;

        app.logger.info({ tenantId, mesaId: id }, "Force deleting mesa");

        // Check mesa belongs to tenant
        const mesa = await app.db
          .select()
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.id, id as any),
            eq(schema.mesas.restauranteId, tenantId as any)
          ))
          .limit(1);

        if (mesa.length === 0) {
          app.logger.warn({ tenantId, mesaId: id }, "Mesa not found");
          return reply.code(404).send({ error: "Mesa não encontrada" });
        }

        // Delete pedidos associated with this mesa's comandas
        const comandasForMesa = await app.db
          .select()
          .from(schema.comandas)
          .where(eq(schema.comandas.mesaId, id as any));

        for (const comanda of comandasForMesa) {
          await app.db.delete(schema.pedidos).where(eq(schema.pedidos.comandaId, comanda.id));
        }

        // Delete comandas
        await app.db.delete(schema.comandas).where(eq(schema.comandas.mesaId, id as any));

        // Delete mesa
        await app.db.delete(schema.mesas).where(eq(schema.mesas.id, id as any));

        app.logger.info({ mesaId: id }, "Mesa force deleted successfully");
        return reply.code(204).send();
      } catch (error) {
        app.logger.error({ err: error }, "Failed to force delete mesa");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
