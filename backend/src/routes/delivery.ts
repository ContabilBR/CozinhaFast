import { eq, and, desc } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";
import { realtimeHub } from "../realtime/hub.js";

interface DeliveryBody {
  cliente_nome: string;
  cliente_telefone: string;
  endereco: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  cep?: string;
  referencia?: string;
  taxa_entrega?: number;
  tempo_estimado?: number;
  observacao?: string;
  itens: Array<{ prato_id: string; quantidade: number; observacao?: string }>;
}

export function registerDeliveryRoutes(app: App) {
  const db = app.db as any;

  // POST /api/delivery/pedidos — criar pedido delivery
  app.fastify.post<{ Body: DeliveryBody }>(
    "/api/delivery/pedidos",
    {
      schema: {
        description: "Create a new delivery order",
        tags: ["delivery"],
        body: {
          type: "object",
          required: ["cliente_nome", "cliente_telefone", "endereco", "itens"],
          properties: {
            cliente_nome: { type: "string" },
            cliente_telefone: { type: "string" },
            endereco: { type: "string" },
            complemento: { type: "string" },
            bairro: { type: "string" },
            cidade: { type: "string" },
            cep: { type: "string" },
            referencia: { type: "string" },
            taxa_entrega: { type: "number" },
            tempo_estimado: { type: "integer" },
            observacao: { type: "string" },
            itens: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["prato_id", "quantidade"],
                properties: {
                  prato_id: { type: "string", format: "uuid" },
                  quantidade: { type: "integer", minimum: 1 },
                  observacao: { type: "string" },
                },
              },
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              comanda: { type: "object" },
              entrega: { type: "object" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: DeliveryBody }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!requireRole(authUser, ["garcom", "gerente", "administrador", "admin", "superadmin", "super_admin"], reply)) return;
        const restauranteId = requireTenant(authUser);
        const body = request.body;

        if (!body.cliente_nome || !body.cliente_telefone || !body.endereco) {
          return reply.code(400).send({ error: "cliente_nome, cliente_telefone e endereco são obrigatórios" });
        }
        if (!body.itens || body.itens.length === 0) {
          return reply.code(400).send({ error: "Informe pelo menos um item" });
        }

        const result = await (db as any).transaction(async (tx: any) => {
          // Buscar preços dos pratos
          let subtotal = 0;
          const itensPedido: any[] = [];
          for (const item of body.itens) {
            const [prato] = await tx.select({ id: schema.pratos.id, preco: schema.pratos.preco, nome: schema.pratos.nome }).from(schema.pratos).where(and(eq(schema.pratos.id, item.prato_id), eq(schema.pratos.restauranteId, restauranteId)));
            if (!prato) return { error: "Prato não encontrado: " + item.prato_id };
            const precoUnit = parseFloat(prato.preco);
            subtotal += precoUnit * item.quantidade;
            itensPedido.push({ pratoId: item.prato_id, quantidade: item.quantidade, precoUnitario: prato.preco, observacao: item.observacao || null });
          }

          const taxaEntrega = body.taxa_entrega || 0;
          const total = subtotal + taxaEntrega;

          // Criar comanda tipo delivery (sem mesa)
          const [comanda] = await tx.insert(schema.comandas).values({
            tipo: "delivery",
            mesaId: null,
            mesaNumero: null,
            garcomId: authUser.id,
            status: "aberta",
            subtotal: subtotal.toString(),
            total: total.toString(),
            restauranteId,
          }).returning();

          // Inserir pedidos
          for (const item of itensPedido) {
            await tx.insert(schema.pedidos).values({
              comandaId: comanda.id,
              pratoId: item.pratoId,
              quantidade: item.quantidade,
              precoUnitario: item.precoUnitario,
              observacao: item.observacao,
              status: "pendente",
              restauranteId,
            });
          }

          // Criar entrega
          const [entrega] = await tx.insert(schema.entregas).values({
            comandaId: comanda.id,
            clienteNome: body.cliente_nome,
            clienteTelefone: body.cliente_telefone,
            endereco: body.endereco,
            complemento: body.complemento || null,
            bairro: body.bairro || null,
            cidade: body.cidade || null,
            cep: body.cep || null,
            referencia: body.referencia || null,
            taxaEntrega: taxaEntrega.toString(),
            tempoEstimado: body.tempo_estimado || null,
            observacao: body.observacao || null,
            restauranteId,
          }).returning();

          return { comanda, entrega };
        });

        if (result.error) return reply.code(400).send({ error: result.error });

        // Publicar evento realtime para a cozinha
        try {
          realtimeHub.publish(restauranteId, {
            type: "delivery.criado",
            entityId: result.comanda.id,
            occurredAt: new Date().toISOString(),
            payload: {
              comanda_id: result.comanda.id,
              tipo: "delivery",
              status: result.entrega.status,
              cliente_nome: result.entrega.clienteNome,
            },
          });
        } catch (pubErr) {
          app.logger.error({ err: pubErr }, "Failed to publish delivery.criado event");
        }

        return reply.code(201).send({ comanda: result.comanda, entrega: result.entrega });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao criar pedido delivery");
        return reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // GET /api/delivery/pedidos — listar pedidos delivery
  app.fastify.get(
    "/api/delivery/pedidos",
    {
      schema: {
        description: "List delivery orders",
        tags: ["delivery"],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              pedidos: {
                type: "array",
                items: { type: "object", additionalProperties: true },
              },
              total: { type: "number" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);
        if (!restauranteId) {
          return reply.code(401).send({ error: "Nenhum restaurante associado" });
        }

        const statusFiltro = (request.query as any)?.status;
        let entregas;
        if (statusFiltro) {
          entregas = await db.select().from(schema.entregas).where(and(eq(schema.entregas.restauranteId, restauranteId), eq(schema.entregas.status, statusFiltro))).orderBy(desc(schema.entregas.createdAt));
        } else {
          entregas = await db.select().from(schema.entregas).where(eq(schema.entregas.restauranteId, restauranteId)).orderBy(desc(schema.entregas.createdAt));
        }

        // Buscar comandas e itens para cada entrega, com prato_nome e status
        const pedidos = [];
        for (const entrega of entregas) {
          const [comanda] = await db.select().from(schema.comandas).where(eq(schema.comandas.id, entrega.comandaId));
          const itens = await db
            .select({
              id: schema.pedidos.id,
              quantidade: schema.pedidos.quantidade,
              precoUnitario: schema.pedidos.precoUnitario,
              observacao: schema.pedidos.observacao,
              pratoId: schema.pedidos.pratoId,
              status: schema.pedidos.status,
              prato_nome: schema.pratos.nome,
            })
            .from(schema.pedidos)
            .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
            .where(eq(schema.pedidos.comandaId, entrega.comandaId));

          const itens_ativos = itens.filter((i: any) => i.status !== "cancelado").length;
          const itens_prontos = itens.filter((i: any) => i.status === "pronto").length;
          const pronto_para_despachar =
            itens_ativos > 0 &&
            itens_prontos === itens_ativos &&
            ["pendente", "preparando"].includes(entrega.status);

          pedidos.push({
            entrega: { ...entrega, itens_ativos, itens_prontos, pronto_para_despachar },
            comanda,
            itens,
          });
        }

        return reply.code(200).send({ pedidos, total: pedidos.length });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao listar delivery");
        return reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // GET /api/delivery/pedidos/:id — detalhes de um pedido delivery
  app.fastify.get<{ Params: { id: string } }>(
    "/api/delivery/pedidos/:id",
    {
      schema: {
        description: "Get delivery order details by ID",
        tags: ["delivery"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              entrega: {
                type: "object",
                properties: {
                  itens_ativos: { type: "number" },
                  itens_prontos: { type: "number" },
                  pronto_para_despachar: { type: "boolean" },
                },
                additionalProperties: true,
              },
              comanda: { type: "object", additionalProperties: true },
              itens: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    prato_nome: { type: "string" },
                    status: { type: "string" },
                  },
                  additionalProperties: true,
                },
              },
              pagamentos: { type: "array" },
              pode_cancelar: { type: "boolean" },
            },
            additionalProperties: true,
          },
          404: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const [entrega] = await db.select().from(schema.entregas).where(and(eq(schema.entregas.id, request.params.id), eq(schema.entregas.restauranteId, restauranteId)));
        if (!entrega) return reply.code(404).send({ error: "Entrega não encontrada" });

        const [comanda] = await db.select().from(schema.comandas).where(eq(schema.comandas.id, entrega.comandaId));
        const itens = await db
          .select({
            id: schema.pedidos.id,
            quantidade: schema.pedidos.quantidade,
            precoUnitario: schema.pedidos.precoUnitario,
            observacao: schema.pedidos.observacao,
            pratoId: schema.pedidos.pratoId,
            status: schema.pedidos.status,
            canceladoEm: schema.pedidos.canceladoEm,
            canceladoPorId: schema.pedidos.canceladoPorId,
            canceladoPorNome: schema.pedidos.canceladoPorNome,
            canceladoPorRole: schema.pedidos.canceladoPorRole,
            motivoCancelamento: schema.pedidos.motivoCancelamento,
            motivoCancelamentoDetalhe: schema.pedidos.motivoCancelamentoDetalhe,
            canceladoAposInicio: schema.pedidos.canceladoAposInicio,
            prato_nome: schema.pratos.nome,
          })
          .from(schema.pedidos)
          .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
          .where(eq(schema.pedidos.comandaId, entrega.comandaId));
        const pagamentos = await db.select().from(schema.pagamentos).where(eq(schema.pagamentos.comandaId, entrega.comandaId));

        const itens_ativos = itens.filter((i: any) => i.status !== "cancelado").length;
        const itens_prontos = itens.filter((i: any) => i.status === "pronto").length;
        const pronto_para_despachar =
          itens_ativos > 0 &&
          itens_prontos === itens_ativos &&
          ["pendente", "preparando"].includes(entrega.status);

        // Informações de cancelamento (vêm dos itens cancelados com registro)
        let cancelamento_info: any = null;
        if (entrega.status === "cancelada") {
          const itemCancelado = itens.find((i: any) => i.canceladoPorId || i.cancelado_por_id);
          if (itemCancelado) {
            cancelamento_info = {
              cancelado_por_nome: itemCancelado.canceladoPorNome || itemCancelado.cancelado_por_nome || null,
              cancelado_por_role: itemCancelado.canceladoPorRole || itemCancelado.cancelado_por_role || null,
              cancelado_em: itemCancelado.canceladoEm || itemCancelado.cancelado_em || null,
              motivo_cancelamento: itemCancelado.motivoCancelamento || itemCancelado.motivo_cancelamento || null,
              motivo_cancelamento_detalhe: itemCancelado.motivoCancelamentoDetalhe || itemCancelado.motivo_cancelamento_detalhe || null,
              houve_perda: itens.some((i: any) => i.canceladoAposInicio || i.cancelado_apos_inicio),
            };
          }
        }

        // Calcular pode_cancelar e motivo_nao_pode_cancelar para o usuário atual
        const userRole = (authUser.role || "").toLowerCase();
        const ehGestorAtual = ["gerente", "administrador", "admin", "manager", "superadmin", "super_admin"].includes(userRole);
        const ehCozinheiro = ["cozinheiro", "kitchen"].includes(userRole);

        let pode_cancelar = false;
        let motivo_nao_pode_cancelar: string | null = null;

        if (ehCozinheiro) {
          motivo_nao_pode_cancelar = "Cozinheiro não pode cancelar pedidos de delivery.";
        } else if (entrega.status === "entregue") {
          motivo_nao_pode_cancelar = "Não é possível cancelar uma entrega já entregue.";
        } else if (entrega.status === "cancelada") {
          motivo_nao_pode_cancelar = "Esta entrega já foi cancelada.";
        } else if (pagamentos.length > 0) {
          motivo_nao_pode_cancelar = "A comanda já tem pagamento confirmado. Procure o gerente para estorno.";
        } else {
          const itensAtivosLocal = itens.filter((i: any) => i.status !== "cancelado");
          const itensIniciadosLocal = itensAtivosLocal.filter((i: any) => i.status === "em_preparo" || i.status === "pronto");
          const entregaSaiuLocal = entrega.status === "saiu_entrega";

          if (!ehGestorAtual && entregaSaiuLocal) {
            motivo_nao_pode_cancelar = "Só gerente ou administrador pode cancelar um pedido que já saiu para entrega.";
          } else if (!ehGestorAtual && itensIniciadosLocal.length > 0) {
            motivo_nao_pode_cancelar = "Só gerente ou administrador pode cancelar um pedido que já está em preparo.";
          } else {
            pode_cancelar = true;
          }
        }

        return reply.code(200).send({
          entrega: { ...entrega, itens_ativos, itens_prontos, pronto_para_despachar, cancelamento_info },
          comanda,
          itens,
          pagamentos,
          pode_cancelar,
          motivo_nao_pode_cancelar,
        });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao consultar delivery");
        return reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // PUT /api/delivery/pedidos/:id/status — atualizar status da entrega
  app.fastify.put<{ Params: { id: string }; Body: { status: string; entregador_nome?: string; entregador_telefone?: string } }>(
    "/api/delivery/pedidos/:id/status",
    {
      schema: {
        description: "Update delivery order status",
        tags: ["delivery"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        body: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["saiu_entrega", "entregue"] },
            entregador_nome: { type: "string" },
            entregador_telefone: { type: "string" },
          },
          required: ["status"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              entrega: { type: "object" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { status: string; entregador_nome?: string; entregador_telefone?: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!requireRole(authUser, ["garcom", "gerente", "administrador", "admin", "superadmin", "super_admin"], reply)) return;
        const restauranteId = requireTenant(authUser);

        const [entrega] = await db.select().from(schema.entregas)
          .where(and(eq(schema.entregas.id, request.params.id), eq(schema.entregas.restauranteId, restauranteId)));
        if (!entrega) return reply.code(404).send({ error: "Entrega não encontrada" });

        const { status, entregador_nome, entregador_telefone } = request.body;

        if (status === "cancelada") {
          return reply.code(409).send({ error: "Para cancelar um pedido de delivery use PUT /api/delivery/pedidos/:id/cancelar (motivo obrigatório)." });
        }

        // Sequência válida
        const SEQUENCIA = ["pendente", "preparando", "saiu_entrega", "entregue"];
        const idxAtual = SEQUENCIA.indexOf(entrega.status);
        const idxNovo = SEQUENCIA.indexOf(status);

        if (idxNovo === -1) return reply.code(400).send({ error: "Status inválido." });
        if (idxNovo !== idxAtual + 1) {
          return reply.code(409).send({ error: `Não é possível passar de "${entrega.status}" para "${status}". A sequência correta é: ${SEQUENCIA.join(" → ")}.` });
        }

        // Ao despachar: entregador_nome obrigatório + todos os itens ativos prontos
        if (status === "saiu_entrega") {
          if (!entregador_nome?.trim()) {
            return reply.code(400).send({ error: "O nome de quem vai entregar é obrigatório para despachar." });
          }
          const itens = await db.select({ status: schema.pedidos.status })
            .from(schema.pedidos)
            .where(eq(schema.pedidos.comandaId, entrega.comandaId));
          const ativos = itens.filter((i: any) => i.status !== "cancelado");
          const prontos = ativos.filter((i: any) => i.status === "pronto");
          if (ativos.length === 0) {
            return reply.code(409).send({ error: "Não há itens ativos neste pedido." });
          }
          if (prontos.length < ativos.length) {
            return reply.code(409).send({ error: `Ainda há itens em preparo. ${prontos.length} de ${ativos.length} itens prontos.` });
          }
        }

        const updateData: any = { status };
        if (status === "saiu_entrega") {
          updateData.saiuEm = new Date();
          updateData.entregadorNome = entregador_nome!.trim();
          if (entregador_telefone) updateData.entregadorTelefone = entregador_telefone;
        }
        if (status === "entregue") {
          updateData.entregueEm = new Date();
        }

        await db.update(schema.entregas).set(updateData).where(eq(schema.entregas.id, request.params.id));
        const [entregaAtualizada] = await db.select().from(schema.entregas).where(eq(schema.entregas.id, request.params.id));

        // Publicar evento realtime
        try {
          realtimeHub.publish(restauranteId, {
            type: "delivery.status_changed",
            entityId: entrega.comandaId,
            occurredAt: new Date().toISOString(),
            payload: { comanda_id: entrega.comandaId, tipo: "delivery", status, cliente_nome: entrega.clienteNome },
          });
        } catch (pubErr) {
          app.logger.error({ err: pubErr }, "Failed to publish delivery event");
        }

        return reply.code(200).send({ entrega: entregaAtualizada });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao atualizar status delivery");
        return reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // PUT /api/delivery/pedidos/:id/cancelar — cancelar pedido de delivery com motivo
  app.fastify.put<{ Params: { id: string }; Body: { motivo: string; detalhe?: string } }>(
    "/api/delivery/pedidos/:id/cancelar",
    {
      schema: {
        description: "Cancelar pedido de delivery com motivo",
        tags: ["delivery"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["motivo"],
          properties: {
            motivo: { type: "string" },
            detalhe: { type: "string", maxLength: 300 },
          },
        },
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" }, houve_perda: { type: "boolean" } } },
          400: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);
        const { motivo, detalhe } = request.body;
        const entregaId = request.params.id;

        const MOTIVOS_VALIDOS = [
          "erro_lancamento", "cliente_desistiu", "item_em_falta", "demora",
          "qualidade", "outro", "cliente_nao_atendeu", "endereco_fora_area",
        ];
        if (!MOTIVOS_VALIDOS.includes(motivo)) {
          return reply.code(400).send({ error: "Motivo inválido." });
        }
        if (motivo === "outro" && (!detalhe || !detalhe.trim())) {
          return reply.code(400).send({ error: "O detalhe é obrigatório quando o motivo é 'outro'." });
        }

        // Cozinheiro nunca cancela
        const role = (authUser.role || "").toLowerCase();
        if (["cozinheiro", "kitchen"].includes(role)) {
          return reply.code(403).send({ error: "Cozinheiro não pode cancelar pedidos de delivery." });
        }

        const ehGestor = ["gerente", "administrador", "admin", "manager", "superadmin", "super_admin"].includes(role);

        // Tudo dentro de uma transação
        const resultado = await (db as any).transaction(async (tx: any) => {
          // 1) Buscar e travar a entrega
          const [entrega] = await tx.select()
            .from(schema.entregas)
            .where(and(eq(schema.entregas.id, entregaId), eq(schema.entregas.restauranteId, restauranteId)))
            .for("update");
          if (!entrega) return { erro: "Entrega não encontrada", code: 404 };

          // 2) Verificar estado da entrega
          if (entrega.status === "entregue") {
            return { erro: "Não é possível cancelar uma entrega já entregue.", code: 409 };
          }
          if (entrega.status === "cancelada") {
            return { erro: "Esta entrega já foi cancelada.", code: 409 };
          }

          // 3) Buscar e travar a comanda
          const [comanda] = await tx.select()
            .from(schema.comandas)
            .where(and(eq(schema.comandas.id, entrega.comandaId), eq(schema.comandas.restauranteId, restauranteId)))
            .for("update");
          if (!comanda) return { erro: "Comanda não encontrada", code: 404 };

          // 4) Verificar pagamento confirmado
          const pagamentos = await tx.select({ id: schema.pagamentos.id })
            .from(schema.pagamentos)
            .where(eq(schema.pagamentos.comandaId, comanda.id));
          if (pagamentos.length > 0) {
            return { erro: "Não é possível cancelar: a comanda já tem pagamento confirmado. Procure o gerente para estorno.", code: 409 };
          }

          // 5) Buscar todos os itens
          const itens = await tx.select()
            .from(schema.pedidos)
            .where(eq(schema.pedidos.comandaId, comanda.id));

          // 6) Verificar se algum item já foi entregue
          const itemEntregue = itens.find((i: any) => i.status === "entregue");
          if (itemEntregue) {
            return { erro: "Não é possível cancelar: um ou mais itens já foram entregues.", code: 409 };
          }

          // 7) Verificar permissão por momento
          const itensAtivos = itens.filter((i: any) => i.status !== "cancelado");
          const itensIniciados = itensAtivos.filter((i: any) => i.status === "em_preparo" || i.status === "pronto");
          const entregaSaiu = entrega.status === "saiu_entrega";

          if (!ehGestor) {
            // Garçom só pode cancelar se tudo pendente e entrega não saiu
            if (entregaSaiu) {
              return { erro: "Só gerente ou administrador pode cancelar um pedido que já saiu para entrega.", code: 403 };
            }
            if (itensIniciados.length > 0) {
              return { erro: "Só gerente ou administrador pode cancelar um pedido que já está em preparo.", code: 403 };
            }
          }

          // 8) Cancelar todos os itens ativos
          const agora = new Date();
          let houvePerda = false;
          for (const item of itensAtivos) {
            const aposInicio = item.status === "em_preparo" || item.status === "pronto" || entregaSaiu;
            if (aposInicio) houvePerda = true;
            await tx.update(schema.pedidos)
              .set({
                status: "cancelado",
                canceladoEm: agora,
                canceladoPorId: authUser.id,
                canceladoPorNome: ((authUser as any).name || (authUser as any).nome || "Desconhecido") as string,
                canceladoPorRole: authUser.role,
                motivoCancelamento: motivo as any,
                motivoCancelamentoDetalhe: detalhe || null,
                canceladoAposInicio: aposInicio,
              })
              .where(eq(schema.pedidos.id, item.id));
          }

          // 9) Marcar entrega como cancelada
          await tx.update(schema.entregas)
            .set({ status: "cancelada" as any })
            .where(eq(schema.entregas.id, entregaId));

          // 10) Marcar comanda como cancelada e zerar totais
          await tx.update(schema.comandas)
            .set({ status: "cancelada" as any, subtotal: "0.00", total: "0.00" })
            .where(eq(schema.comandas.id, comanda.id));

          return { ok: true, houvePerda, clienteNome: entrega.clienteNome, comandaId: comanda.id };
        });

        if (resultado.erro) {
          return reply.code(resultado.code).send({ error: resultado.erro });
        }

        // Publicar evento realtime após a transação
        try {
          realtimeHub.publish(restauranteId, {
            type: "delivery.cancelado",
            entityId: resultado.comandaId,
            occurredAt: new Date().toISOString(),
            payload: {
              comanda_id: resultado.comandaId,
              tipo: "delivery",
              status: "cancelada",
              cliente_nome: resultado.clienteNome,
              houve_item_iniciado: resultado.houvePerda,
            },
          });
        } catch (pubErr) {
          app.logger.error({ err: pubErr }, "Failed to publish delivery.cancelado event");
        }

        return reply.code(200).send({ ok: true, houve_perda: resultado.houvePerda });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao cancelar delivery");
        return reply.code(500).send({ error: "Erro interno" });
      }
    }
  );
}
