import { eq, and, desc } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";

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
          400: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          401: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          500: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: DeliveryBody }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
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
    async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const statusFiltro = (request.query as any)?.status;
        let entregas;
        if (statusFiltro) {
          entregas = await db.select().from(schema.entregas).where(and(eq(schema.entregas.restauranteId, restauranteId), eq(schema.entregas.status, statusFiltro))).orderBy(desc(schema.entregas.createdAt));
        } else {
          entregas = await db.select().from(schema.entregas).where(eq(schema.entregas.restauranteId, restauranteId)).orderBy(desc(schema.entregas.createdAt));
        }

        // Buscar comandas e itens para cada entrega
        const pedidos = [];
        for (const entrega of entregas) {
          const [comanda] = await db.select().from(schema.comandas).where(eq(schema.comandas.id, entrega.comandaId));
          const itens = await db.select({ id: schema.pedidos.id, quantidade: schema.pedidos.quantidade, precoUnitario: schema.pedidos.precoUnitario, observacao: schema.pedidos.observacao, pratoId: schema.pedidos.pratoId, status: schema.pedidos.status }).from(schema.pedidos).where(eq(schema.pedidos.comandaId, entrega.comandaId));
          pedidos.push({ entrega, comanda, itens });
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
              entrega: { type: "object" },
              comanda: { type: "object" },
              itens: { type: "array" },
              pagamentos: { type: "array" },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          401: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          500: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
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
        const itens = await db.select().from(schema.pedidos).where(eq(schema.pedidos.comandaId, entrega.comandaId));
        const pagamentos = await db.select().from(schema.pagamentos).where(eq(schema.pagamentos.comandaId, entrega.comandaId));

        return reply.code(200).send({ entrega, comanda, itens, pagamentos });
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
            status: { type: "string", enum: ["pendente", "preparando", "saiu_entrega", "entregue", "cancelada"] },
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
          400: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          401: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          500: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { status: string; entregador_nome?: string; entregador_telefone?: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const [entrega] = await db.select().from(schema.entregas).where(and(eq(schema.entregas.id, request.params.id), eq(schema.entregas.restauranteId, restauranteId)));
        if (!entrega) return reply.code(404).send({ error: "Entrega não encontrada" });

        const { status, entregador_nome, entregador_telefone } = request.body;
        const statusValidos = ["pendente", "preparando", "saiu_entrega", "entregue", "cancelada"];
        if (!statusValidos.includes(status)) return reply.code(400).send({ error: "Status inválido. Opções: " + statusValidos.join(", ") });

        const updateData: any = { status };

        if (status === "saiu_entrega") {
          updateData.saiuEm = new Date();
          if (entregador_nome) updateData.entregadorNome = entregador_nome;
          if (entregador_telefone) updateData.entregadorTelefone = entregador_telefone;
        }

        if (status === "entregue") {
          updateData.entregueEm = new Date();
        }

        if (status === "cancelada") {
          // Cancelar comanda também
          await db.update(schema.comandas).set({ status: "cancelada" }).where(eq(schema.comandas.id, entrega.comandaId));
        }

        await db.update(schema.entregas).set(updateData).where(eq(schema.entregas.id, request.params.id));

        const [entregaAtualizada] = await db.select().from(schema.entregas).where(eq(schema.entregas.id, request.params.id));
        return reply.code(200).send({ entrega: entregaAtualizada });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao atualizar status delivery");
        return reply.code(500).send({ error: "Erro interno" });
      }
    }
  );
}
