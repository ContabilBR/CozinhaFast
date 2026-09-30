import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, or, sql, and, inArray } from "drizzle-orm";
import { user as userTable, account as accountTable } from "../db/schema/auth-schema.js";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { randomUUID } from "crypto";
import * as bcrypt from "bcrypt";
import { requireAuth as customRequireAuth, requireRole, requireTenant } from "../utils/auth.js";
import { resolveGarcomId } from "../utils/garcom.js";

interface CreateGarconBody {
  name: string;
  email: string;
  password: string;
}

interface UpdateGarconBody {
  name?: string;
  email?: string;
  password?: string;
  active?: boolean;
}

export function registerGarconRoutes(app: App) {
  // Better Auth stores the restaurant membership in profiles, not in user.
  const garconDoRestaurante = (executor: any, restauranteId: string, id?: string) => and(
    eq(userTable.role, "garcom"),
    inArray(userTable.id, executor.select({ userId: schema.profiles.userId }).from(schema.profiles)
      .where(and(eq(schema.profiles.restauranteId, restauranteId), eq(schema.profiles.role, "garcom")))),
    id === undefined ? undefined : eq(userTable.id, id),
  );

  // GET /api/garcons - List all garcons
  app.fastify.get(
    "/api/garcons",
    {
      schema: {
        description: "List all garcons (waiters) with role='garcom'",
        tags: ["garcons"],
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                email: { type: "string" },
                role: { type: "string" },
                active: { type: "boolean" },
                created_at: { type: "string", format: "date-time" },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      const restauranteId = requireTenant(session);

      try {
        app.logger.info({}, "Listing all garcons");

        const garcons = await app.db
          .select()
          .from(userTable)
          .where(garconDoRestaurante(app.db, restauranteId));

        return reply.code(200).send(
          garcons.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            active: u.active,
            created_at: u.createdAt.toISOString(),
          }))
        );
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list garcons");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/garcons/check-email - Check if an email exists in usuarios table
  app.fastify.get(
    "/api/garcons/check-email",
    {
      schema: {
        description: "Check if an email exists in the usuarios table",
        tags: ["garcons"],
        querystring: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email", description: "Email to check" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              exists: { type: "boolean" },
              nome: { type: "string", nullable: true },
            },
          },
          400: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { email?: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      const restauranteId = requireTenant(authUser);

      const { email } = request.query as { email?: string };

      if (!email || email.trim() === "") {
        app.logger.warn({}, "Check-email request missing email parameter");
        return reply.code(400).send({ error: "email query param is required" });
      }

      try {
        app.logger.info({ email }, "Checking if email exists in usuarios table");

        const usuario = await app.db
          .select({
            id: schema.usuarios.id,
            nome: schema.usuarios.nome,
          })
          .from(schema.usuarios)
          .where(and(sql`LOWER(${schema.usuarios.email}) = LOWER(${email})`, eq(schema.usuarios.restauranteId, restauranteId)))
          .limit(1);

        if (usuario.length > 0) {
          app.logger.info({ email, usuarioId: usuario[0].id }, "Email found in usuarios table");
          return reply.code(200).send({
            exists: true,
            nome: usuario[0].nome,
          });
        }

        app.logger.info({ email }, "Email not found in usuarios table");
        return reply.code(200).send({
          exists: false,
          nome: null,
        });
      } catch (error) {
        app.logger.error({ err: error, email }, "Failed to check email in usuarios table");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/garcons - Create a new garcon
  app.fastify.post<{ Body: CreateGarconBody }>(
    "/api/garcons",
    {
      schema: {
        description: "Create a new garcon (waiter)",
        tags: ["garcons"],
        body: {
          type: "object",
          required: ["name", "email", "password"],
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              email: { type: "string" },
              role: { type: "string" },
              active: { type: "boolean" },
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
    async (request: FastifyRequest<{ Body: CreateGarconBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      app.logger.info({ userId: authUser.id, userRole: authUser.role }, "ROLE CHECK DEBUG - garcons write (POST /api/garcons)");

      if (!requireRole(authUser, ["administrador", "gerente", "admin", "manager", "superadmin", "super_admin"], reply)) return;

      try {
        if (!request.body.name || !request.body.email || !request.body.password) {
          return reply.code(400).send({ error: "name, email, and password are required" });
        }

        const restauranteId = requireTenant(authUser);
        if (!restauranteId) {
          return reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        app.logger.info({ email: request.body.email, restauranteId }, "Creating new garcon");

        // Check if user already exists
        const existing = await app.db
          .select()
          .from(userTable)
          .where(eq(userTable.email, request.body.email))
          .limit(1);

        if (existing && existing.length > 0) {
          return reply.code(409).send({ error: "Email already exists" });
        }

        // Create user
        const userId = randomUUID();
        const now = new Date();
        const hashedPassword = await bcrypt.hash(request.body.password, 10);

        await (app.db as any).transaction(async (tx: any) => {
          await tx.insert(userTable).values({
            id: userId,
            name: request.body.name,
            email: request.body.email,
            emailVerified: false,
            role: "garcom",
            active: true,
            createdAt: now,
            updatedAt: now,
          });

          await tx.insert(schema.profiles).values({
            userId, restauranteId, role: "garcom", name: request.body.name,
          });

          // Create account record
          await tx.insert(accountTable).values({
            id: randomUUID(),
            accountId: userId,
            providerId: "credential",
            userId: userId,
            password: hashedPassword,
            createdAt: now,
            updatedAt: now,
          });

          // Also insert into usuarios table for compatibility
          await tx.insert(schema.usuarios).values({
            id: randomUUID(),
            betterAuthUserId: userId,
            nome: request.body.name,
            email: request.body.email,
            senhaHash: hashedPassword,
            role: "garcom",
            restauranteId,
            createdAt: now,
          });
        });

        app.logger.info({ userId, email: request.body.email }, "Garcon created successfully");

        return reply.code(201).send({
          id: userId,
          name: request.body.name,
          email: request.body.email,
          role: "garcom",
          active: true,
          created_at: now.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to create garcon");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/garcons/:id - Update a garcon
  app.fastify.put<{ Params: { id: string }; Body: UpdateGarconBody }>(
    "/api/garcons/:id",
    {
      schema: {
        description: "Update a garcon (waiter)",
        tags: ["garcons"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string" },
            active: { type: "boolean" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              email: { type: "string" },
              role: { type: "string" },
              active: { type: "boolean" },
              created_at: { type: "string", format: "date-time" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateGarconBody }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      app.logger.info({ userId: authUser.id, userRole: authUser.role }, "ROLE CHECK DEBUG - garcons write (PUT /api/garcons/:id)");

      if (!requireRole(authUser, ["administrador", "gerente", "admin", "manager", "superadmin", "super_admin"], reply)) return;

      try {
        const restauranteId = requireTenant(authUser);
        const hashedPassword = request.body.password?.trim()
          ? await bcrypt.hash(request.body.password, 10) : null;

        const outcome = await (app.db as any).transaction(async (tx: any) => {
          const [existing] = await tx.select().from(userTable)
            .where(garconDoRestaurante(tx, restauranteId, request.params.id))
            .for("update");
          if (!existing) return null;

          // Resolve the paired identity by an immutable ID, never by email.
          const [usuario] = await tx.select({ id: schema.usuarios.id }).from(schema.usuarios)
            .where(and(eq(schema.usuarios.betterAuthUserId, request.params.id),
              eq(schema.usuarios.restauranteId, restauranteId), eq(schema.usuarios.role, "garcom"))).for("update");

          if (!usuario) return { error: "identity_link_missing" as const };
          if (hashedPassword) {
            const [credential] = await tx.select({ id: accountTable.id }).from(accountTable)
              .where(and(eq(accountTable.userId, request.params.id), eq(accountTable.providerId, "credential"))).for("update");
            if (!credential) return { error: "identity_link_missing" as const };
          }

          const updates: any = { updatedAt: new Date() };
          if (request.body.name !== undefined) updates.name = request.body.name;
          if (request.body.email !== undefined) updates.email = request.body.email;
          if (request.body.active !== undefined) updates.active = request.body.active;
          const [result] = await tx.update(userTable).set(updates)
            .where(garconDoRestaurante(tx, restauranteId, request.params.id)).returning();
          if (!result) return null;

          if (request.body.name !== undefined) {
            await tx.update(schema.profiles).set({ name: request.body.name })
              .where(and(eq(schema.profiles.userId, request.params.id),
                eq(schema.profiles.restauranteId, restauranteId)));
          }
          if (hashedPassword) {
            await tx.update(accountTable).set({ password: hashedPassword })
              .where(and(eq(accountTable.userId, request.params.id), eq(accountTable.providerId, "credential"),
                inArray(accountTable.userId, tx.select({ id: userTable.id }).from(userTable)
                  .where(garconDoRestaurante(tx, restauranteId, request.params.id)))));
          }
          if (usuario) {
            const customUpdates: any = {};
            if (request.body.name !== undefined) customUpdates.nome = request.body.name;
            if (request.body.email !== undefined) customUpdates.email = request.body.email;
            if (request.body.active !== undefined) customUpdates.ativo = request.body.active;
            if (hashedPassword) customUpdates.senhaHash = hashedPassword;
            if (Object.keys(customUpdates).length > 0) {
              await tx.update(schema.usuarios).set(customUpdates)
                .where(and(eq(schema.usuarios.id, usuario.id), eq(schema.usuarios.betterAuthUserId, request.params.id),
                  eq(schema.usuarios.restauranteId, restauranteId), eq(schema.usuarios.role, "garcom")));
            }
          }
          return { user: result };
        });
        if (!outcome) return reply.code(404).send({ error: "Garcon not found" });
        if ("error" in outcome) return reply.code(409).send({ error: "Vínculo de identidade pendente de revisão" });
        const updated = outcome.user;

        app.logger.info({ userId: updated.id }, "Garcon updated successfully");

        return reply.code(200).send({
          id: updated.id,
          name: updated.name,
          email: updated.email,
          role: updated.role,
          active: updated.active,
          created_at: updated.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update garcon");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/garcons/:id - Delete a garcon
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/garcons/:id",
    {
      schema: {
        description: "Delete a garcon (waiter)",
        tags: ["garcons"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          204: {},
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      app.logger.info({ userId: authUser.id, userRole: authUser.role }, "ROLE CHECK DEBUG - garcons write (DELETE /api/garcons/:id)");

      if (!requireRole(authUser, ["administrador", "gerente", "admin", "manager", "superadmin", "super_admin"], reply)) return;

      try {
        const restauranteId = requireTenant(authUser);
        const deleted = await (app.db as any).transaction(async (tx: any) => {
          const [existing] = await tx.select().from(userTable)
            .where(garconDoRestaurante(tx, restauranteId, request.params.id)).for("update");
          if (!existing) return "not_found";

          const [usuario] = await tx.select({ id: schema.usuarios.id }).from(schema.usuarios)
            .where(and(eq(schema.usuarios.betterAuthUserId, request.params.id),
              eq(schema.usuarios.restauranteId, restauranteId), eq(schema.usuarios.role, "garcom"))).for("update");
          if (!usuario) return "identity_link_missing";
          {
            await tx.delete(schema.usuariosSession).where(eq(schema.usuariosSession.userId, usuario.id));
            await tx.delete(schema.usuarios).where(and(eq(schema.usuarios.id, usuario.id), eq(schema.usuarios.betterAuthUserId, request.params.id),
              eq(schema.usuarios.restauranteId, restauranteId), eq(schema.usuarios.role, "garcom")));
          }
          // account/session/profile rows are removed by their user foreign keys.
          await tx.delete(userTable).where(garconDoRestaurante(tx, restauranteId, request.params.id));
          return "deleted";
        });
        if (deleted === "not_found") return reply.code(404).send({ error: "Garcon not found" });
        if (deleted === "identity_link_missing") return reply.code(409).send({ error: "Vínculo de identidade pendente de revisão" });

        app.logger.info({ userId: request.params.id }, "Garcon deleted successfully");

        return reply.code(204).send();
      } catch (error) {
        app.logger.error({ err: error }, "Failed to delete garcon");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/garcom/pedidos - Get all pedidos for authenticated garcom's comandas
  app.fastify.get(
    "/api/garcom/pedidos",
    {
      schema: {
        description: "Get all pedidos (order items) for the authenticated garcom's comandas",
        tags: ["garcom"],
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                numero_sequencial: { type: "number" },
                comanda_id: { type: "string", format: "uuid" },
                mesa_numero: { type: "number" },
                created_at: { type: "string", format: "date-time" },
                itens: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      prato_nome: { type: "string" },
                      quantidade: { type: "number" },
                      observacao: { type: "string", nullable: true },
                      status: { type: "string" },
                      created_at: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      const restauranteId = requireTenant(authUser);

      const authUserId = authUser.id;
      const authUserEmail = authUser.email;

      try {
        // Look up usuarios by email for broad OR filtering
        const usuarioRecords = await app.db
          .select()
          .from(schema.usuarios)
          .where(and(or(eq(schema.usuarios.id, authUserId), eq(schema.usuarios.betterAuthUserId, authUserId)), eq(schema.usuarios.restauranteId, restauranteId)))
          .limit(1);

        const usuarioId = usuarioRecords.length > 0 ? usuarioRecords[0].id : null;

        app.logger.debug(
          {
            auth_user_id: authUserId,
            auth_user_email: authUserEmail,
            usuarios_id: usuarioId || null,
          },
          "Garcom resolution for pedidos query"
        );

        // Build broad OR filter for garcom_id
        const whereConditions = [];

        // Always check against auth user ID
        whereConditions.push(eq(schema.comandas.garcomId, authUserId));

        // If usuario found, also check against usuarios.id (cast to text)
        if (usuarioId) {
          whereConditions.push(eq(schema.comandas.garcomId, usuarioId));
        }

        const whereClause = whereConditions.length > 1
          ? or(...whereConditions)
          : whereConditions[0];

        // Query all pedidos for this garcom's comandas
        const pedidosData = await app.db
          .select({
            pedidoId: schema.pedidos.id,
            pratoNome: schema.pratos.nome,
            quantidade: schema.pedidos.quantidade,
            observacao: schema.pedidos.observacao,
            pedidoStatus: schema.pedidos.status,
            pedidoCriadoEm: schema.pedidos.createdAt,
            comandaId: schema.comandas.id,
            mesaNumero: schema.mesas.numero,
            comandaCriadoEm: schema.comandas.createdAt,
          })
          .from(schema.pedidos)
          .innerJoin(schema.comandas, eq(schema.pedidos.comandaId, schema.comandas.id))
          .innerJoin(schema.mesas, eq(schema.comandas.mesaId, schema.mesas.id))
          .leftJoin(schema.pratos, and(eq(schema.pedidos.pratoId, schema.pratos.id), eq(schema.pratos.restauranteId, restauranteId)))
          .where(and(whereClause, eq(schema.comandas.restauranteId, restauranteId), eq(schema.pedidos.restauranteId, restauranteId), eq(schema.mesas.restauranteId, restauranteId)))
          .orderBy(schema.pedidos.createdAt);

        app.logger.info(
          { authUserId, authUserEmail, usuarioId, comandasCount: new Set(pedidosData.map(p => p.comandaId)).size },
          "Pedidos fetched for garcom"
        );

        // Group by comanda and compute earliest created_at per comanda
        const comandasMap = new Map<
          string,
          {
            comanda_id: string;
            mesa_numero: number;
            created_at: Date;
            itens: Array<any>;
          }
        >();

        for (const pedido of pedidosData) {
          if (!comandasMap.has(pedido.comandaId)) {
            comandasMap.set(pedido.comandaId, {
              comanda_id: pedido.comandaId,
              mesa_numero: pedido.mesaNumero,
              created_at: pedido.comandaCriadoEm,
              itens: [],
            });
          }

          const comanda = comandasMap.get(pedido.comandaId)!;
          comanda.itens.push({
            id: pedido.pedidoId,
            prato_nome: pedido.pratoNome || "Prato não encontrado",
            quantidade: pedido.quantidade,
            observacao: pedido.observacao,
            status: pedido.pedidoStatus,
            created_at: pedido.pedidoCriadoEm,
          });

          // Update created_at to be the earliest pedido created_at for this comanda
          if (pedido.pedidoCriadoEm < comanda.created_at) {
            comanda.created_at = pedido.pedidoCriadoEm;
          }
        }

        // Convert to array, sort by earliest created_at, and assign sequential numbers
        const comandas = Array.from(comandasMap.values())
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
          .map((comanda, index) => ({
            numero_sequencial: index + 1,
            comanda_id: comanda.comanda_id,
            mesa_numero: comanda.mesa_numero,
            created_at: comanda.created_at.toISOString(),
            itens: comanda.itens
              .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
              .map((item) => ({
                id: item.id,
                prato_nome: item.prato_nome,
                quantidade: item.quantidade,
                observacao: item.observacao,
                status: item.status,
                created_at: item.created_at.toISOString(),
              })),
          }));

        app.logger.info({ authUserId, usuarioId, comandasCount: comandas.length }, "Pedidos fetched successfully");

        return comandas;
      } catch (error) {
        app.logger.error({ err: error, authUserId }, "Failed to fetch pedidos for garcom");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
