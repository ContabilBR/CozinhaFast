import { eq, and, ne } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";
import { randomUUID } from "crypto";

export function registerLgpdRoutes(app: App) {
  const db = app.db as any;

  // GET /api/lgpd/meus-dados — exportar todos os dados pessoais do usuário
  app.fastify.get(
    "/api/lgpd/meus-dados",
    {
      schema: {
        description: "Export all personal data for LGPD compliance",
        tags: ["lgpd"],
        response: {
          200: {
            type: "object",
            properties: {
              export_timestamp: { type: "string", format: "date-time" },
              user_info: { type: "object" },
              restaurant_info: { type: "object", nullable: true },
              summary: { type: "object" },
              data: { type: "object" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        app.logger.info({ userId: authUser.id }, "Exporting LGPD data");

        const usuariosResult = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, authUser.id));
        const [usuario] = usuariosResult;

        if (!usuario) {
          app.logger.warn({ userId: authUser.id }, "Usuarios record not found for LGPD export");
          return await reply.code(404).send({ error: "User not found" });
        }

        const restResult = await db
          .select()
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, restauranteId));
        const restaurante = restResult[0] || null;

        const comandas = await db
          .select()
          .from(schema.comandasHistorico)
          .where(eq(schema.comandasHistorico.restauranteId, restauranteId));
        const pagamentos = await db
          .select()
          .from(schema.pagamentosHistorico)
          .where(eq(schema.pagamentosHistorico.restauranteId, restauranteId));
        const notas = await db.select().from(schema.notasFiscais).where(eq(schema.notasFiscais.restauranteId, restauranteId));

        const exportData = {
          export_timestamp: new Date().toISOString(),
          user_info: {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            role: usuario.role,
            created_at: usuario.createdAt?.toISOString(),
          },
          restaurant_info: restaurante
            ? {
                id: restaurante.id,
                nome: restaurante.nome,
                cnpj: restaurante.cnpj,
                plano: restaurante.plano,
                created_at: restaurante.createdAt?.toISOString(),
              }
            : null,
          summary: {
            total_comandas_historico: comandas.length,
            total_pagamentos_historico: pagamentos.length,
            total_notas_fiscais: notas.length,
          },
          data: {
            comandas_historico: comandas,
            pagamentos_historico: pagamentos,
            notas_fiscais: notas,
          },
        };

        app.logger.info({ userId: authUser.id }, "LGPD data exported successfully");

        reply.header("Content-Disposition", "attachment; filename=meus-dados-lgpd.json");
        return await reply.code(200).send(exportData);
      } catch (err) {
        app.logger.error({ err }, "Erro ao exportar dados LGPD");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/lgpd/meus-dados — solicitar exclusão de dados pessoais
  app.fastify.delete(
    "/api/lgpd/meus-dados",
    {
      schema: {
        description: "Request deletion/anonymization of personal data (LGPD right to be forgotten)",
        tags: ["lgpd"],
        response: {
          200: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" } } },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;

        const userId = authUser.id;
        app.logger.info({ userId }, "Processing LGPD deletion request");

        try {
          var restauranteId = requireTenant(authUser);
        } catch (err) {
          restauranteId = null;
        }

        // Get user's usuarios record
        const usuariosResult = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, userId));
        const [usuario] = usuariosResult;

        if (!usuario) {
          // User only in auth, no usuarios record
          app.logger.info({ userId }, "User has no usuarios record, anonymizing auth user only");

          const anonymizedEmail = `removido-${randomUUID()}@removed.local`;

          // Anonymize profiles if exist
          const profilesResult = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
          if (profilesResult.length > 0) {
            await db.update(schema.profiles).set({ name: "Usuário removido" }).where(eq(schema.profiles.userId, userId));
          }

          // Delete custom sessions
          await db.delete(schema.usuariosSession).where(eq(schema.usuariosSession.userId, userId));

          app.logger.info({ userId }, "Auth user anonymized and sessions terminated");

          return await reply.code(200).send({
            success: true,
            message: "Seus dados foram anonimizados e suas sessões foram encerradas.",
          });
        }

        // User has usuario record - check role-based restrictions
        if (usuario.role === "garcom") {
          // Check for open non-delivery comandas assigned to this user
          const openComandasCount = await db
            .select()
            .from(schema.comandas)
            .where(
              and(
                eq(schema.comandas.garcomId, userId),
                eq(schema.comandas.status, "aberta"),
                ne(schema.comandas.tipo, "delivery")
              )
            )
            .limit(1);

          if (openComandasCount.length > 0) {
            app.logger.warn({ userId }, "Garcom has open comandas, cannot delete");
            return await reply.code(409).send({
              error: "Você tem comandas abertas. Por favor, feche ou transfira-as antes de solicitar a exclusão.",
            });
          }
        }

        if (usuario.role === "administrador") {
          // Check if they are the only admin for the restaurant
          const adminResult = await db
            .select()
            .from(schema.usuarios)
            .where(
              and(eq(schema.usuarios.restauranteId, restauranteId), eq(schema.usuarios.role, "administrador"))
            );

          if (adminResult.length === 1) {
            app.logger.warn({ userId }, "Only admin for restaurant, cannot delete");
            return await reply.code(400).send({
              error: "Você é o único administrador do restaurante. Por favor, transfira os direitos de administrador para outro usuário antes de solicitar a exclusão.",
            });
          }
        }

        const anonymizedEmail = `removido-${randomUUID()}@removed.local`;

        // Anonymize the usuario record
        await db
          .update(schema.usuarios)
          .set({
            nome: "Usuário removido",
            email: anonymizedEmail,
            senhaHash: "REMOVED",
          })
          .where(eq(schema.usuarios.id, userId));

        app.logger.info({ userId }, "Usuario record anonymized");

        // Anonymize profile if it exists
        const profilesResult = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
        if (profilesResult.length > 0) {
          await db
            .update(schema.profiles)
            .set({ name: "Usuário removido" })
            .where(eq(schema.profiles.userId, userId));
        }

        // Delete custom sessions
        await db.delete(schema.usuariosSession).where(eq(schema.usuariosSession.userId, userId));

        app.logger.info({ userId }, "User anonymized and sessions deleted");

        return await reply.code(200).send({
          success: true,
          message: "Seus dados pessoais foram anonimizados. Sua conta foi removida de nossos sistemas em conformidade com a LGPD.",
        });
      } catch (err) {
        app.logger.error({ err }, "Failed to process LGPD deletion request");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/lgpd/politica — Privacy policy (public)
  app.fastify.get(
    "/api/lgpd/politica",
    {
      schema: {
        description: "Get privacy policy (LGPD compliance - public endpoint)",
        tags: ["lgpd"],
        response: {
          200: {
            type: "object",
            properties: {
              titulo: { type: "string" },
              versao: { type: "string" },
              atualizado_em: { type: "string" },
              sumario: { type: "string" },
              direitos_dos_usuarios: { type: "array", items: { type: "string" } },
              dados_coletados: { type: "array", items: { type: "string" } },
              contato_dpo: { type: "string" },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      app.logger.info({}, "Fetching privacy policy");

      const policy = {
        titulo: "Política de Privacidade - Cozinha Fast Pro",
        versao: "1.0",
        atualizado_em: "2026-07-28",
        sumario:
          "A Cozinha Fast Pro coleta e processa dados pessoais de usuários para fornecer serviços de gestão de restaurantes. Nos comprometemos em proteger sua privacidade de acordo com a Lei Geral de Proteção de Dados Pessoais (LGPD).",
        direitos_dos_usuarios: [
          "Direito de acessar seus dados pessoais",
          "Direito de solicitar a exclusão de seus dados (direito ao esquecimento)",
          "Direito de solicitar correção de dados incorretos",
          "Direito de revogar consentimento para processamento de dados",
          "Direito de portabilidade de dados",
        ],
        dados_coletados: [
          "Nome e email do usuário",
          "CNPJ e dados do restaurante",
          "Histórico de comandas e pedidos",
          "Histórico de pagamentos",
          "Notas fiscais e documentos fiscais",
          "Logs de atividade do sistema",
        ],
        contato_dpo: "privacidade@cozinhafastpro.com.br",
      };

      return await reply.code(200).send(policy);
    }
  );
}
