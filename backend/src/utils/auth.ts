import type { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";

export interface AuthContext {
  id: string;
  email: string;
  role: string;
  name: string;
  restauranteId: string;
}

/**
 * Validates the Bearer token against the app's single auth system
 * (usuarios / usuarios_session), which is the only one the frontend
 * (and every other client) ever authenticates against.
 */
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

    const usuariosSessions = await app.db
      .select()
      .from(schema.usuariosSession)
      .where(eq(schema.usuariosSession.token, token))
      .limit(1);

    if (!usuariosSessions || usuariosSessions.length === 0) {
      app.logger.warn({ token: token.substring(0, 20) }, "No session found");
      reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    const usuarioSession = usuariosSessions[0];

    if (new Date(usuarioSession.expiresAt) < new Date()) {
      app.logger.warn({ sessionId: usuarioSession.id }, "Session expired");
      reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    const usuarioResults = await app.db
      .select()
      .from(schema.usuarios)
      .where(eq(schema.usuarios.id, usuarioSession.userId as any))
      .limit(1);

    if (!usuarioResults || usuarioResults.length === 0) {
      app.logger.warn({ userId: usuarioSession.userId }, "User not found for session");
      reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    const usuario = usuarioResults[0];
    const rid = usuario.restauranteId ? String(usuario.restauranteId) : null;

    if (!rid) {
      app.logger.warn({ usuarioId: usuario.id }, "User has no tenant associated");
      reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    app.logger.debug({ usuarioId: usuario.id }, "User authenticated");
    return {
      id: usuario.id.toString(),
      email: usuario.email,
      role: usuario.role,
      name: usuario.nome,
      restauranteId: rid,
    };
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
