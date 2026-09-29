import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { api, authenticatedApi, signUpTestUser, expectStatus, cleanupTestData } from "./helpers";

afterAll(cleanupTestData);

// ---------------------------------------------------------------------------
// Internal helper — creates a mesa + prato + comanda + 1 pedido in one call.
// ---------------------------------------------------------------------------
async function criarCenario(adminToken: string, garcomToken: string, preco = "25.00", quantidade = 1) {
  // Cria mesa
  const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ numero: Math.floor(Math.random() * 900000) + 100000, capacidade: 4 }),
  });
  await expectStatus(mesaRes, 201);
  const mesa = await mesaRes.json() as any;

  // Cria prato
  const pratoRes = await authenticatedApi("/api/pratos", adminToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: `Prato Fechamento ${Date.now()}`, preco, disponivel: true }),
  });
  await expectStatus(pratoRes, 201);
  const pratoData = await pratoRes.json() as any;

  // Cria comanda
  const comandaRes = await authenticatedApi("/api/comandas", garcomToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mesaId: mesa.id }),
  });
  await expectStatus(comandaRes, 201);
  const comandaData = await comandaRes.json() as any;

  // Adiciona pedido
  const pedidoRes = await authenticatedApi(`/api/comandas/${comandaData.comanda.id}/pedidos`, garcomToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ prato_id: pratoData.prato.id, quantidade, preco_unitario: parseFloat(preco) }],
    }),
  });
  await expectStatus(pedidoRes, 201);

  return { mesa, prato: pratoData.prato, comanda: comandaData.comanda };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("Fechamento de Comanda — POST /api/comandas/:id/fechar", () => {
  let adminToken: string;
  let garcomToken: string;
  let garcomUserId: string;
  let garcomUserName: string;

  beforeAll(async () => {
    const admin = await signUpTestUser("administrador");
    adminToken = admin.token;
    const garcom = await signUpTestUser("garcom");
    garcomToken = garcom.token;
    garcomUserId = garcom.user.id;
    garcomUserName = garcom.user.name;
  });

  // =========================================================================
  // Cenário 1 — Fechamento simples sem gorjeta
  // =========================================================================
  test("Cenário 1 — Fechamento simples sem gorjeta retorna 200 com totais corretos", async () => {
    // prato R$ 30, pedidos: quantidade 2 e quantidade 1 → subtotal = 90
    const { mesa, prato, comanda } = await criarCenario(adminToken, garcomToken, "30.00", 2);

    // Adiciona segundo pedido (quantidade 1) na mesma comanda
    const pedido2Res = await authenticatedApi(`/api/comandas/${comanda.id}/pedidos`, garcomToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ prato_id: prato.id, quantidade: 1, preco_unitario: 30 }],
      }),
    });
    await expectStatus(pedido2Res, 201);

    const fecharRes = await authenticatedApi(`/api/comandas/${comanda.id}/fechar`, garcomToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await expectStatus(fecharRes, 200);

    const data = await fecharRes.json() as any;
    expect(data.success).toBe(true);
    expect(parseFloat(data.subtotal)).toBe(90);
    expect(parseFloat(data.total_final)).toBe(90);
    expect(parseFloat(data.gorjeta)).toBe(0);
    expect(data.mesa_numero).toBeDefined();

    // Verifica estrutura de itens
    expect(Array.isArray(data.itens)).toBe(true);
    expect(data.itens.length).toBeGreaterThan(0);
    const item = data.itens[0] as any;
    expect(item.prato_nome).toBeDefined();
    expect(item.quantidade).toBeDefined();
    expect(item.preco_unitario).toBeDefined();
    expect(item.subtotal_item).toBeDefined();
  });

  // =========================================================================
  // Cenário 2 — Fechamento com gorjeta
  // =========================================================================
  test("Cenário 2 — Fechamento com gorjeta retorna subtotal + gorjeta no total_final", async () => {
    // prato R$ 50, quantidade 1 → subtotal = 50, gorjeta = 10, total_final = 60
    const { comanda } = await criarCenario(adminToken, garcomToken, "50.00", 1);

    const fecharRes = await authenticatedApi(`/api/comandas/${comanda.id}/fechar`, garcomToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gorjeta: 10 }),
    });
    await expectStatus(fecharRes, 200);

    const data = await fecharRes.json() as any;
    expect(data.success).toBe(true);
    expect(parseFloat(data.subtotal)).toBe(50);
    expect(parseFloat(data.gorjeta)).toBe(10);
    expect(parseFloat(data.total_final)).toBe(60);
  });

  // =========================================================================
  // Cenário 3 — Estado pós-fechamento
  // =========================================================================
  test("Cenário 3 — Após fechar: mesa fica disponivel, comanda some, historico registra", async () => {
    const { mesa, comanda } = await criarCenario(adminToken, garcomToken, "20.00", 1);

    // Fecha a comanda
    const fecharRes = await authenticatedApi(`/api/comandas/${comanda.id}/fechar`, garcomToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await expectStatus(fecharRes, 200);

    // Mesa deve estar sem comanda aberta
    const mesaComandaRes = await authenticatedApi(`/api/mesas/${mesa.id}/comanda`, garcomToken);
    await expectStatus(mesaComandaRes, 200);
    const mesaComandaData = await mesaComandaRes.json() as any;
    expect(mesaComandaData.comanda).toBeNull();

    // Mesa deve estar disponivel
    const mesaRes = await authenticatedApi(`/api/mesas/${mesa.id}`, garcomToken);
    await expectStatus(mesaRes, 200);
    const mesaData = await mesaRes.json() as any;
    expect(mesaData.status).toBe("disponivel");

    // Historico deve conter a comanda fechada
    const historicoRes = await authenticatedApi("/api/historico", garcomToken);
    await expectStatus(historicoRes, 200);
    const historico = await historicoRes.json() as any[];
    const entrada = historico.find((h: any) => h.id === comanda.id);
    expect(entrada).toBeDefined();
    expect(entrada.status).toBe("fechada");
    expect(entrada.fechado_por_id).toBeDefined();
    expect(entrada.fechado_por_nome).toBeDefined();
    expect(entrada.fechado_por_role).toBeDefined();
    expect(Array.isArray(entrada.pedidos)).toBe(true);
    expect(entrada.pedidos.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // Cenário 4 — Fechamento com pagamento confirmado igual ao total
  // =========================================================================
  test("Cenário 4 — Fechamento com pagamento confirmado igual ao total retorna 200 com pagamentos", async () => {
    // prato R$ 40, quantidade 1 → total = 40
    const { comanda } = await criarCenario(adminToken, garcomToken, "40.00", 1);

    // Registra pagamento exato
    const pagamentoRes = await authenticatedApi(`/api/comandas/${comanda.id}/pagamentos`, garcomToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forma_pagamento: "dinheiro", valor: 40.00 }),
    });
    await expectStatus(pagamentoRes, 201);

    // Fecha a comanda
    const fecharRes = await authenticatedApi(`/api/comandas/${comanda.id}/fechar`, garcomToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await expectStatus(fecharRes, 200);

    const data = await fecharRes.json() as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.pagamentos)).toBe(true);
    expect(data.pagamentos.length).toBeGreaterThan(0);
    const pag = data.pagamentos[0] as any;
    expect(pag.forma_pagamento).toBe("dinheiro");
    expect(parseFloat(pag.valor)).toBe(40);

    // Historico deve conter a comanda com pagamentos
    const historicoRes = await authenticatedApi("/api/historico", garcomToken);
    await expectStatus(historicoRes, 200);
    const historico = await historicoRes.json() as any[];
    const entrada = historico.find((h: any) => h.id === comanda.id);
    expect(entrada).toBeDefined();
  });

  // =========================================================================
  // Cenário 5 — Pagamento pendente (PULADO)
  // =========================================================================
  test.skip(
    // Não há como criar pagamento pendente via API — POST /api/comandas/:id/pagamentos sempre cria com status confirmado
    "Cenário 5 — Pagamento pendente bloqueia fechamento (não testável via API)",
    async () => {
      // Este cenário não pode ser implementado porque POST /api/comandas/:id/pagamentos
      // sempre cria pagamentos com status "confirmado". Não existe endpoint para criar
      // pagamentos com status "pendente" via API pública.
    }
  );

  // =========================================================================
  // Cenário 6 — Pagamento menor que o total
  // =========================================================================
  test("Cenário 6 — Pagamento menor que o total retorna 400 com mensagem 'Total pago'", async () => {
    // prato R$ 100, quantidade 1 → total = 100
    const { comanda } = await criarCenario(adminToken, garcomToken, "100.00", 1);

    // Registra pagamento de apenas R$ 50 (metade)
    const pagamentoRes = await authenticatedApi(`/api/comandas/${comanda.id}/pagamentos`, garcomToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forma_pagamento: "dinheiro", valor: 50.00 }),
    });
    await expectStatus(pagamentoRes, 201);

    // Tenta fechar — deve falhar
    const fecharRes = await authenticatedApi(`/api/comandas/${comanda.id}/fechar`, garcomToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await expectStatus(fecharRes, 400);

    const data = await fecharRes.json() as any;
    expect(typeof data.error).toBe("string");
    expect(data.error.startsWith("Total pago")).toBe(true);
  });

  // =========================================================================
  // Cenário 7 — Fechar a mesma comanda duas vezes
  // =========================================================================
  test("Cenário 7 — Segunda tentativa de fechar retorna 404 (comanda deletada após primeiro fechamento)", async () => {
    const { comanda } = await criarCenario(adminToken, garcomToken, "25.00", 1);

    // Primeira vez — deve funcionar
    const fechar1Res = await authenticatedApi(`/api/comandas/${comanda.id}/fechar`, garcomToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await expectStatus(fechar1Res, 200);

    // Segunda vez — comanda foi deletada, deve retornar 404
    const fechar2Res = await authenticatedApi(`/api/comandas/${comanda.id}/fechar`, garcomToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await expectStatus(fechar2Res, 404);
  });

  // =========================================================================
  // Cenário 8 — Fechar comanda cancelada
  // =========================================================================
  test("Cenário 8 — Fechar comanda cancelada retorna 400 com 'comanda não está aberta'", async () => {
    const { comanda } = await criarCenario(adminToken, garcomToken, "25.00", 1);

    // Cancela a comanda
    const cancelarRes = await authenticatedApi(`/api/comandas/${comanda.id}/cancelar`, garcomToken, {
      method: "PUT",
    });
    await expectStatus(cancelarRes, 200);

    // Tenta fechar a comanda cancelada
    const fecharRes = await authenticatedApi(`/api/comandas/${comanda.id}/fechar`, garcomToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await expectStatus(fecharRes, 400);

    const data = await fecharRes.json() as any;
    expect(data.error).toBe("comanda não está aberta");
  });

  // =========================================================================
  // Cenário 9 — Cozinheiro não pode fechar
  // =========================================================================
  test("Cenário 9 — Cozinheiro não pode fechar comanda (retorna 403)", async () => {
    // Cria cenário com token de administrador/garcom
    const { comanda } = await criarCenario(adminToken, garcomToken, "25.00", 1);

    // Cria usuário com role "cozinheiro"
    const cozinheiro = await signUpTestUser("cozinheiro");
    const cozinheiroToken = cozinheiro.token;

    // Tenta fechar com token do cozinheiro
    const fecharRes = await authenticatedApi(`/api/comandas/${comanda.id}/fechar`, cozinheiroToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await expectStatus(fecharRes, 403);
  });
});
