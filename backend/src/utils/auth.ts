import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, sql } from "drizzle-orm";
import { session as sessionTable, user as userTable } from "../db/schema/auth-schema.js";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";

export interface AuthContext {
  id: string;
  email: string;
  role: string;
  name: string;
  restauranteId: string;
}

export async function requireAuth(
  app: App,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthContext | null> {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      app.logger.warn({ authHeader: authHeader?.substring(0, 20) }, "Missing or invalid authorization header");
      reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    const token = authHeader.slice(7).trim();
    app.logger.debug({ tokenStart: token.substring(0, 20), tokenLength: token.length }, "Looking up session for token");

    // Try Better Auth session table
    let authContextOrNull: AuthContext | null = null;

    try {
      const sessions = await app.db
        .select()
        .from(sessionTable)
        .where(eq(sessionTable.token, token))
        .limit(1);

      app.logger.debug({ found: sessions?.length || 0 }, "Better Auth session table query result");

      if (sessions && sessions.length > 0) {
        const session = sessions[0];

        if (new Date(session.expiresAt) < new Date()) {
          app.logger.warn({ sessionId: session.id, expiresAt: session.expiresAt }, "Session expired");
          reply.status(401).send({ error: "Unauthorized" });
          return null;
        }

        // Get user from user table
        const users = await app.db
          .select()
          .from(userTable)
          .where(eq(userTable.id, session.userId))
          .limit(1);

        if (users && users.length > 0) {
          const user = users[0];
          let userRole = (user as any).role ?? "garcom";

          // Get or create profile
          let profilesList = await app.db
            .select()
            .from(schema.profiles)
            .where(eq(schema.profiles.userId, user.id))
            .limit(1);

          if (profilesList && profilesList.length > 0) {
            userRole = profilesList[0].role;
            const rid = profilesList[0].restauranteId ? String(profilesList[0].restauranteId) : null;
            if (rid) {
              app.logger.debug({ userId: user.id, restauranteId: rid }, "User authenticated via Better Auth");
              authContextOrNull = {
                id: user.id,
                email: user.email,
                role: userRole,
                name: user.name || "",
                restauranteId: rid,
              };
            }
          } else {
            // Create profile with default restaurante
            try {
              const defaultRestaurante = await app.db
                .select()
                .from(schema.restaurante)
                .limit(1);

              let restauranteId: string;
              if (defaultRestaurante.length > 0) {
                restauranteId = defaultRestaurante[0].id;
              } else {
                const [newRest] = await app.db
                  .insert(schema.restaurante)
                  .values({ nome: 'Default Restaurant' })
                  .returning();
                restauranteId = newRest.id;
              }

              await app.db.insert(schema.profiles).values({
                userId: user.id,
                restauranteId: restauranteId,
                role: userRole,
                name: user.name || "",
                createdAt: new Date(),
              });

              app.logger.info({ userId: user.id, restauranteId }, "Created profile during auth");
              authContextOrNull = {
                id: user.id,
                email: user.email,
                role: userRole,
                name: user.name || "",
                restauranteId: restauranteId,
              };
            } catch (profileErr) {
              app.logger.debug({ err: profileErr }, "Failed to create profile in Better Auth path");
            }
          }
        }
      }
    } catch (betterAuthErr) {
      app.logger.debug({ err: betterAuthErr, token: token.substring(0, 20) }, "Better Auth session query error");
    }

    if (authContextOrNull) {
      return authContextOrNull;
    }

    // If Better Auth lookup failed, try custom auth as fallback
    try {
      const usuariosSessions = await app.db
        .select()
        .from(schema.usuariosSession)
        .where(eq(schema.usuariosSession.token, token))
        .limit(1);

      if (usuariosSessions && usuariosSessions.length > 0) {
        const usuarioSession = usuariosSessions[0];

        if (new Date(usuarioSession.expiresAt) < new Date()) {
          app.logger.warn({ sessionId: usuarioSession.id }, "Custom session expired");
          reply.status(401).send({ error: "Unauthorized" });
          return null;
        }

        const usuarioResults = await app.db
          .select()
          .from(schema.usuarios)
          .where(eq(schema.usuarios.id, usuarioSession.userId as any))
          .limit(1);

        if (usuarioResults && usuarioResults.length > 0) {
          const usuario = usuarioResults[0];
          const rid = usuario.restauranteId ? String(usuario.restauranteId) : null;
          if (rid) {
            app.logger.debug({ usuarioId: usuario.id }, "User authenticated via custom auth");
            return {
              id: usuario.id.toString(),
              email: usuario.email,
              role: usuario.role,
              name: usuario.nome,
              restauranteId: rid,
            };
          }
        }
      }
    } catch (customAuthErr) {
      app.logger.debug({ err: customAuthErr }, "Custom auth session query failed");
    }

    app.logger.warn({ token: token.substring(0, 20) }, "No session found in either table");
    reply.status(401).send({ error: "Unauthorized" });
    return null;
  } catch (error) {
    app.logger.error({ err: error }, "Auth validation failed");
    reply.status(401).send({ error: "Unauthorized" });
    return null;
  }
}

export function requireRole(
  authUserOrUser: AuthContext | any,
  allowedRolesOrProfile?: string[] | any,
  allowedRolesOrReply?: string[] | FastifyReply,
  reply?: FastifyReply
): boolean {
  let userRole: string;
  let actualReply: FastifyReply;

  if (Array.isArray(allowedRolesOrProfile)) {
    userRole = authUserOrUser.role;
    actualReply = allowedRolesOrReply as FastifyReply;
    const allowedRoles = allowedRolesOrProfile as string[];
    const normalizedUserRole = userRole?.toLowerCase() ?? "";
    const normalizedAllowedRoles = allowedRoles.map(r => r.toLowerCase());
    if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
      actualReply.status(403).send({ error: "Forbidden", message: "Insufficient permissions" });
      return false;
    }
  } else {
    userRole = allowedRolesOrProfile?.role || authUserOrUser?.role;
    actualReply = reply!;
    const allowedRoles = allowedRolesOrReply as string[];
    const normalizedUserRole = userRole?.toLowerCase() ?? "";
    const normalizedAllowedRoles = allowedRoles.map(r => r.toLowerCase());
    if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
      actualReply.status(403).send({ error: "Forbidden", message: "Insufficient permissions" });
      return false;
    }
  }
  return true;
}

export function requireTenant(auth: AuthContext): string {
  if (!auth.restauranteId) {
    throw new Error("No tenant associated with this session");
  }
  return auth.restauranteId;
}
