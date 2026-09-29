import { describe, test, expect, beforeAll } from "bun:test";
import { api, authenticatedApi, expectStatus } from "./helpers";

// ---------------------------------------------------------------------------
// Testes do cancelamento de item: PUT /api/pedidos/:id/cancelar
//
// Regras testadas:
// - item cancelado NÃO é venda (total da comanda, pagamento, divisão de conta e fechamento);
// - pendente: garçom, gerente e administrador cancelam; cozinheiro não;
// - em preparo / pronto: só gerente e administrador (fica marcado como perda);
// - entregue não cancela; item já cancelado não cancela de novo;
// - motivo obrigatório ("outro" exige detalhe);
// - só cancela item de comanda aberta e do próprio restaurante;
// - as rotas antigas de status não cancelam mais (mensagem apontando para /cancelar).
//
// ISOLAMENTO DE DADOS
// Tudo roda dentro de um restaurante exclusivo de teste, criado em beforeAll pela rota de
// signup de restaurante (mesma técnica de fechamento-comanda.test.ts). Não usamos
// signUpTestUser (ele coloca o usuário no primeiro restaurante do banco) nem
// cleanupTestData (ele varre o restaurante padrão). A rota de signup aceita no máximo
// 10 chamadas por hora por IP: este arquivo usa duas (beforeAll e o teste de outro restaurante).
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "Content-Type": "application/json" };
const SENHA = "SenhaForte123!";

interface UsuarioTeste {
  token: string;
  id: string;
  nome: string;
  role: string;
}

async function criarRestauranteDeTeste(prefixo: string): Promise<string> {
  const sufixo = Date.now();
  const cnpj = `9${String(sufixo % 10000000).padStart(7, "0")}${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0")}`;
  const res = await api("/api/restaurantes/signup", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      nome: `${prefixo} ${sufixo}`,
      cnpj,
      adminNome: "Admin Cancelamento",
      adminEmail: `admin-cancelamento-${sufixo}-${Math.floor(Math.random() * 100000)}@test.com`,
      adminSenha: SENHA,
    }),
  });
  await expectStatus(res, 201);
  const token = ((await res.json()) as any).token;
  expect(token).toBeDefined();
  return token;
}

async function criarUsuario(adminToken: string, role: "garcom" | "gerente" | "cozinheiro"): Promise<UsuarioTeste> {
  const email = `${role}-${Date.now()}-${Math.floor(Math.random() * 100000)}@cancelamento.test`;
  const nome = `Teste ${role}`;

  const criarRes = await authenticatedApi("/api/usuarios", adminToken, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ nome, email, senha: SENHA, role }),
  });
  await expectStatus(criarRes, 201);

  const loginRes = await api("/api/login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, senha: SENHA }),
  });
  await expectStatus(loginRes, 200);
  const login = (await loginRes.json()) as any;

  return { token: login.token, id: login.user.id, nome: login.user.nome, role: login.user.role };
}

