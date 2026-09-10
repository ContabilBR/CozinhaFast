/**
 * Autenticação de webhooks Asaas.
 *
 * O Asaas envia o header `asaas-access-token` com o valor configurado no painel
 * (Integrações > Webhooks > Token de autenticação). Sem essa verificação qualquer
 * pessoa pode forjar PAYMENT_RECEIVED e confirmar pagamentos/assinaturas.
 *
 * Política fail-closed: se ASAAS_WEBHOOK_TOKEN não estiver configurado no
 * ambiente, o webhook é REJEITADO (não liberado).
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";

export function getAsaasWebhookToken(): string | undefined {
  return process.env.ASAAS_WEBHOOK_TOKEN
    || process.env.SPECULAR_SECRET_ASAAS_WEBHOOK_TOKEN
    || process.env.SECRET_ASAAS_WEBHOOK_TOKEN;
}

function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Retorna true se o webhook for autêntico.
 * Se não for, já respondeu 401 — o handler deve apenas dar `return`.
 */
export function verifyAsaasWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
  logger: any
): boolean {
  const expected = getAsaasWebhookToken();
  if (!expected) {
    logger.error("ASAAS_WEBHOOK_TOKEN nao configurado - webhook rejeitado (fail-closed)");
    reply.code(401).send({ error: "Webhook nao autenticado" });
    return false;
  }
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const raw = headers["asaas-access-token"];
  const received = Array.isArray(raw) ? raw[0] : raw;
  if (!received || !safeCompare(received, expected)) {
    logger.warn({ ip: request.ip }, "Webhook Asaas com token invalido - rejeitado");
    reply.code(401).send({ error: "Webhook nao autenticado" });
    return false;
  }
  return true;
}
