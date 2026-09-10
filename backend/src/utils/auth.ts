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

    // Step 1: Try custom usuarios_session table first
    const usuariosSessions = await app.db
      .select()
      .from(schema.usuariosSession)
      .where(eq(schema.usuariosSession.token, token))
      .limit(1);

    if (usuariosSessions && usuariosSessions.length > 0) {
      const usuarioSession = usuariosSessions[0];

      if (new Date(usuarioSession.expiresAt) < new Date()) {
        reply.status(401).send({ error: "Unauthorized" });
        return null;
      }

      // Path A: usuarios_session → usuarios table
      const usuarioResults = await app.db
        .select()
        .from(schema.usuarios)
        .where(sql`${schema.usuarios.id}::text = ${usuarioSession.userId}`)
        .limit(1);

      if (usuarioResults && usuarioResults.length > 0) {
        const usuario = usuarioResults[0];
        const rid = usuario.restauranteId?.toString();
        if (!rid) {
          reply.status(403).send({ error: "No tenant" });
          return null;
        }
        return {
          id: usuario.id.toString(),
          email: usuario.email,
          role: usuario.role,
          name: usuario.nome,
          restauranteId: rid,
        };
      }

      // Path B: usuarios_session → user table + profiles
      const userResults = await app.db
        .select()
        .from(userTable)
        .where(eq(userTable.id, usuarioSession.userId))
        .limit(1);

      if (userResults && userResults.length > 0) {
        const user = userResults[0];
        let userRole = (user as any).role ?? "garcom";

        const profileResults = await app.db
          .select()
          .from(schema.profiles)
          .where(eq(schema.profiles.userId, user.id))
          .limit(1);

        if (profileResults && profileResults.length > 0) {
          userRole = profileResults[0].role;
          const rid = profileResults[0].restauranteId?.toString();
          if (!rid) {
            reply.status(403).send({ error: "No tenant" });
            return null;
          }
          return {
            id: user.id,
            email: user.email,
            role: userRole,
            name: user.name || "",
            restauranteId: rid,
          };
        }

        reply.status(403).send({ error: "No tenant" });
        return null;
      }

      reply.status(401).send({ error: "User not found" });
      return null;
    }

    // Step 2: Fall back to Better Auth session table
    const sessions = await app.db
      .select()
      .from(sessionTable)
      .where(eq(sessionTable.token, token))
      .limit(1);

    if (!sessions || sessions.length === 0) {
      reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    const session = sessions[0];

    if (new Date(session.expiresAt) < new Date()) {
      reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    // Path C: Better Auth session → user table + profiles
    const users = await app.db
      .select()
      .from(userTable)
      .where(eq(userTable.id, session.userId))
      .limit(1);

    if (users && users.length > 0) {
      const user = users[0];
      let userRole = (user as any).role ?? "garcom";

      const profilesList = await app.db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, user.id))
        .limit(1);

      if (profilesList && profilesList.length > 0) {
        userRole = profilesList[0].role;
        const rid = profilesList[0].restauranteId?.toString();
        if (!rid) {
          reply.status(403).send({ error: "No tenant" });
          return null;
        }
        return {
          id: user.id,
          email: user.email,
          role: userRole,
          name: user.name || "",
          restauranteId: rid,
        };
      }

      reply.status(403).send({ error: "No tenant" });
      return null;
    }

    // Path D: Better Auth session → usuarios table
    const usuariosD = await app.db
      .select()
      .from(schema.usuarios)
      .where(sql`${schema.usuarios.id}::text = ${session.userId}`)
      .limit(1);

    if (usuariosD && usuariosD.length > 0) {
      const usuario = usuariosD[0];
      const rid = usuario.restauranteId?.toString();
      if (!rid) {
        reply.status(403).send({ error: "No tenant" });
        return null;
      }
      return {
        id: usuario.id.toString(),
        email: usuario.email,
        role: usuario.role,
        name: usuario.nome,
        restauranteId: rid,
      };
    }

    reply.status(401).send({ error: "User not found" });
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