describe("Cancelamento de item: PUT /api/pedidos/:id/cancelar", () => {
  let adminToken: string;
  let garcom: UsuarioTeste;
  let gerente: UsuarioTeste;
  let cozinheiro: UsuarioTeste;
  let mesaId: string;
  let pratoAId: string; // R$ 30
  let pratoBId: string; // R$ 20

  interface ComandaComItens {
    comandaId: string;
    itemA: string; // pedido de R$ 30
    itemB: string; // pedido de R$ 20
  }

  // Abre uma comanda na mesa única com dois itens (R$ 30 e R$ 20 = R$ 50).
  async function abrirComandaComDoisItens(): Promise<ComandaComItens> {
    const comandaRes = await authenticatedApi("/api/comandas", garcom.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ mesaId }),
    });
    await expectStatus(comandaRes, 201);
    const comandaId: string = ((await comandaRes.json()) as any).comanda.id;

    const pedidosRes = await authenticatedApi(`/api/comandas/${comandaId}/pedidos`, garcom.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        items: [
          { prato_id: pratoAId, quantidade: 1, preco_unitario: 30 },
          { prato_id: pratoBId, quantidade: 1, preco_unitario: 20 },
        ],
      }),
    });
    await expectStatus(pedidosRes, 201);
    const pedidos = ((await pedidosRes.json()) as any).pedidos as any[];
    const itemA = pedidos.find((p: any) => p.pratoId === pratoAId || p.prato_id === pratoAId)?.id ?? pedidos[0].id;
    const itemB = pedidos.find((p: any) => p.pratoId === pratoBId || p.prato_id === pratoBId)?.id ?? pedidos[1].id;
    return { comandaId, itemA, itemB };
  }

  function cancelar(pedidoId: string, corpo: object, token: string = garcom.token): Promise<Response> {
    return authenticatedApi(`/api/pedidos/${pedidoId}/cancelar`, token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(corpo),
    });
  }

  function mudarStatus(pedidoId: string, status: string, token: string): Promise<Response> {
    return authenticatedApi(`/api/pedidos/${pedidoId}/status`, token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status }),
    });
  }

  function fechar(comandaId: string, body: object = {}, token: string = garcom.token): Promise<Response> {
    return authenticatedApi(`/api/comandas/${comandaId}/fechar`, token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  }

  // Encerra a comanda para liberar a mesa única para o cenário seguinte.
  async function encerrar(comandaId: string): Promise<void> {
    const res = await fechar(comandaId);
    await expectStatus(res, 200);
  }

  beforeAll(async () => {
    adminToken = await criarRestauranteDeTeste("Teste Cancelamento");
    const sufixo = Date.now();

    const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ numero: Math.floor(Math.random() * 900000) + 100000, capacidade: 4 }),
    });
    await expectStatus(mesaRes, 201);
    mesaId = ((await mesaRes.json()) as any).id;

    const criarPrato = async (nome: string, preco: string): Promise<string> => {
      const res = await authenticatedApi("/api/pratos", adminToken, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          nome: `${nome} ${sufixo}`,
          preco,
          disponivel: true,
          cfop: "5102",
          origem_mercadoria: 0,
          unidade_comercial: "un",
        }),
      });
      await expectStatus(res, 201);
      return ((await res.json()) as any).prato.id;
    };
    pratoAId = await criarPrato("Prato A", "30.00");
    pratoBId = await criarPrato("Prato B", "20.00");

    garcom = await criarUsuario(adminToken, "garcom");
    gerente = await criarUsuario(adminToken, "gerente");
    cozinheiro = await criarUsuario(adminToken, "cozinheiro");
  });

  // =========================================================================
  // Cancelamento de item pendente
  // =========================================================================
  test("Cenário 1: garçom cancela item pendente; o total da comanda passa a ignorá-lo", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();

    const res = await cancelar(itemA, { motivo: "erro_lancamento" });
    await expectStatus(res, 200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.status).toBe("cancelado");
    expect(data.cancelado_apos_inicio).toBe(false);
    expect(data.subtotal_comanda).toBe(20);
    expect(data.total_comanda).toBe(20);

    // A lista de comandas mostra o total e a quantidade de itens sem o cancelado
    const listaRes = await authenticatedApi("/api/comandas?status=aberta", garcom.token);
    await expectStatus(listaRes, 200);
    const lista = (await listaRes.json()) as any;
    const comandas: any[] = Array.isArray(lista) ? lista : lista.comandas;
    const daLista = comandas.find((c: any) => c.id === comandaId);
    expect(daLista).toBeDefined();
    expect(daLista.total).toBe(20);
    expect(daLista.item_count).toBe(1);

    await encerrar(comandaId);
  });

  test("Cenário 2: ao fechar, o item cancelado não é venda mas fica no histórico", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();
    await expectStatus(await cancelar(itemA, { motivo: "cliente_desistiu" }), 200);

    const res = await fechar(comandaId, { gorjeta: 5 });
    await expectStatus(res, 200);
    const data = (await res.json()) as any;
    expect(parseFloat(data.subtotal)).toBe(20);
    expect(parseFloat(data.total_final)).toBe(25);
    expect(data.itens.length).toBe(1); // o recibo não lista o cancelado

    const historicoRes = await authenticatedApi("/api/historico", garcom.token);
    await expectStatus(historicoRes, 200);
    const entrada = ((await historicoRes.json()) as any[]).find((h: any) => h.id === comandaId);
    expect(entrada).toBeDefined();
    expect(parseFloat(entrada.total)).toBe(25);
    // O histórico guarda os dois pedidos; um deles cancelado
    expect(entrada.pedidos.length).toBe(2);
    expect(entrada.pedidos.filter((p: any) => p.status === "cancelado").length).toBe(1);
  });

  // =========================================================================
  // Motivo
  // =========================================================================
  test("Cenário 3: motivo é obrigatório, deve ser da lista, e 'outro' exige detalhe", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();

    await expectStatus(await cancelar(itemA, {}), 400);
    await expectStatus(await cancelar(itemA, { motivo: "porque_sim" }), 400);
    await expectStatus(await cancelar(itemA, { motivo: "outro" }), 400);
    await expectStatus(await cancelar(itemA, { motivo: "outro", detalhe: "   " }), 400);

    // Nada foi cancelado até aqui: com detalhe, cancela
    await expectStatus(await cancelar(itemA, { motivo: "outro", detalhe: "Cliente alérgico ao ingrediente" }), 200);

    await encerrar(comandaId);
  });

  // =========================================================================
  // Permissões
  // =========================================================================
  test("Cenário 4: cozinheiro não cancela item (403)", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();

    await expectStatus(await cancelar(itemA, { motivo: "demora" }, cozinheiro.token), 403);

    // O item continua valendo: o fechamento cobra os dois
    const res = await fechar(comandaId);
    await expectStatus(res, 200);
    expect(parseFloat(((await res.json()) as any).subtotal)).toBe(50);
  });

  test("Cenário 5: item em preparo: garçom não cancela (403), gerente cancela e fica marcado como perda", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();
    await expectStatus(await mudarStatus(itemA, "em_preparo", cozinheiro.token), 200);

    const recusado = await cancelar(itemA, { motivo: "cliente_desistiu" }, garcom.token);
    await expectStatus(recusado, 403);
    expect(typeof ((await recusado.json()) as any).error).toBe("string");

    const res = await cancelar(itemA, { motivo: "cliente_desistiu" }, gerente.token);
    await expectStatus(res, 200);
    const data = (await res.json()) as any;
    expect(data.cancelado_apos_inicio).toBe(true);
    expect(data.total_comanda).toBe(20);

    await encerrar(comandaId);
  });

  test("Cenário 6: item pronto também só é cancelado por gerente ou administrador", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();
    await expectStatus(await mudarStatus(itemA, "pronto", cozinheiro.token), 200);

    await expectStatus(await cancelar(itemA, { motivo: "qualidade" }, garcom.token), 403);
    const res = await cancelar(itemA, { motivo: "qualidade" }, adminToken);
    await expectStatus(res, 200);
    expect(((await res.json()) as any).cancelado_apos_inicio).toBe(true);

    await encerrar(comandaId);
  });

  test("Cenário 7: item entregue não pode ser cancelado (409), nem por gerente", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();
    await expectStatus(await mudarStatus(itemA, "entregue", cozinheiro.token), 200);

    await expectStatus(await cancelar(itemA, { motivo: "qualidade" }, gerente.token), 409);

    await encerrar(comandaId);
  });

  test("Cenário 8: item já cancelado não cancela de novo (409)", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();
    await expectStatus(await cancelar(itemA, { motivo: "demora" }), 200);
    await expectStatus(await cancelar(itemA, { motivo: "demora" }), 409);

    await encerrar(comandaId);
  });

  // =========================================================================
  // Restaurante e estado da comanda
  // =========================================================================
  test("Cenário 9: administrador de outro restaurante não cancela item alheio (404)", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();
    const tokenOutro = await criarRestauranteDeTeste("Teste Cancelamento Outro");

    await expectStatus(await cancelar(itemA, { motivo: "demora" }, tokenOutro), 404);

    // O item continua valendo
    const res = await fechar(comandaId);
    await expectStatus(res, 200);
    expect(parseFloat(((await res.json()) as any).subtotal)).toBe(50);
  });

  test("Cenário 10: não cancela item de comanda que não está aberta (409)", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();
    const cancelarComanda = await authenticatedApi(`/api/comandas/${comandaId}/cancelar`, garcom.token, { method: "PUT" });
    await expectStatus(cancelarComanda, 200);

    await expectStatus(await cancelar(itemA, { motivo: "demora" }), 409);
  });

  // =========================================================================
  // Rotas antigas de status
  // =========================================================================
  test("Cenário 11: as rotas de status não cancelam mais e não mexem em item cancelado", async () => {
    const { comandaId, itemA, itemB } = await abrirComandaComDoisItens();

    // PUT /api/pedidos/:id/status com "cancelado" é recusado, apontando a rota certa
    const viaStatus = await mudarStatus(itemA, "cancelado", garcom.token);
    await expectStatus(viaStatus, 400);
    expect(((await viaStatus.json()) as any).error).toContain("/cancelar");

    // PUT /api/pedidos/:id com status "cancelado" também
    const viaEdicao = await authenticatedApi(`/api/pedidos/${itemA}`, garcom.token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: "cancelado" }),
    });
    await expectStatus(viaEdicao, 400);

    // Depois de cancelar de verdade, o item não muda mais de status nem é editado
    await expectStatus(await cancelar(itemB, { motivo: "demora" }), 200);
    await expectStatus(await mudarStatus(itemB, "em_preparo", cozinheiro.token), 409);
    const editar = await authenticatedApi(`/api/pedidos/${itemB}`, garcom.token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ quantidade: 5 }),
    });
    await expectStatus(editar, 409);

    await encerrar(comandaId);
  });

  // =========================================================================
  // Pagamento e divisão de conta
  // =========================================================================
  test("Cenário 12: o pagamento e a divisão de conta usam o total sem o item cancelado", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();
    await expectStatus(await cancelar(itemA, { motivo: "cliente_desistiu" }), 200); // sobra R$ 20

    // Divisão em partes iguais parte de R$ 20
    const divisaoRes = await authenticatedApi(`/api/comandas/${comandaId}/divisao`, garcom.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ tipo: "igual", num_pessoas: 2 }),
    });
    await expectStatus(divisaoRes, 200);
    expect((await divisaoRes.json() as any).total_comanda).toBe(20);

    // Pagar mais que R$ 20 é recusado
    const excedeRes = await authenticatedApi(`/api/comandas/${comandaId}/pagamentos`, garcom.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ forma_pagamento: "dinheiro", valor: 30 }),
    });
    await expectStatus(excedeRes, 400);

    // Pagar R$ 20 fecha a conta
    const pagaRes = await authenticatedApi(`/api/comandas/${comandaId}/pagamentos`, garcom.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ forma_pagamento: "dinheiro", valor: 20 }),
    });
    await expectStatus(pagaRes, 201);
    await encerrar(comandaId);
  });

  // =========================================================================
  // Concorrência entre cancelar e fechar
  // =========================================================================
  test("Cenário 13: cancelar e fechar ao mesmo tempo não dá erro 500 e o total fica coerente", async () => {
    const { comandaId, itemA } = await abrirComandaComDoisItens();

    const [resCancelar, resFechar] = await Promise.all([cancelar(itemA, { motivo: "demora" }), fechar(comandaId)]);

    expect(resCancelar.status).not.toBe(500);
    expect(resFechar.status).toBe(200);
    const fechamento = (await resFechar.json()) as any;

    // Se o cancelamento deu certo antes do fechamento, o total exclui o item; senão, cobra os dois.
    const cancelouAntes = resCancelar.status === 200;
    expect([200, 404]).toContain(resCancelar.status);
    expect(parseFloat(fechamento.subtotal)).toBe(cancelouAntes ? 20 : 50);
  });
});
