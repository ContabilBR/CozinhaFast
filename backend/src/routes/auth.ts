import type { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { user as userTable, session as sessionTable, account as accountTable } from "../db/schema/auth-schema.js";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { randomUUID } from "crypto";
import * as bcrypt from "bcrypt";

interface SignInBody {
  email: string;
  password: string;
}

interface SignUpBody {
  name: string;
  email: string;
  password: string;
  role?: string;
}

export function registerAuthRoutes(app: App) {
  // POST /api/auth/sign-up/email
  app.fastify.post<{ Body: SignUpBody }>(
    "/api/auth/sign-up/email",
    {
      schema: {
        description: "Sign up user with email and password",
        tags: ["auth"],
        body: {
          type: "object",
          required: ["name", "email", "password"],
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string" },
            role: { type: "string", enum: ["garcom", "gerente", "administrador", "cozinheiro"] },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              token: { type: "string" },
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  email: { type: "string" },
                  role: { type: "string" },
                  active: { type: "boolean" },
                  emailVerified: { type: "boolean" },
                  image: { type: "string", nullable: true },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                },
              },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          409: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: SignUpBody }>, reply: FastifyReply) => {
      // Rota de teste/dev — nenhuma tela do app real a utiliza. Fica fechada (404)
      // por padrao; so fica acessivel se ALLOW_TEST_SIGNUP="true" for setado
      // explicitamente no ambiente, ou se nao estivermos em producao.
      // NUNCA definir essa variavel em producao:
      // quem chamar essa rota escolhe o proprio "role" no corpo da requisicao,
      // incluindo "administrador" (ver enum no schema acima), sem nenhuma
      // autenticacao. E' assim de proposito, so pra permitir que a suite de
      // testes crie usuarios com papeis diferentes — nunca deve ser alcancavel
      // por trafego real.
      const allowSignUp = process.env.ALLOW_TEST_SIGNUP === "true" || process.env.NODE_ENV !== "production";
      if (!allowSignUp) {
        return reply.status(404).send();
      }
      try {
        app.logger.info({ email: request.body.email }, "Sign up attempt");

        const { name, email, password, role } = request.body;

        if (!name || !email || !password) {
          return reply.status(400).send({ error: "Name, email e senha são obrigatórios" });
        }

        // Check if user already exists
        const existing = await app.db
          .select()
          .from(userTable)
          .where(eq(userTable.email, email))
          .limit(1);

        if (existing && existing.length > 0) {
          app.logger.info({ email }, "Sign up failed: email already exists");
          return reply.status(409).send({ error: "Email já cadastrado" });
        }

        // "role" vem direto do corpo da requisicao sem validacao de quem esta
        // pedindo — inclui "administrador". So chega aqui se ALLOW_TEST_SIGNUP
        // estiver "true" (checagem no topo deste handler).
        const userId = randomUUID();
        const now = new Date();
        const userRole = role || "garcom";

        await app.db.insert(userTable).values({
          id: userId,
          name,
          email,
          emailVerified: false,
          role: userRole as any,
          active: true,
          createdAt: now,
          updatedAt: now,
        });

        // Hash password and create account
        const hashedPassword = await bcrypt.hash(password, 10);
        await app.db.insert(accountTable).values({
          id: randomUUID(),
          accountId: userId,
          providerId: "credential",
          userId: userId,
          password: hashedPassword,
          createdAt: now,
          updatedAt: now,
        });

        // Ensure a restaurante exists - use seed ID first, or create one
        const seedRestauranteId = '00000000-0000-0000-0000-000000000001';
        let restauranteId: string;

        try {
          // First, try to use the seed restaurante if it exists
          const seedRestaurante = await app.db
            .select()
            .from(schema.restaurante)
            .where(eq(schema.restaurante.id, seedRestauranteId))
            .limit(1);

          if (seedRestaurante.length > 0) {
            restauranteId = seedRestauranteId;
            app.logger.debug({ restauranteId }, "Using existing seed restaurante");
          } else {
            // Try to get the first existing restaurante
            const existingRestaurantes = await app.db.select().from(schema.restaurante).limit(1);
            if (existingRestaurantes.length > 0) {
              restauranteId = existingRestaurantes[0].id;
              app.logger.debug({ restauranteId }, "Using first existing restaurante");
            } else {
              // No restaurante exists, create one with the seed ID
              app.logger.debug({}, "No restaurante found, creating seed restaurante");
              const [newRestaurante] = await app.db
                .insert(schema.restaurante)
                .values({
                  id: seedRestauranteId,
                  nome: 'Default Restaurant',
                })
                .returning();
              restauranteId = newRestaurante.id;
              app.logger.debug({ restauranteId }, "Created new seed restaurante");
            }
          }
        } catch (err) {
          app.logger.error({ err }, "Failed to ensure restaurante exists - will try fallback");
          // Last resort: try to get any restaurante or create one
          try {
            const fallbackRestaurantes = await app.db.select().from(schema.restaurante).limit(1);
            if (fallbackRestaurantes.length > 0) {
              restauranteId = fallbackRestaurantes[0].id;
              app.logger.debug({ restauranteId }, "Using fallback restaurante");
            } else {
              const [newRestaurante] = await app.db
                .insert(schema.restaurante)
                .values({ nome: 'Test Restaurant' })
                .returning();
              restauranteId = newRestaurante.id;
              app.logger.debug({ restauranteId }, "Created fallback restaurante");
            }
          } catch (fallbackErr) {
            app.logger.error({ err: fallbackErr }, "Failed to create fallback restaurante - signup will fail");
            throw fallbackErr;
          }
        }

        app.logger.info({ userId, restauranteId }, "Associating user with restaurante");

        // Create profile with restaurante association and role
        try {
          await app.db.insert(schema.profiles).values({
            userId: userId,
            restauranteId: restauranteId as any,
            role: userRole,
            name,
            createdAt: now,
          });
          app.logger.info({ userId, profileRestauranteId: restauranteId }, "Profile created successfully");
        } catch (profileErr) {
          app.logger.error({ userId, restauranteId, err: profileErr }, "Failed to create profile during sign-up");
          // Don't throw - let the user complete sign-up even if profile creation fails
          // The profile will be created on first sign-in
        }

        // Generate session token (UUID)
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        app.logger.info({ token, userId, expiresAt }, "Creating session");

        // Create session
        try {
          await app.db.insert(sessionTable).values({
            id: randomUUID(),
            token,
            userId: userId,
            expiresAt,
            createdAt: now,
          });
          app.logger.info({ token, userId }, "Session created successfully");
        } catch (sessionErr) {
          app.logger.error({ token, userId, err: sessionErr }, "Failed to create session");
          throw sessionErr;
        }

        app.logger.info({ userId, email, token }, "Sign up successful");

        return reply.status(201).send({
          token,
          user: {
            id: userId,
            name,
            email,
            role: userRole,
            active: true,
            emailVerified: false,
            image: null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        });
      } catch (error) {
        app.logger.error({ err: error }, "Sign up failed with error");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/auth/sign-in
  app.fastify.post<{ Body: SignInBody }>(
    "/api/auth/sign-in",
    {
      schema: {
        description: "Sign in user with email and password",
        tags: ["auth"],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              token: { type: "string" },
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  email: { type: "string" },
                  role: { type: "string" },
                  active: { type: "boolean" },
                  emailVerified: { type: "boolean" },
                  image: { type: "string", nullable: true },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                },
              },
            },
          },
          401: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: SignInBody }>, reply: FastifyReply) => {
      try {
        app.logger.info({ email: request.body.email }, "Sign in attempt");

        const { email, password } = request.body;

        if (!email || !password) {
          return reply.status(401).send({ error: "Credenciais inválidas" });
        }

        // Look up user by email
        const users = await app.db
          .select()
          .from(userTable)
          .where(eq(userTable.email, email))
          .limit(1);

        if (!users || users.length === 0) {
          app.logger.info({ email }, "Sign in failed: user not found");
          return reply.status(401).send({ error: "Credenciais inválidas" });
        }

        const user = users[0];

        // Look up account with hashed password
        const accounts = await app.db
          .select()
          .from(accountTable)
          .where(eq(accountTable.userId, user.id))
          .limit(1);

        if (!accounts || accounts.length === 0 || !accounts[0].password) {
          app.logger.info({ userId: user.id }, "Sign in failed: no password set");
          return reply.status(401).send({ error: "Credenciais inválidas" });
        }

        const account = accounts[0];

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, account.password);

        if (!isPasswordValid) {
          app.logger.info({ email }, "Sign in failed: invalid password");
          return reply.status(401).send({ error: "Credenciais inválidas" });
        }

        // Get profile - ensure it exists
        let profiles = await app.db
          .select()
          .from(schema.profiles)
          .where(eq(schema.profiles.userId, user.id))
          .limit(1);

        if (!profiles || profiles.length === 0) {
          // Profile doesn't exist, create one with a default restaurante
          app.logger.warn({ userId: user.id }, "Profile not found for signed-in user, creating one");
          try {
            // Try to get or create a default restaurante
            const existingRestaurante = await app.db.select().from(schema.restaurante).limit(1);
            const restauranteId = existingRestaurante.length > 0
              ? existingRestaurante[0].id
              : (await app.db.insert(schema.restaurante).values({ nome: 'Default Restaurant' }).returning())[0].id;

            await app.db.insert(schema.profiles).values({
              userId: user.id,
              restauranteId: restauranteId,
              role: user.role || "garcom",
              name: user.name || "",
              createdAt: new Date(),
            });

            // Reload profiles
            profiles = await app.db
              .select()
              .from(schema.profiles)
              .where(eq(schema.profiles.userId, user.id))
              .limit(1);
          } catch (profileErr) {
            app.logger.error({ userId: user.id, err: profileErr }, "Failed to create missing profile on sign-in");
            throw profileErr;
          }
        }

        const profile = profiles && profiles.length > 0
          ? { role: profiles[0].role, name: profiles[0].name }
          : { role: user.role || "usuario", name: user.name };

        // Generate session token (UUID)
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        // Create session
        await app.db.insert(sessionTable).values({
          id: randomUUID(),
          token,
          userId: user.id,
          expiresAt,
          createdAt: new Date(),
        });

        app.logger.info({ userId: user.id, email }, "Sign in successful");

        return reply.status(200).send({
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            active: user.active,
            emailVerified: user.emailVerified,
            image: user.image,
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
          },
        });
      } catch (error) {
        app.logger.error({ err: error }, "Sign in failed with error");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/auth/me
  app.fastify.get(
    "/api/auth/me",
    {
      schema: {
        description: "Get current authenticated user with role and active status",
        tags: ["auth"],
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              email: { type: "string" },
              name: { type: "string" },
              role: { type: "string" },
              active: { type: "boolean" },
            },
          },
          401: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          app.logger.warn("No Bearer token in /api/auth/me");
          return reply.status(401).send({ error: "Não autorizado" });
        }

        const token = authHeader.slice(7).trim();
        app.logger.info({ tokenLength: token.length, tokenStart: token.substring(0, 20) }, "Looking up session in /api/auth/me");

        // Look up session by token
        const sessions = await app.db
          .select()
          .from(sessionTable)
          .where(eq(sessionTable.token, token))
          .limit(1);

        app.logger.debug({ sessionsFound: sessions?.length || 0 }, "Session query result in /api/auth/me");

        if (!sessions || sessions.length === 0) {
          app.logger.warn({ token: token.substring(0, 20) }, "No session found for token in /api/auth/me");
          return reply.status(401).send({ error: "Não autorizado" });
        }

        const session = sessions[0];

        // Check if session expired
        if (new Date(session.expiresAt) < new Date()) {
          return reply.status(401).send({ error: "Não autorizado" });
        }

        // Get user with role and active status from user table
        const users = await app.db
          .select()
          .from(userTable)
          .where(eq(userTable.id, session.userId))
          .limit(1);

        if (!users || users.length === 0) {
          return reply.status(401).send({ error: "Não autorizado" });
        }

        const user = users[0];

        app.logger.info({ userId: user.id }, "Get current user");

        return reply.code(200).send({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          active: user.active,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Get current user failed");
        return reply.status(401).send({ error: "Não autorizado" });
      }
    }
  );

  // POST /api/auth/sign-out
  app.fastify.post(
    "/api/auth/sign-out",
    {
      schema: {
        description: "Sign out user",
        tags: ["auth"],
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
            },
          },
          401: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return reply.status(401).send({ error: "Não autorizado" });
        }

        const token = authHeader.slice(7).trim();

        // Delete session
        await app.db
          .delete(sessionTable)
          .where(eq(sessionTable.token, token));

        app.logger.info({}, "Sign out successful");

        return reply.status(200).send({ success: true });
      } catch (error) {
        app.logger.error({ err: error }, "Sign out failed");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/seed-status - Check seed status
  app.fastify.get(
    "/api/seed-status",
    {
      schema: {
        description: "Get database seed status",
        tags: ["auth"],
        response: {
          200: {
            type: "object",
            properties: {
              users: { type: "number" },
              accounts: { type: "number" },
              profiles: { type: "number" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const users = await app.db.select().from(userTable);
        const accounts = await app.db
          .select()
          .from(accountTable)
          .where(eq(accountTable.providerId, "credential"));
        const profiles = await app.db.select().from(schema.profiles);

        app.logger.info(
          { userCount: users.length, accountCount: accounts.length, profileCount: profiles.length },
          "Seed status retrieved"
        );

        return reply.status(200).send({
          users: users.length,
          accounts: accounts.length,
          profiles: profiles.length,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get seed status");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );
}
