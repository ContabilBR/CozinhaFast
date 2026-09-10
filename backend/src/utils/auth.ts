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
        const rid = usuario.restauranteId ? String(usuario.restauranteId) : null;
        if (!rid) {
          app.logger.warn({ usuarioId: usuario.id }, "Usuario found but has no restauranteId");
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
          const rid = profileResults[0].restauranteId ? String(profileResults[0].restauranteId) : null;
          if (!rid) {
            app.logger.warn({ userId: user.id }, "Profile exists but has no restauranteId");
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

        app.logger.warn({ userId: user.id }, "No profile found in Path B");
        reply.status(403).send({ error: "No tenant" });
        return null;
      }

      reply.status(401).send({ error: "User not found" });
      return null;
    }

    // Step 2: Fall back to Better Auth session table
    let sessions;
    app.logger.debug({ token: token.substring(0, 20), tokenLength: token.length }, "Querying sessionTable for token");
    try {
      sessions = await app.db
        .select()
        .from(sessionTable)
        .where(eq(sessionTable.token, token))
        .limit(1);
      app.logger.debug({ found: sessions?.length || 0, token: token.substring(0, 20) }, "Session table query completed");
    } catch (queryErr) {
      app.logger.error({ err: queryErr, token: token.substring(0, 20) }, "Session table query failed");
      reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    if (!sessions || sessions.length === 0) {
      app.logger.warn({ token: token.substring(0, 20), tokenLength: token.length }, "No session found in sessionTable");
      reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    const session = sessions[0];

    if (new Date(session.expiresAt) < new Date()) {
      app.logger.warn({ sessionId: session.id, expiresAt: session.expiresAt }, "Session expired");
      reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    // Path C: Better Auth session → user table + profiles
    let users;
    try {
      users = await app.db
        .select()
        .from(userTable)
        .where(eq(userTable.id, session.userId))
        .limit(1);
    } catch (userQueryErr) {
      app.logger.error({ err: userQueryErr, userId: session.userId }, "User query failed in Path C");
      reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    if (users && users.length > 0) {
      const user = users[0];
      let userRole = (user as any).role ?? "garcom";

      let profilesList;
      try {
        profilesList = await app.db
          .select()
          .from(schema.profiles)
          .where(eq(schema.profiles.userId, user.id))
          .limit(1);
      } catch (profileQueryErr) {
        app.logger.error({ err: profileQueryErr, userId: user.id }, "Profile query failed in Path C");
        reply.status(403).send({ error: "No tenant" });
        return null;
      }

      if (profilesList && profilesList.length > 0) {
        userRole = profilesList[0].role;
        const rid = profilesList[0].restauranteId
          ? String(profilesList[0].restauranteId)
          : null;
        if (!rid) {
          app.logger.warn({ userId: user.id }, "Profile exists but has no restauranteId");
          reply.status(403).send({ error: "No tenant" });
          return null;
        }
        app.logger.debug({ userId: user.id, restauranteId: rid }, "User authenticated via Path C (Better Auth session)");
        return {
          id: user.id,
          email: user.email,
          role: userRole,
          name: user.name || "",
          restauranteId: rid,
        };
      }

      // No profile found - create one with a default restaurante
      app.logger.warn({ userId: user.id }, "No profile found, creating one with default restaurante");
      try {
        // Get or create default restaurante
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

        // Create profile
        await app.db.insert(schema.profiles).values({
          userId: user.id,
          restauranteId: restauranteId,
          role: userRole,
          name: user.name || "",
          createdAt: new Date(),
        });

        app.logger.info({ userId: user.id, restauranteId }, "Created profile for user during authentication");

        return {
          id: user.id,
          email: user.email,
          role: userRole,
          name: user.name || "",
          restauranteId: restauranteId,
        };
      } catch (profileCreateErr) {
        app.logger.error({ userId: user.id, err: profileCreateErr }, "Failed to create profile during authentication");
        reply.status(403).send({ error: "No tenant" });
        return null;
      }
    }

    // Path D: Better Auth session → usuarios table
    const usuariosD = await app.db
      .select()
      .from(schema.usuarios)
      .where(sql`${schema.usuarios.id}::text = ${session.userId}`)
      .limit(1);

    if (usuariosD && usuariosD.length > 0) {
      const usuario = usuariosD[0];
      const rid = usuario.restauranteId ? String(usuario.restauranteId) : null;
      if (!rid) {
        app.logger.warn({ usuarioId: usuario.id }, "Usuario found but has no restauranteId");
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

    app.logger.warn({ sessionUserId: session.userId }, "No user found in Path D");
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
