import type { App } from '../index.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema/schema.js';
import * as bcryptjs from 'bcryptjs';
import { randomUUID } from 'crypto';
import { user as userTable, session as sessionTable } from '../db/schema/auth-schema.js';

interface LoginBody {
  email: string;
  senha: string;
}

export function registerCustomAuthRoutes(app: App) {
  // POST /api/login - Custom session login endpoint
  app.fastify.post<{ Body: LoginBody }>('/api/login', {
    schema: {
      description: 'Login with email and senha (password) - returns session token',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email', 'senha'],
        properties: {
          email: { type: 'string', format: 'email' },
          senha: { type: 'string' },
        },
      },
      response: {
        200: {
          description: 'Login successful',
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                nome: { type: 'string' },
                email: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const { email, senha } = request.body;

    // Validate input
    if (!email || !senha) {
      app.logger.warn('Login attempt with missing email or senha');
      return reply.status(400).send({ error: 'E-mail e senha são obrigatórios' });
    }

    app.logger.info({ email }, 'Login attempt');

    try {
      // Normalize email
      const normalizedEmail = email.toLowerCase().trim();
      app.logger.debug({ normalizedEmail }, 'Normalized email for lookup');

      // Query usuarios table
      app.logger.debug('Querying usuarios table');
      const usuarios = await app.db
        .select()
        .from(schema.usuarios)
        .where(eq(schema.usuarios.email, normalizedEmail));

      app.logger.debug({ usuariosFound: usuarios.length }, 'Query result');

      if (usuarios.length === 0) {
        app.logger.warn({ email: normalizedEmail }, 'User not found in usuarios table');
        return reply.status(401).send({ error: 'Invalid email or password' });
      }

      const user = usuarios[0];
      const senhaHash = user.senhaHash;

      app.logger.debug({
        userId: user.id,
        email: user.email,
        hasHash: !!senhaHash,
        hashLength: senhaHash?.length || 0
      }, 'User found, checking password hash');

      // Verify password hash exists
      if (!senhaHash) {
        app.logger.warn({ email: normalizedEmail }, 'User has no password hash');
        return reply.status(401).send({ error: 'Invalid email or password' });
      }

      // Verify password
      app.logger.debug({ senhaLength: senha.length }, 'Comparing password');
      const passwordMatch = await bcryptjs.compare(senha, senhaHash);

      app.logger.debug({ passwordMatch }, 'Password comparison result');

      if (!passwordMatch) {
        app.logger.warn({ email: normalizedEmail }, 'Password mismatch');
        return reply.status(401).send({ error: 'Invalid email or password' });
      }

      // Create session token (uuid)
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      app.logger.debug({ userId: user.id, expiresAt }, 'Creating session with 30-day expiry');

      // Create session record
      await app.db.insert(schema.usuariosSession).values({
        token,
        userId: user.id.toString(),
        expiresAt,
      });

      app.logger.info({ userId: user.id, email: user.email, role: user.role }, 'Session created successfully - returning role to client');

      return {
        token,
        user: {
          id: user.id,
          nome: user.nome,
          email: user.email,
          role: user.role,
        },
      };
    } catch (err) {
      app.logger.error({ err, email }, 'Login error');
      throw err;
    }
  });

  // GET /api/me - Get current user from session token
  app.fastify.get<{}>('/api/me', {
    schema: {
      description: 'Get current user profile from session token',
      tags: ['auth'],
      response: {
        200: {
          description: 'User profile',
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            nome: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    app.logger.info('GET /api/me - Fetching current user profile');
    try {
      const authHeader = request.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        app.logger.warn('No Bearer token in Authorization header');
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }

      const token = authHeader.slice(7).trim();

      // Try to get session from Better Auth first
      const betterAuthSessions = await app.db
        .select()
        .from(sessionTable)
        .where(eq(sessionTable.token, token))
        .limit(1);

      if (betterAuthSessions && betterAuthSessions.length > 0) {
        const session = betterAuthSessions[0];

        // Check if session is expired
        if (new Date(session.expiresAt) < new Date()) {
          app.logger.warn({ token: token.substring(0, 20) }, 'Better Auth session expired');
          return reply.status(401).send({ error: 'Invalid or expired token' });
        }

        // Get user from Better Auth user table
        const users = await app.db
          .select()
          .from(userTable)
          .where(eq(userTable.id, session.userId))
          .limit(1);

        if (!users || users.length === 0) {
          app.logger.warn({ userId: session.userId }, 'Better Auth user not found');
          return reply.status(401).send({ error: 'Invalid or expired token' });
        }

        const user = users[0];
        app.logger.info({ userId: user.id, email: user.email }, 'User profile fetched successfully via Better Auth');

        return {
          id: user.id,
          nome: user.name,
          email: user.email,
          role: (user as any).role || 'garcom',
        };
      }

      // Fall back to custom auth
      const isAuthenticated = await verifyAndAttachUser(app, request, reply);
      if (!isAuthenticated) return;

      const userId = (request as any).userId;
      app.logger.debug({ userId }, 'User authenticated via custom auth, looking up in usuarios table');

      // Look up user in usuarios table
      const usuarios = await app.db
        .select()
        .from(schema.usuarios)
        .where(eq(schema.usuarios.id, userId));

      if (usuarios.length === 0) {
        app.logger.warn({ userId }, 'User not found in usuarios table');
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }

      const user = usuarios[0];
      app.logger.info({ userId: user.id, email: user.email }, 'User profile fetched successfully via custom auth');

      return {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
      };
    } catch (err) {
      app.logger.error({ err }, 'GET /api/me error');
      throw err;
    }
  });

}

/**
 * Helper function to protect routes with session token authentication.
 * Validates the Bearer token in Authorization header against session table.
 * Attaches userId and role to request context.
 * Should be called at the start of protected route handlers.
 *
 * @param app - Application instance
 * @param request - Fastify request object
 * @param reply - Fastify reply object
 * @returns true if authentication succeeds, false if it fails (reply with 401 sent)
 *
 * Usage:
 * app.fastify.get('/api/protected', async (request, reply) => {
 *   if (!await verifyAndAttachUser(app, request, reply)) return;
 *   const userId = (request as any).userId;
 *   const role = (request as any).role;
 *   // ... route logic using userId and role
 * });
 */
export async function verifyAndAttachUser(
  app: App,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    app.logger.warn({ authHeader: authHeader?.substring(0, 20) }, 'No Bearer token in Authorization header for protected route');
    reply.status(401).send({ error: 'Invalid or expired token' });
    return false;
  }

  const token = authHeader.substring(7);
  app.logger.debug({ token: token.substring(0, 20) }, 'Validating bearer token');

  try {
    // Look up session token in usuarios_session table
    const sessions = await app.db
      .select()
      .from(schema.usuariosSession)
      .where(eq(schema.usuariosSession.token, token))
      .limit(1);

    if (!sessions || sessions.length === 0) {
      app.logger.warn({ token: token.substring(0, 20) }, 'Session token not found');
      reply.status(401).send({ error: 'Invalid or expired token' });
      return false;
    }

    const session = sessions[0];

    // Check if session has expired
    if (new Date(session.expiresAt) < new Date()) {
      app.logger.warn({ sessionId: session.id, expiresAt: session.expiresAt }, 'Session expired');
      reply.status(401).send({ error: 'Invalid or expired token' });
      return false;
    }

    // Get user from usuarios table
    const usuarios = await app.db
      .select()
      .from(schema.usuarios)
      .where(eq(schema.usuarios.id, session.userId as any))
      .limit(1);

    if (!usuarios || usuarios.length === 0) {
      app.logger.warn({ userId: session.userId }, 'User not found for session');
      reply.status(401).send({ error: 'Invalid or expired token' });
      return false;
    }

    const user = usuarios[0];

    // Attach user context to request for downstream handlers
    (request as any).userId = user.id;
    (request as any).role = user.role;
    (request as any).userEmail = user.email;
    (request as any).userName = user.nome;

    app.logger.debug(
      { userId: user.id, role: user.role },
      'Session token validated and user context attached'
    );
    return true;
  } catch (err) {
    app.logger.error(
      { err, token: token.substring(0, 20) },
      'Session token verification failed for protected route'
    );
    reply.status(401).send({ error: 'Invalid or expired token' });
    return false;
  }
}
