import { eq } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import { verifyAsaasWebhook } from "../utils/webhook-auth.js";
import * as schema from "../db/schema/schema.js";

// === Plans Definition ===
export const PLANOS = {
  trial: { nome: "Trial", preco: 0, dias_trial: 14, max_mesas: 5, max_usuarios: 2 },
  basico: { nome: "Básico", preco: 99.90, dias_trial: 0, max_mesas: 15, max_usuarios: 5 },
  profissional: { nome: "Profissional", preco: 199.90, dias_trial: 0, max_mesas: 50, max_usuarios: 15 },
  enterprise: { nome: "Enterprise", preco: 399.90, dias_trial: 0, max_mesas: 999, max_usuarios: 999 },
};

// === Asaas Integration ===
const ASAAS_BASE_URL = process.env.ASAAS_ENV === "production" ? "https://api.asaas.com/api/v3" : "https://sandbox.asaas.com/api/v3";

function getAsaasApiKey(): string {
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new Error("ASAAS_API_KEY não configurada");
  return key;
}

async function asaasRequest(method: string, path: string, body?: any): Promise<any> {
  const res = await fetch(ASAAS_BASE_URL + path, {
    method,
    headers: { "Content-Type": "application/json", "access_token": getAsaasApiKey() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok && res.status !== 422) {
    throw new Error("Asaas API error " + res.status + ": " + JSON.stringify(data));
  }
  return data;
}

async function getOrCreateCustomer(restauranteId: string, email: string, cpfCnpj: string): Promise<string> {
  const externalRef = `sub_${restauranteId}`;
  const search = await asaasRequest("GET", "/customers?externalReference=" + externalRef);
  if (search.data && search.data.length > 0) return search.data[0].id;

  const customer = await asaasRequest("POST", "/customers", {
    name: `Restaurante ${restauranteId}`,
    email,
    cpfCnpj,
    externalReference: externalRef,
  });
  return customer.id;
}

async function createSubscription(customerId: string, valor: number, restauranteId: string): Promise<string> {
  const hoje = new Date().toISOString().split("T")[0];
  const subscription = await asaasRequest("POST", "/subscriptions", {
    customer: customerId,
    billingType: "UNDEFINED",
    value: valor,
    nextDueDate: hoje,
    description: `Assinatura ${restauranteId}`,
    externalReference: `sub_${restauranteId}`,
  });
  return subscription.id;
}

// === Middleware ===
export async function checkAssinatura(app: App, restauranteId: string): Promise<boolean> {
  const db = app.db as any;
  const rest = await db.select({
    plano: schema.restaurante.plano,
    assinaturaStatus: schema.restaurante.assinaturaStatus,
    trialExpiraEm: schema.restaurante.trialExpiraEm,
  }).from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));

  if (!rest.length) return false;
  const restaurante = rest[0];

  // Check if trial expired
  if (restaurante.plano === "trial" && restaurante.trialExpiraEm) {
    if (new Date(restaurante.trialExpiraEm) < new Date()) {
      await db.update(schema.restaurante).set({ assinaturaStatus: "expirada" }).where(eq(schema.restaurante.id, restauranteId));
      return false;
    }
  }

  // Check status
  if (restaurante.assinaturaStatus === "cancelada" || restaurante.assinaturaStatus === "expirada") {
    return false;
  }

  return true;
}

