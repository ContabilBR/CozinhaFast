import type { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { randomUUID } from "crypto";
import * as bcryptjs from "bcryptjs";

// Despite the Better-Auth-shaped paths (/api/auth/sign-up/email, /api/auth/sign-in,
// /api/auth/me, /api/auth/sign-out), every handler below reads and writes the
// SAME custom tables as routes/auth-custom.ts (usuarios / usuarios_session).
// This file exists only so the test suite (see tests/helpers.ts) has stable,
// unauthenticated entry points to create users with an arbitrary role — the
// real app only ever calls /api/login and /api/me from auth-custom.ts.

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
          app.logger.warn({ email, hasMissing: !name || !email || !password }, "Sign up failed: missing required fields");
          return reply.status(400).send({ error: "Name, email e senha são obrigatórios" });
        }

        // Check if user already exists in custom auth usuarios table
        const normalizedEmail = email.toLowerCase().trim();
        let existing: any[] = [];
        try {
          existing = await app.db
            .select()
            .from(schema.usuarios)
            .where(eq(schema.usuarios.email, normalizedEmail))
            .limit(1);
        } catch (err) {
          app.logger.error({ err, email: normalizedEmail }, "Failed to check existing usuario");
          throw err;
        }

        if (existing && existing.length > 0) {
          app.logger.info({ email: normalizedEmail }, "Sign up failed: email already exists");
          return reply.status(409).send({ error: "Email já cadastrado" });
        }

        // "role" vem direto do corpo da requisicao sem validacao de quem esta
        // pedindo — inclui "administrador". So chega aqui se ALLOW_TEST_SIGNUP
        // estiver "true" (checagem no topo deste handler).
        const userId = randomUUID();
        const now = new Date();
        const userRole = role || "garcom";

        // Ensure a restaurante exists - get first or create default
        app.logger.debug({}, "Looking for existing restaurante");
        let restaurantes: any = [];
        try {
          restaurantes = await app.db.select().from(schema.restaurante).limit(1);
        } catch (err) {
          app.logger.error({ err }, "Failed to query restaurante table");
          restaurantes = [];
        }

        let restauranteId: string = "";

        if (restaurantes && restaurantes.length > 0) {
          restauranteId = restaurantes[0].id;
          app.logger.debug({ restauranteId }, "Using existing restaurante");
        }

        if (!restauranteId) {
          // No restaurante exists, create one
          app.logger.debug({}, "Creating default restaurante");
          try {
            const inserted = await app.db
              .insert(schema.restaurante)
              .values({
                nome: 'Default Restaurant',
              })
              .returning();

            if (!inserted || inserted.length === 0) {
              throw new Error('Failed to create restaurante - no ID returned');
            }
            restauranteId = inserted[0].id;
            app.logger.debug({ restauranteId }, "Created default restaurante");
          } catch (err) {
            app.logger.error({ err }, "Failed to create restaurante");
            throw err;
          }
        }

        if (!restauranteId) {
          throw new Error('No restaurante ID available');
        }

        // Hash password
        const senhaHash = await bcryptjs.hash(password, 10);
        app.logger.debug({ userId, email: normalizedEmail }, "Hashed password");

        // Create usuario (custom auth system)
        app.logger.debug({ userId, email: normalizedEmail, userRole }, "Creating usuario");
        try {
          await app.db.insert(schema.usuarios).values({
            id: userId,
            nome: name,
            email: normalizedEmail,
            senhaHash,
            role: userRole,
            restauranteId: restauranteId,
          });
        } catch (err) {
          app.logger.error({ err, userId, email: normalizedEmail }, "Failed to create usuario");
          throw err;
        }
        app.logger.debug({ userId }, "Usuario created");

        // Generate session token
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        app.logger.info({ tokenStart: token.substring(0, 20), userId }, "Creating session");

        // Create session in custom auth system
        try {
          await app.db.insert(schema.usuariosSession).values({
            token,
            userId: userId.toString(),
            expiresAt,
          });
        } catch (err) {
          app.logger.error({ err, userId, tokenStart: token.substring(0, 20) }, "Failed to create usuario session");
          throw err;
        }
        app.logger.info({ tokenStart: token.substring(0, 20), userId }, "Session created successfully");
        app.logger.info({ userId, email: normalizedEmail }, "Sign up successful");

        return reply.status(201).send({
          token,
          user: {
            id: userId,
            name,
            email: normalizedEmail,
            role: userRole,
            active: true,
            emailVerified: true,
            image: null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        });
      } catch (error) {
        app.logger.error({ err: error, email: request.body.email }, "Sign up failed with error");
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
          return reply.status(400).send({ error: "Email and password are required" });
        }

        // Look up user in custom auth system (usuarios table)
        const normalizedEmail = email.toLowerCase().trim();
        let users: any[] = [];
        try {
          users = await app.db
            .select()
            .from(schema.usuarios)
            .where(eq(schema.usuarios.email, normalizedEmail))
            .limit(1);
        } catch (err) {
          app.logger.error({ err, email: normalizedEmail }, "Failed to query usuarios table");
          throw err;
        }

        if (!users || users.length === 0) {
          app.logger.info({ email: normalizedEmail }, "Sign in failed: user not found");
          return reply.status(401).send({ error: "Credenciais inválidas" });
        }

        const user = users[0];
        const senhaHash = user.senhaHash;

        if (!senhaHash) {
          app.logger.info({ userId: user.id }, "Sign in failed: no password set");
          return reply.status(401).send({ error: "Credenciais inválidas" });
        }

        // Verify password
        const isPasswordValid = await bcryptjs.compare(password, senhaHash);

        if (!isPasswordValid) {
          app.logger.info({ email: normalizedEmail }, "Sign in failed: invalid password");
          return reply.status(401).send({ error: "Credenciais inválidas" });
        }

        // Generate session token
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        app.logger.debug({ userId: user.id, tokenLength: token.length }, "Creating session");

        // Create session in custom auth system
        try {
          await app.db.insert(schema.usuariosSession).values({
            token,
            userId: user.id.toString(),
            expiresAt,
          });
        } catch (err) {
          app.logger.error({ err, userId: user.id }, "Failed to create usuario session");
          throw err;
        }

        app.logger.info({ userId: user.id, email: normalizedEmail }, "Sign in successful");

        return reply.status(200).send({
          token,
          user: {
            id: user.id,
            name: user.nome,
            email: user.email,
            role: user.role,
            active: true,
            emailVerified: true,
            image: null,
            createdAt: user.createdAt?.toISOString() || new Date().toISOString(),
            updatedAt: user.updatedAt?.toISOString() || new Date().toISOString(),
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
        app.logger.debug({ tokenLength: token.length, tokenStart: token.substring(0, 20) }, "Looking up session in /api/auth/me");

        // Look up session in custom auth system (usuariosSession table)
        let sessions: any[] = [];
        try {
          sessions = await app.db
            .select()
            .from(schema.usuariosSession)
            .where(eq(schema.usuariosSession.token, token))
            .limit(1);
        } catch (err) {
          app.logger.error({ err, token: token.substring(0, 20) }, "Failed to query usuariosSession table");
          return reply.status(401).send({ error: "Não autorizado" });
        }

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

        // Get user from usuarios table
        let users: any[] = [];
        try {
          users = await app.db
            .select()
            .from(schema.usuarios)
            .where(eq(schema.usuarios.id, session.userId as any))
            .limit(1);
        } catch (err) {
          app.logger.error({ err, userId: session.userId }, "Failed to query usuarios table in /api/auth/me");
          return reply.status(401).send({ error: "Não autorizado" });
        }

        if (!users || users.length === 0) {
          return reply.status(401).send({ error: "Não autorizado" });
        }

        const user = users[0];

        app.logger.info({ userId: user.id }, "Get current user via /api/auth/me");

        return reply.code(200).send({
          id: user.id,
          email: user.email,
          name: user.nome,
          role: user.role,
          active: true,
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

        // Delete session from custom auth system (usuariosSession table)
        await app.db
          .delete(schema.usuariosSession)
          .where(eq(schema.usuariosSession.token, token));

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
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const users = await app.db.select().from(schema.usuarios);

        app.logger.info({ userCount: users.length }, "Seed status retrieved");

        return reply.status(200).send({
          users: users.length,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get seed status");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );
}
