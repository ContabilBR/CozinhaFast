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
                  image: { type: ["string", "null"] },
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
      if (process.env.ALLOW_TEST_SIGNUP !== "true") {
        return reply.status(404).send();
      }
      try {
        app.logger.info({ email: request.body.email }, "Sign up attempt");

        // Disable registration in production
        if (process.env.NODE_ENV === "production") {
          app.logger.warn({ email: request.body.email }, "Sign up attempt blocked in production");
          return reply.status(404).send({ error: "Not found" });
        }

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

        // Create user with optional role (default to garcom)
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

        // Use the seed restaurante for test/development
        const seedRestauranteId = '00000000-0000-0000-0000-000000000001';
        let restauranteId: string;

        try {
          // Try to use the seed restaurante if it exists
          const seedRestaurante = await app.db
            .select()
            .from(schema.restaurante)
            .where(eq(schema.restaurante.id, seedRestauranteId))
            .limit(1);

          if (seedRestaurante.length > 0) {
            restauranteId = seedRestauranteId;
          } else {
            // Fallback to first restaurante or create new one
            const existingRestaurante = await app.db.select().from(schema.restaurante).limit(1);
            if (existingRestaurante.length > 0) {
              restauranteId = existingRestaurante[0].id;
            } else {
              const [newRestaurante] = await app.db
                .insert(schema.restaurante)
                .values({ nome: 'Default Restaurant' })
                .returning();
              restauranteId = newRestaurante.id;
            }
          }
        } catch (err) {
          app.logger.debug({ err }, "Failed to check seed restaurante, falling back to first");
          const existingRestaurante = await app.db.select().from(schema.restaurante).limit(1);
          if (existingRestaurante.length > 0) {
            restauranteId = existingRestaurante[0].id;
          } else {
            const [newRestaurante] = await app.db
              .insert(schema.restaurante)
              .values({ nome: 'Default Restaurant' })
              .returning();
            restauranteId = newRestaurante.id;
          }
        }

        // Create profile with restaurante association and role
        await app.db.insert(schema.profiles).values({
          userId: userId,
          restauranteId: restauranteId,
          role: userRole,
          name,
          createdAt: now,
        });

        // Generate session token (UUID)
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        // Create session
        await app.db.insert(sessionTable).values({
          id: randomUUID(),
          token,
          userId: userId,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        });

        app.logger.info({ userId, email }, "Sign up successful");

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
                  image: { type: ["string", "null"] },
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

        // Get profile
        const profiles = await app.db
          .select()
          .from(schema.profiles)
          .where(eq(schema.profiles.userId, user.id))
          .limit(1);

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
          updatedAt: new Date(),
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
          return reply.status(401).send({ error: "Não autorizado" });
        }

        const token = authHeader.slice(7).trim();

        // Look up session by token
        const sessions = await app.db
          .select()
          .from(sessionTable)
          .where(eq(sessionTable.token, token))
          .limit(1);

        if (!sessions || sessions.length === 0) {
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

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          active: user.active,
        };
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
