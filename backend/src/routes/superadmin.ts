import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { eq, desc, and } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireSuperAdmin } from "../utils/auth.js";
import { verifyAndAttachUser } from "./auth-custom.js";
import { randomUUID } from "crypto";
import * as bcryptjs from "bcryptjs";

interface GetRestaurantesResponse {
  id: string;
  nome: string;
  cnpj: string | null;
  uf: string | null;
  assinatura_status: string;
  created_at: Date;
  email_responsavel: string | null;
  ativo: boolean;
}

interface CreateRestauranteBody {
  nome: string;
  cnpj?: string;
  telefone?: string;
  uf?: string;
  responsavelNome: string;
  responsavelEmail: string;
  responsavelSenha: string;
  responsavelRole: "administrador" | "gerente";
}

interface UpdateRestauranteStatusBody {
  ativo: boolean;
}

export function registerSuperAdminRoutes(app: App) {
  // GET /api/superadmin/restaurantes - List all restaurants (Super Admin only)
  app.fastify.get<{}>(
    "/api/superadmin/restaurantes",
    {
      schema: {
        description: "List all restaurants (Super Admin only)",
        tags: ["superadmin"],
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                nome: { type: "string" },
                cnpj: { type: "string", nullable: true },
                uf: { type: "string", nullable: true },
                assinatura_status: { type: "string" },
                created_at: { type: "string", format: "date-time" },
                email_responsavel: { type: "string", nullable: true },
                ativo: { type: "boolean" },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      app.logger.info("GET /api/superadmin/restaurantes - Fetching all restaurants");

      // Verify authentication and super admin status
      const isAuth = await verifyAndAttachUser(app, request, reply);
      if (!isAuth) return;

      if (!requireSuperAdmin(request, reply)) return;

      try {
        // Fetch all restaurants
        const restaurantes = await app.db.select().from(schema.restaurante);
        app.logger.debug(
          { count: restaurantes.length },
          "Fetched restaurants from database"
        );

        // For each restaurant, fetch the responsible user (first admin/gerente by creation date)
        const result: GetRestaurantesResponse[] = [];

        for (const rest of restaurantes) {
          const responsavelUsers = await app.db
            .select()
            .from(schema.usuarios)
            .where(
              and(
                eq(schema.usuarios.restauranteId, rest.id),
                // Match administrador OR gerente
                eq(schema.usuarios.role, "administrador")
              )
            )
            .orderBy(desc(schema.usuarios.createdAt))
            .limit(1);

          let emailResponsavel: string | null = null;

          if (responsavelUsers.length === 0) {
            // Try to find gerente if no administrador
            const gerenteUsers = await app.db
              .select()
              .from(schema.usuarios)
              .where(
                and(
                  eq(schema.usuarios.restauranteId, rest.id),
                  eq(schema.usuarios.role, "gerente")
                )
              )
              .orderBy(desc(schema.usuarios.createdAt))
              .limit(1);

            if (gerenteUsers.length > 0) {
              emailResponsavel = gerenteUsers[0].email;
            }
          } else {
            emailResponsavel = responsavelUsers[0].email;
          }

          result.push({
            id: rest.id,
            nome: rest.nome,
            cnpj: rest.cnpj || null,
            uf: rest.uf || null,
            assinatura_status: rest.assinaturaStatus,
            created_at: rest.createdAt,
            email_responsavel: emailResponsavel,
            ativo: rest.ativo,
          });
        }

        app.logger.info(
          { totalRestaurantes: result.length },
          "Returning restaurants list"
        );
        return result;
      } catch (err) {
        app.logger.error(
          { err },
          "Failed to fetch restaurants for super admin"
        );
        throw err;
      }
    }
  );

  // POST /api/superadmin/restaurantes - Create new restaurant (Super Admin only)
  app.fastify.post<{ Body: CreateRestauranteBody }>(
    "/api/superadmin/restaurantes",
    {
      schema: {
        description: "Create a new restaurant (Super Admin only)",
        tags: ["superadmin"],
        body: {
          type: "object",
          required: [
            "nome",
            "responsavelNome",
            "responsavelEmail",
            "responsavelSenha",
            "responsavelRole",
          ],
          properties: {
            nome: { type: "string" },
            cnpj: { type: "string" },
            telefone: { type: "string" },
            uf: { type: "string" },
            responsavelNome: { type: "string" },
            responsavelEmail: { type: "string", format: "email" },
            responsavelSenha: { type: "string" },
            responsavelRole: {
              type: "string",
              enum: ["administrador", "gerente"],
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              restaurante: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  nome: { type: "string" },
                },
              },
              usuario: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  nome: { type: "string" },
                  email: { type: "string" },
                  role: { type: "string" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateRestauranteBody }>, reply: FastifyReply) => {
      const {
        nome,
        cnpj,
        telefone,
        uf,
        responsavelNome,
        responsavelEmail,
        responsavelSenha,
        responsavelRole,
      } = request.body;

      app.logger.info(
        { restauranteName: nome, responsavelEmail },
        "POST /api/superadmin/restaurantes - Creating new restaurant"
      );

      // Verify authentication and super admin status
      const isAuth = await verifyAndAttachUser(app, request, reply);
      if (!isAuth) return;

      if (!requireSuperAdmin(request, reply)) return;

      try {
        // Validate required fields
        if (
          !nome ||
          !responsavelNome ||
          !responsavelEmail ||
          !responsavelSenha
        ) {
          app.logger.warn({ body: request.body }, "Missing required fields");
          return reply
            .code(400)
            .send({ error: "Missing required fields" });
        }

        // Check if email already exists
        const existingUsuario = await app.db
          .select()
          .from(schema.usuarios)
          .where(eq(schema.usuarios.email, responsavelEmail.toLowerCase().trim()))
          .limit(1);

        if (existingUsuario.length > 0) {
          app.logger.warn(
            { responsavelEmail },
            "Email already exists in usuarios"
          );
          return reply.code(409).send({ error: "E-mail já cadastrado" });
        }

        // Transaction: create restaurant and user
        const result = await (app.db as any).transaction(async (tx: any) => {
          // Create restaurant
          const trialExpiraEm = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
          const restauranteResult = await tx
            .insert(schema.restaurante)
            .values({
              nome,
              cnpj: cnpj || null,
              telefone: telefone || null,
              uf: uf || null,
              plano: "trial",
              assinaturaStatus: "trial",
              trialExpiraEm,
              ativo: true,
              ambienteFocus: 2,
              ncmPadrao: "21069090",
            })
            .returning();

          const newRestaurante = Array.isArray(restauranteResult)
            ? restauranteResult[0]
            : restauranteResult;
          app.logger.info(
            { restauranteId: newRestaurante.id, nome },
            "Restaurant created"
          );

          // Hash password
          const senhaHash = await bcryptjs.hash(responsavelSenha, 10);
          app.logger.debug({ email: responsavelEmail }, "Password hashed");

          // Create user
          const usuarioId = randomUUID();
          const now = new Date();
          const usuarioResult = await tx
            .insert(schema.usuarios)
            .values({
              id: usuarioId,
              nome: responsavelNome,
              email: responsavelEmail.toLowerCase().trim(),
              senhaHash,
              role: responsavelRole,
              restauranteId: newRestaurante.id,
              ativo: true,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          const newUsuario = Array.isArray(usuarioResult)
            ? usuarioResult[0]
            : usuarioResult;
          app.logger.info(
            {
              usuarioId: newUsuario.id,
              restauranteId: newRestaurante.id,
              role: responsavelRole,
            },
            "Responsible user created"
          );

          return { restaurante: newRestaurante, usuario: newUsuario };
        });

        app.logger.info(
          { restauranteId: result.restaurante.id },
          "Restaurant creation completed successfully"
        );

        return reply.code(201).send({
          restaurante: {
            id: result.restaurante.id,
            nome: result.restaurante.nome,
          },
          usuario: {
            id: result.usuario.id,
            nome: result.usuario.nome,
            email: result.usuario.email,
            role: result.usuario.role,
          },
        });
      } catch (err) {
        app.logger.error(
          { err, responsavelEmail, body: request.body },
          "Failed to create restaurant"
        );
        throw err;
      }
    }
  );

  // PATCH /api/superadmin/restaurantes/:id/status - Update restaurant status (Super Admin only)
  app.fastify.patch<{
    Params: { id: string };
    Body: UpdateRestauranteStatusBody;
  }>(
    "/api/superadmin/restaurantes/:id/status",
    {
      schema: {
        description: "Update restaurant active status (Super Admin only)",
        tags: ["superadmin"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          required: ["ativo"],
          properties: {
            ativo: { type: "boolean" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              ativo: { type: "boolean" },
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
      request: FastifyRequest<{
        Params: { id: string };
        Body: UpdateRestauranteStatusBody;
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { ativo } = request.body;

      app.logger.info(
        { restauranteId: id, ativo },
        "PATCH /api/superadmin/restaurantes/:id/status - Updating restaurant status"
      );

      // Verify authentication and super admin status
      const isAuth = await verifyAndAttachUser(app, request, reply);
      if (!isAuth) return;

      if (!requireSuperAdmin(request, reply)) return;

      try {
        // Check if restaurant exists
        const restaurantes = await app.db
          .select()
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, id as any));

        if (restaurantes.length === 0) {
          app.logger.warn({ restauranteId: id }, "Restaurant not found");
          return reply.code(404).send({ error: "Restaurant not found" });
        }

        // Update restaurant status
        await app.db
          .update(schema.restaurante)
          .set({ ativo })
          .where(eq(schema.restaurante.id, id as any));

        app.logger.info(
          { restauranteId: id, ativo },
          "Restaurant status updated successfully"
        );

        return reply.code(200).send({ success: true, ativo });
      } catch (err) {
        app.logger.error({ err, restauranteId: id }, "Failed to update restaurant status");
        throw err;
      }
    }
  );
}
