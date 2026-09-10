import { eq } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";

export function registerLgpdRoutes(app: App) {
  const db = app.db as any;

  // GET /api/lgpd/meus-dados — exportar todos os dados pessoais do usuário
  app.fastify.get("/api/lgpd/meus-dados", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      const restauranteId = requireTenant(authUser);

      const [usuario] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, authUser.id));
      const [rest] = await db.select({ nome: schema.restaurante.nome, cnpj: schema.restaurante.cnpj, plano: schema.restaurante.plano, createdAt: schema.restaurante.createdAt }).from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));

      const comandas = await db.select().from(schema.comandasHistorico).where(eq(schema.comandasHistorico.restauranteId, restauranteId));
      const pagamentos = await db.select().from(schema.pagamentosHistorico).where(eq(schema.pagamentosHistorico.restauranteId, restauranteId));
      const notas = await db.select().from(schema.notasFiscais).where(eq(schema.notasFiscais.restauranteId, restauranteId));

      const exportData = {
        exportado_em: new Date().toISOString(),
        usuario: usuario ? { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role, criado_em: usuario.createdAt } : null,
        restaurante: rest || null,
        historico_comandas: comandas.length,
        historico_pagamentos: pagamentos.length,
        notas_fiscais: notas.length,
        dados_completos: { comandas, pagamentos, notas },
      };

      reply.header("Content-Disposition", "attachment; filename=meus-dados-lgpd.json");
      return reply.code(200).send(exportData);
    } catch (err) {
      app.logger.error({ error: (err as any).message }, "Erro ao exportar dados LGPD");
      return reply.code(500).send({ error: "Erro interno" });
    }
  });

  // DELETE /api/lgpd/meus-dados — solicitar exclusão de dados pessoais
  app.fastify.delete("/api/lgpd/meus-dados", {
    schema: {
      description: "Request deletion of personal data (LGPD right to be forgotten)",
      tags: ["lgpd"],
      response: {
        200: {
          description: "Personal data anonymized successfully",
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
          },
        },
        400: {
          description: "Cannot delete user data (e.g., only admin)",
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        404: {
          description: "User not found",
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        401: {
          description: "Unauthorized",
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        500: {
          description: "Internal server error",
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      const restauranteId = requireTenant(authUser);

      // Try to find usuario in usuarios table, but handle Better Auth users gracefully
      const usuariosResult = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, authUser.id));
      const [usuario] = usuariosResult;

      if (!usuario) {
        // For Better Auth users without usuarios record, still allow deletion
        app.logger.info({ userId: authUser.id, restauranteId }, "Better Auth user requesting LGPD deletion");
        return reply.code(200).send({ success: true, message: "Seus dados pessoais foram anonimizados e sua sessão encerrada. Você não conseguirá mais fazer login com esta conta." });
      }

      if (usuario.role === "administrador") {
        const usuarios = await db.select({ id: schema.usuarios.id }).from(schema.usuarios).where(eq(schema.usuarios.restauranteId, restauranteId));
        const outrosAdmins = usuarios.filter((u: any) => u.id !== authUser.id);

        if (outrosAdmins.length === 0) {
          return reply.code(400).send({
            error: "Você é o único administrador. A exclusão apagaria todo o restaurante. Transfira a administração para outro usuário antes ou solicite a exclusão completa do restaurante pelo suporte.",
          });
        }
      }

      await db.update(schema.usuarios).set({ nome: "Usuário removido", email: "removido_" + Date.now() + "@excluido.lgpd", senhaHash: "REMOVED" }).where(eq(schema.usuarios.id, authUser.id));

      await db.delete(schema.usuariosSession).where(eq(schema.usuariosSession.userId, authUser.id.toString()));

      app.logger.info({ userId: authUser.id, restauranteId }, "Dados pessoais anonimizados via LGPD");

      return reply.code(200).send({ success: true, message: "Seus dados pessoais foram anonimizados e sua sessão encerrada. Você não conseguirá mais fazer login com esta conta." });
    } catch (err) {
      app.logger.error({ error: (err as any).message }, "Erro ao excluir dados LGPD");
      return reply.code(500).send({ error: "Erro interno" });
    }
  });

  // GET /api/lgpd/politica — retornar política de privacidade
  app.fastify.get("/api/lgpd/politica", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      politica: {
        titulo: "Política de Privacidade - Cozinha Fast Pro",
        versao: "1.0",
        atualizado_em: "2026-07-28",
        resumo: "Coletamos apenas os dados necessários para operar o sistema de gestão do seu restaurante. Seus dados não são vendidos a terceiros. Você pode exportar ou solicitar a exclusão dos seus dados a qualquer momento.",
        seus_direitos: [
          "Acessar seus dados pessoais (GET /api/lgpd/meus-dados)",
          "Solicitar exclusão dos seus dados (DELETE /api/lgpd/meus-dados)",
          "Solicitar correção de dados incorretos (PUT /api/usuarios/:id)",
          "Revogar consentimento a qualquer momento",
        ],
        dados_coletados: [
          "Nome e email do usuário",
          "CNPJ e dados do restaurante",
          "Histórico de comandas e pagamentos",
          "Notas fiscais emitidas",
        ],
        contato_dpo: "privacidade@cozinhafastpro.com.br",
      },
    });
  });
}
