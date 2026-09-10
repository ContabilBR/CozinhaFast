import type { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { randomUUID } from "crypto";
import * as bcrypt from "bcrypt";

interface SignupBody {
  nome: string;
  cnpj?: string;
  adminNome: string;
  adminEmail: string;
  adminSenha: string;
}

export function registerRestauranteSignupRoutes(app: App) {
  app.fastify.post<{ Body: SignupBody }>(
    "/api/restaurantes/signup",
    {
      schema: {
        description: "Create a new restaurante with admin user",
        tags: ["restaurante"],
        body: {
          type: "object",
          required: ["nome", "adminNome", "adminEmail", "adminSenha"],
          properties: {
            nome: { type: "string" },
            cnpj: { type: "string" },
            adminNome: { type: "string" },
            adminEmail: { type: "string" },
            adminSenha: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              restaurante: {
                type: "object",
                properties: {
                  id: { type: "string" },
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
              token: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: SignupBody }>, reply: FastifyReply) => {
      try {
        const { nome, cnpj, adminNome, adminEmail, adminSenha } = request.body;

        if (!nome || !adminNome || !adminEmail || !adminSenha) {
          return reply.code(400).send({ error: "nome, adminNome, adminEmail, adminSenha are required" });
        }

        app.logger.info({ restauranteName: nome, adminEmail }, "Creating new restaurante signup");

        // Check if email already exists
        const existingUsuario = await app.db
          .select()
          .from(schema.usuarios)
          .where(eq(schema.usuarios.email, adminEmail))
          .limit(1);

        if (existingUsuario.length > 0) {
          app.logger.warn({ adminEmail }, "Email already exists");
          return reply.code(409).send({ error: "Email already exists" });
        }

        const result = await (app.db as any).transaction(async (tx: any) => {
          // 1. Insert restaurante
          const trialExpiraEm = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
          const [newRestaurante] = await tx
            .insert(schema.restaurante)
            .values({ nome, cnpj, plano: "trial", assinaturaStatus: "trial", trialExpiraEm })
            .returning();

          app.logger.info({ restauranteId: newRestaurante.id }, "Restaurante created");

          // 2. Hash password
          const senhaHash = await bcrypt.hash(adminSenha, 10);

          // 3. Insert admin usuario
          const [newUsuario] = await tx
            .insert(schema.usuarios)
            .values({
              nome: adminNome,
              email: adminEmail,
              senhaHash,
              role: "administrador",
              restauranteId: newRestaurante.id,
            })
            .returning();

          app.logger.info({ usuarioId: newUsuario.id, restauranteId: newRestaurante.id }, "Admin usuario created");

          // 4. Generate session token
          const token = randomUUID();
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

          await tx.insert(schema.usuariosSession).values({
            token,
            userId: newUsuario.id.toString(),
            expiresAt,
          });

          app.logger.info({ restauranteId: newRestaurante.id }, "Session token created");

          return { restaurante: newRestaurante, usuario: newUsuario, token };
        });

        app.logger.info({ restauranteId: result.restaurante.id }, "Restaurante signup completed successfully");

        return reply.code(201).send({
          restaurante: { id: result.restaurante.id, nome: result.restaurante.nome },
          usuario: {
            id: result.usuario.id,
            nome: result.usuario.nome,
            email: result.usuario.email,
            role: result.usuario.role,
          },
          token: result.token,
        });
      } catch (error: any) {
        app.logger.error({ err: error }, "Failed to create restaurante signup");
        if (error?.message?.includes("unique") || error?.message?.includes("duplicate") || error?.code === "23505") {
          return reply.code(409).send({ error: "Email already exists" });
        }
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