export function registerAssinaturaRoutes(app: App) {
  const db = app.db as any;

  // GET /api/planos — list all available plans (public)
  app.fastify.get(
    "/api/planos",
    {
      schema: {
        description: "Get all available subscription plans",
        tags: ["subscription"],
        response: {
          200: {
            type: "object",
            properties: {
              planos: {
                type: "object",
                properties: {
                  trial: {
                    type: "object",
                    properties: {
                      nome: { type: "string" },
                      preco: { type: "number" },
                      dias_trial: { type: "number" },
                      max_mesas: { type: "number" },
                      max_usuarios: { type: "number" },
                    },
                  },
                  basico: { type: "object" },
                  profissional: { type: "object" },
                  enterprise: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      app.logger.info("Getting available plans");
      return { planos: PLANOS };
    }
  );

  // GET /api/assinatura — get current subscription status (protected)
  app.fastify.get(
    "/api/assinatura",
    {
      schema: {
        description: "Get current subscription status",
        tags: ["subscription"],
        response: {
          200: {
            type: "object",
            properties: {
              plano: { type: "string" },
              plano_detalhes: { type: "object" },
              assinatura_status: { type: "string" },
              trial_expira_em: { type: ["string", "null"] },
              trial_expirado: { type: "boolean" },
              assinatura_asaas_id: { type: ["string", "null"] },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const rest = await db.select().from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));
        if (!rest.length) return reply.code(404).send({ error: "Restaurante não encontrado" });

        const restaurante = rest[0];
        const trialExpirado = restaurante.plano === "trial" && restaurante.trialExpiraEm ? new Date(restaurante.trialExpiraEm) < new Date() : false;

        app.logger.info({ restauranteId, plano: restaurante.plano }, "Getting subscription status");
        return {
          plano: restaurante.plano,
          plano_detalhes: PLANOS[restaurante.plano as keyof typeof PLANOS],
          assinatura_status: restaurante.assinaturaStatus,
          trial_expira_em: restaurante.trialExpiraEm ? restaurante.trialExpiraEm.toISOString() : null,
          trial_expirado: trialExpirado,
          assinatura_asaas_id: restaurante.assinaturaAsaasId,
        };
      } catch (err) {
        app.logger.error({ err }, "Erro ao obter assinatura");
        return reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // POST /api/assinatura/upgrade — upgrade plan (protected)
  app.fastify.post<{ Body: { plano: string; email: string; cpf_cnpj: string } }>(
    "/api/assinatura/upgrade",
    {
      schema: {
        description: "Upgrade to a paid subscription plan",
        tags: ["subscription"],
        body: {
          type: "object",
          properties: {
            plano: { type: "string", enum: ["basico", "profissional", "enterprise"] },
            email: { type: "string", format: "email" },
            cpf_cnpj: { type: "string" },
          },
          required: ["plano", "email", "cpf_cnpj"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              plano: { type: "string" },
              assinatura_id: { type: "string" },
              valor_mensal: { type: "number" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          502: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { plano: string; email: string; cpf_cnpj: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        // Billing with the platform itself is an owner-level action — gerente
        // and other staff roles should not be able to change the plan.
        if (!requireRole(authUser, ["administrador", "admin", "superadmin", "super_admin"], reply)) return;
        const restauranteId = requireTenant(authUser);

        const { plano, email, cpf_cnpj } = request.body;

        if (!["basico", "profissional", "enterprise"].includes(plano)) {
          return reply.code(400).send({ error: "Plano inválido" });
        }

        if (!email || !cpf_cnpj) {
          return reply.code(400).send({ error: "Email e CPF/CNPJ são obrigatórios" });
        }

        app.logger.info({ restauranteId, plano, email }, "Upgrading subscription");

        const rest = await db.select().from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));
        if (!rest.length) return reply.code(404).send({ error: "Restaurante não encontrado" });

        const valor = PLANOS[plano as keyof typeof PLANOS].preco;

        try {
          const customerId = await getOrCreateCustomer(restauranteId, email, cpf_cnpj);
          const subscriptionId = await createSubscription(customerId, valor, restauranteId);

          await db.update(schema.restaurante).set({
            plano,
            assinaturaStatus: "ativa",
            assinaturaAsaasId: subscriptionId,
            trialExpiraEm: null,
          }).where(eq(schema.restaurante.id, restauranteId));

          app.logger.info({ restauranteId, plano, subscriptionId }, "Subscription upgraded successfully");
          return reply.code(200).send({
            success: true,
            plano,
            assinatura_id: subscriptionId,
            valor_mensal: valor,
          });
        } catch (err) {
          app.logger.error({ err: (err as any).message }, "Erro ao criar assinatura no Asaas");
          return reply.code(502).send({ error: "Erro ao processar assinatura. Verifique sua conexão com o serviço de pagamento." });
        }
      } catch (err) {
        app.logger.error({ err }, "Erro ao fazer upgrade");
        return reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // POST /api/assinatura/cancelar — cancel subscription (protected)
  app.fastify.post(
    "/api/assinatura/cancelar",
    {
      schema: {
        description: "Cancel subscription",
        tags: ["subscription"],
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        // Billing with the platform itself is an owner-level action — gerente
        // and other staff roles should not be able to cancel the subscription.
        if (!requireRole(authUser, ["administrador", "admin", "superadmin", "super_admin"], reply)) return;
        const restauranteId = requireTenant(authUser);

        app.logger.info({ restauranteId }, "Cancelling subscription");

        const rest = await db.select().from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));
        if (!rest.length) return reply.code(404).send({ error: "Restaurante não encontrado" });

        const restaurante = rest[0];
        if (!restaurante.assinaturaAsaasId) {
          return reply.code(400).send({ error: "Nenhuma assinatura ativa para cancelar" });
        }

        // Try to cancel in Asaas but don't fail if it doesn't work
        try {
          await asaasRequest("DELETE", "/subscriptions/" + restaurante.assinaturaAsaasId);
        } catch (err) {
          app.logger.warn({ err: (err as any).message }, "Erro ao cancelar assinatura no Asaas");
        }

        await db.update(schema.restaurante).set({
          assinaturaStatus: "cancelada",
        }).where(eq(schema.restaurante.id, restauranteId));

        app.logger.info({ restauranteId }, "Subscription cancelled successfully");
        return reply.code(200).send({
          success: true,
          message: "Assinatura cancelada",
        });
      } catch (err) {
        app.logger.error({ err }, "Erro ao cancelar assinatura");
        return reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // POST /api/webhooks/asaas/assinatura — Asaas webhook (public)
  app.fastify.post(
    "/api/webhooks/asaas/assinatura",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        if (!verifyAsaasWebhook(request, reply, app.logger)) return;
        const body = request.body as any;
        const event = body?.event;
        const payment = body?.payment;

        if (!event || !payment) {
          return reply.code(200).send({ received: true });
        }

        app.logger.info({ event, externalReference: payment.externalReference }, "Asaas webhook received");

        const externalRef = payment.externalReference;
        if (!externalRef?.startsWith("sub_")) {
          return reply.code(200).send({ received: true });
        }

        const restauranteId = externalRef.replace("sub_", "");

        if (event === "PAYMENT_OVERDUE") {
          await db.update(schema.restaurante).set({
            assinaturaStatus: "inadimplente",
          }).where(eq(schema.restaurante.id, restauranteId));
          app.logger.info({ restauranteId }, "Subscription marked as overdue");
        } else if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
          await db.update(schema.restaurante).set({
            assinaturaStatus: "ativa",
          }).where(eq(schema.restaurante.id, restauranteId));
          app.logger.info({ restauranteId }, "Subscription marked as active");
        }

        return reply.code(200).send({ received: true });
      } catch (err) {
        app.logger.error({ err }, "Erro ao processar webhook Asaas");
        return reply.code(200).send({ received: true });
      }
    }
  );
}
