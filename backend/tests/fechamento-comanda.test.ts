import { describe, test, expect, beforeAll } from "bun:test";
import { api, authenticatedApi, expectStatus } from "./helpers";

// ---------------------------------------------------------------------------
// Testes do fechamento de comanda: POST /api/comandas/:id/fechar
//
// Cenários 1 a 9: comportamento que a rota já tinha (Etapa A).
// Cenários 10 a 14: correções da Etapa B (outro restaurante, chamadas simultâneas,
// delivery e gorjeta negativa). Itens cancelados ainda entram no total (etapa futura).
//
// ISOLAMENTO DE DADOS
// Estes testes rodam contra o banco real do ambiente e o fechamento grava linhas
// nas tabelas de histórico, que nenhuma limpeza remove. Por isso TUDO aqui roda
// dentro de um restaurante exclusivo de teste, criado em beforeAll pela rota de
// signup de restaurante (a mesma técnica de tenant-isolation.test.ts). Assim mesas,
// comandas e histórico nunca aparecem nos relatórios de um restaurante real.
// - Não usamos signUpTestUser: ele coloca o usuário no primeiro restaurante do banco.
// - Não registramos cleanupTestData: ele varre o restaurante padrão, não o de teste.
// - A rota de signup de restaurante aceita no máximo 10 chamadas por hora por IP;
//   este arquivo usa duas (uma no beforeAll e outra no Cenário 10).
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "Content-Type": "application/json" };
const SENHA = "SenhaForte123!";

interface UsuarioTeste {
  token: string;
  id: string;
  nome: string;
  role: string;
}

// Cria um usuário dentro do restaurante de teste (pelo administrador) e faz login.
async function criarUsuario(adminToken: string, role: "garcom" | "cozinheiro"): Promise<UsuarioTeste> {
  const email = `${role}-${Date.now()}-${Math.floor(Math.random() * 100000)}@fechamento.test`;
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

// Cria um restaurante exclusivo de teste pela rota de signup e devolve o token do administrador.
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
      adminNome: "Admin Fechamento",
      adminEmail: `admin-fechamento-${sufixo}-${Math.floor(Math.random() * 100000)}@test.com`,
      adminSenha: SENHA,
    }),
  });
  await expectStatus(res, 201);
  const token = ((await res.json()) as any).token;
  expect(token).toBeDefined();
  return token;
}

describe("Fechamento de Comanda: POST /api/comandas/:id/fechar", () => {
  let adminToken: string;
  let garcom: UsuarioTeste;
  let mesaId: string;
  let pratoId: string;

  // Abre uma comanda nova na mesa única e lança um pedido. Como o fechamento (e o
  // cancelamento) libera a mesa, o cenário seguinte pode reaproveitá-la.
  async function abrirComanda(preco: number, quantidade: number, token: string = garcom.token): Promise<string> {
    const comandaRes = await authenticatedApi("/api/comandas", token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ mesaId }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = (await comandaRes.json()) as any;
    const comandaId: string = comandaData.comanda.id;

    const pedidoRes = await authenticatedApi(`/api/comandas/${comandaId}/pedidos`, token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ items: [{ prato_id: pratoId, quantidade, preco_unitario: preco }] }),
    });
    await expectStatus(pedidoRes, 201);

    return comandaId;
  }

  function fechar(comandaId: string, body: object = {}, token: string = garcom.token): Promise<Response> {
    return authenticatedApi(`/api/comandas/${comandaId}/fechar`, token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    // Restaurante exclusivo de teste, com seu próprio administrador.
    const sufixo = Date.now();
    adminToken = await criarRestauranteDeTeste("Teste Fechamento");

    // Uma única mesa (número alto, fora da faixa de mesas reais) e um único prato.
    const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ numero: Math.floor(Math.random() * 900000) + 100000, capacidade: 4 }),
    });
    await expectStatus(mesaRes, 201);
    mesaId = ((await mesaRes.json()) as any).id;

    const pratoRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        nome: `Prato Fechamento ${sufixo}`,
        preco: "10.00",
        disponivel: true,
        cfop: "5102",
        origem_mercadoria: 0,
        unidade_comercial: "un",
      }),
    });
    await expectStatus(pratoRes, 201);
    pratoId = ((await pratoRes.json()) as any).prato.id;

    garcom = await criarUsuario(adminToken, "garcom");
  });

  // =========================================================================
  // Cenário 1: fechamento simples, sem pagamentos e sem gorjeta
  // =========================================================================
  test("Cenário 1: fechamento simples sem gorjeta retorna 200 com totais corretos", async () => {
    // Dois pedidos de R$ 30: quantidade 2 e quantidade 1, subtotal = 90
    const comandaId = await abrirComanda(30, 2);
    const pedido2Res = await authenticatedApi(`/api/comandas/${comandaId}/pedidos`, garcom.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ items: [{ prato_id: pratoId, quantidade: 1, preco_unitario: 30 }] }),
    });
    await expectStatus(pedido2Res, 201);

    const res = await fechar(comandaId);
    await expectStatus(res, 200);

    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(parseFloat(data.subtotal)).toBe(90);
    expect(parseFloat(data.total_final)).toBe(90);
    expect(parseFloat(data.gorjeta)).toBe(0);
    expect(data.mesa_numero).toBeDefined();

    expect(Array.isArray(data.itens)).toBe(true);
    expect(data.itens.length).toBeGreaterThan(0);
    const item = data.itens[0];
    expect(item.prato_nome).toBeDefined();
    expect(item.quantidade).toBeDefined();
    expect(item.preco_unitario).toBeDefined();
    expect(item.subtotal_item).toBeDefined();
  });

  // =========================================================================
  // Cenário 2: fechamento com gorjeta
  // =========================================================================
  test("Cenário 2: fechamento com gorjeta soma a gorjeta ao total_final", async () => {
    // Subtotal 50 + gorjeta 10 = 60
    const comandaId = await abrirComanda(50, 1);

    const res = await fechar(comandaId, { gorjeta: 10 });
    await expectStatus(res, 200);

    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(parseFloat(data.subtotal)).toBe(50);
    expect(parseFloat(data.gorjeta)).toBe(10);
    expect(parseFloat(data.total_final)).toBe(60);
  });

  // =========================================================================
  // Cenário 3: estado depois de fechar (mesa liberada, comanda some, histórico)
  // =========================================================================
  test("Cenário 3: após fechar, mesa fica disponível, comanda some e o histórico registra quem fechou", async () => {
    const comandaId = await abrirComanda(20, 1);

    const res = await fechar(comandaId);
    await expectStatus(res, 200);

    // A mesa não tem mais comanda aberta
    const mesaComandaRes = await authenticatedApi(`/api/mesas/${mesaId}/comanda`, garcom.token);
    await expectStatus(mesaComandaRes, 200);
    expect(((await mesaComandaRes.json()) as any).comanda).toBeNull();

    // A mesa voltou a disponível
    const mesaRes = await authenticatedApi(`/api/mesas/${mesaId}`, garcom.token);
    await expectStatus(mesaRes, 200);
    expect(((await mesaRes.json()) as any).status).toBe("disponivel");

    // O histórico contém a comanda fechada, com quem fechou e os pedidos
    const historicoRes = await authenticatedApi("/api/historico", garcom.token);
    await expectStatus(historicoRes, 200);
    const historico = (await historicoRes.json()) as any[];
    const entrada = historico.find((h: any) => h.id === comandaId);
    expect(entrada).toBeDefined();
    expect(entrada.status).toBe("fechada");
    expect(entrada.fechado_por_id).toBe(garcom.id);
    expect(entrada.fechado_por_nome).toBe(garcom.nome);
    expect(entrada.fechado_por_role).toBe("garcom");
    expect(Array.isArray(entrada.pedidos)).toBe(true);
    expect(entrada.pedidos.length).toBe(1);
  });

  // =========================================================================
  // Cenário 4: pagamento confirmado igual ao total
  // =========================================================================
  test("Cenário 4: fechamento com pagamento confirmado igual ao total retorna 200", async () => {
    const comandaId = await abrirComanda(40, 1);

    const pagamentoRes = await authenticatedApi(`/api/comandas/${comandaId}/pagamentos`, garcom.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ forma_pagamento: "dinheiro", valor: 40 }),
    });
    await expectStatus(pagamentoRes, 201);

    const res = await fechar(comandaId);
    await expectStatus(res, 200);

    // Obs.: o schema de resposta 200 do fechar não declara o campo "pagamentos", então
    // ele não chega ao cliente; por isso não o verificamos aqui.
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(parseFloat(data.total_final)).toBe(40);

    // A mesa foi liberada
    const mesaComandaRes = await authenticatedApi(`/api/mesas/${mesaId}/comanda`, garcom.token);
    await expectStatus(mesaComandaRes, 200);
    expect(((await mesaComandaRes.json()) as any).comanda).toBeNull();

    // A comanda foi para o histórico
    const historicoRes = await authenticatedApi("/api/historico", garcom.token);
    await expectStatus(historicoRes, 200);
    const historico = (await historicoRes.json()) as any[];
    expect(historico.find((h: any) => h.id === comandaId)).toBeDefined();
  });

  // =========================================================================
  // Cenário 5: pagamento pendente (não testável pela API)
  // =========================================================================
  // POST /api/comandas/:id/pagamentos sempre cria o pagamento com status
  // "confirmado", e nenhuma rota da API cria um pagamento pendente. Por isso este
  // cenário fica registrado como pulado. O comportamento atual, que só dá para
  // exercitar com acesso direto ao banco, é: 400 com a mensagem que começa com
  // "Existem pagamentos pendentes".
  test.skip("Cenário 5: pagamento pendente bloqueia o fechamento (não testável pela API)", async () => {});

  // =========================================================================
  // Cenário 6: pagamento menor que o total
  // =========================================================================
  test("Cenário 6: pagamento menor que o total retorna 400 com mensagem 'Total pago'", async () => {
    const comandaId = await abrirComanda(100, 1);

    const pagamentoRes = await authenticatedApi(`/api/comandas/${comandaId}/pagamentos`, garcom.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ forma_pagamento: "dinheiro", valor: 50 }),
    });
    await expectStatus(pagamentoRes, 201);

    const res = await fechar(comandaId);
    await expectStatus(res, 400);
    const data = (await res.json()) as any;
    expect(typeof data.error).toBe("string");
    expect(data.error.startsWith("Total pago")).toBe(true);

    // A comanda continua aberta: liberamos a mesa para o próximo cenário.
    const cancelarRes = await authenticatedApi(`/api/comandas/${comandaId}/cancelar`, garcom.token, { method: "PUT" });
    await expectStatus(cancelarRes, 200);
  });

  // =========================================================================
  // Cenário 7: fechar a mesma comanda duas vezes em sequência
  // =========================================================================
  test("Cenário 7: a segunda tentativa de fechar retorna 404 (a comanda é apagada no primeiro fechamento)", async () => {
    const comandaId = await abrirComanda(25, 1);

    const primeira = await fechar(comandaId);
    await expectStatus(primeira, 200);

    const segunda = await fechar(comandaId);
    await expectStatus(segunda, 404);
  });

  // =========================================================================
  // Cenário 8: fechar uma comanda cancelada
  // =========================================================================
  test("Cenário 8: fechar comanda cancelada retorna 409 com 'comanda não está aberta'", async () => {
    const comandaId = await abrirComanda(25, 1);

    const cancelarRes = await authenticatedApi(`/api/comandas/${comandaId}/cancelar`, garcom.token, { method: "PUT" });
    await expectStatus(cancelarRes, 200);

    const res = await fechar(comandaId);
    await expectStatus(res, 409);
    expect(((await res.json()) as any).error).toBe("comanda não está aberta");
  });

  // =========================================================================
  // Cenário 9: cozinheiro não pode fechar
  // =========================================================================
  test("Cenário 9: cozinheiro não pode fechar comanda (403)", async () => {
    const comandaId = await abrirComanda(25, 1);
    const cozinheiro = await criarUsuario(adminToken, "cozinheiro");

    const res = await fechar(comandaId, {}, cozinheiro.token);
    await expectStatus(res, 403);

    // A comanda continua aberta: liberamos a mesa.
    const cancelarRes = await authenticatedApi(`/api/comandas/${comandaId}/cancelar`, garcom.token, { method: "PUT" });
    await expectStatus(cancelarRes, 200);
  });
  // =========================================================================
  // ETAPA B
  // =========================================================================

  // Cancela a comanda para liberar a mesa única para o cenário seguinte.
  async function cancelarComanda(comandaId: string): Promise<void> {
    const res = await authenticatedApi(`/api/comandas/${comandaId}/cancelar`, garcom.token, { method: "PUT" });
    await expectStatus(res, 200);
  }

  // Cenário 10: comanda de outro restaurante
  test("Cenário 10: administrador de outro restaurante não consegue fechar a comanda (404)", async () => {
    const comandaId = await abrirComanda(30, 1);
    const tokenOutroRestaurante = await criarRestauranteDeTeste("Teste Fechamento Outro");

    const res = await fechar(comandaId, {}, tokenOutroRestaurante);
    await expectStatus(res, 404);

    // A comanda continua aberta, no restaurante de origem
    const mesaComandaRes = await authenticatedApi(`/api/mesas/${mesaId}/comanda`, garcom.token);
    await expectStatus(mesaComandaRes, 200);
    const mesaComanda = (await mesaComandaRes.json()) as any;
    expect(mesaComanda.comanda).not.toBeNull();
    expect(mesaComanda.comanda.id).toBe(comandaId);

    // E o histórico do restaurante de origem não ganhou a comanda
    const historicoRes = await authenticatedApi("/api/historico", garcom.token);
    await expectStatus(historicoRes, 200);
    const historico = (await historicoRes.json()) as any[];
    expect(historico.find((h: any) => h.id === comandaId)).toBeUndefined();

    await cancelarComanda(comandaId);
  });

  // Cenário 11: chamadas simultâneas
  test("Cenário 11: duas chamadas simultâneas fecham a comanda uma única vez, sem erro 500", async () => {
    const comandaId = await abrirComanda(30, 1);

    const [a, b] = await Promise.all([fechar(comandaId), fechar(comandaId)]);
    const codigos = [a.status, b.status].sort((x, y) => x - y);

    // Exatamente uma fecha; a outra é recusada (404 se chegou depois do fechamento, 409 se viu a comanda já fechada)
    expect(codigos.filter((c) => c === 200).length).toBe(1);
    expect(codigos.includes(500)).toBe(false);
    const outro = codigos.find((c) => c !== 200) as number;
    expect([404, 409]).toContain(outro);

    // O histórico tem uma única linha dessa comanda
    const historicoRes = await authenticatedApi("/api/historico", garcom.token);
    await expectStatus(historicoRes, 200);
    const historico = (await historicoRes.json()) as any[];
    expect(historico.filter((h: any) => h.id === comandaId).length).toBe(1);
  });

  // Cenário 12: delivery
  test("Cenário 12: comanda de delivery não fecha por esta rota (409) e continua existindo", async () => {
    const deliveryRes = await authenticatedApi("/api/delivery/pedidos", adminToken, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        cliente_nome: "Cliente Teste",
        cliente_telefone: "21999990000",
        endereco: "Rua Teste, 1",
        itens: [{ prato_id: pratoId, quantidade: 1 }],
      }),
    });
    await expectStatus(deliveryRes, 201);

    // O corpo do 201 não traz as propriedades da comanda (o schema da rota não as declara).
    // Pegamos o id pela listagem de delivery, que neste restaurante de teste tem só este pedido.
    const listaRes = await authenticatedApi("/api/delivery/pedidos", adminToken);
    await expectStatus(listaRes, 200);
    const lista = (await listaRes.json()) as any;
    expect(lista.pedidos.length).toBe(1);
    const comandaId: string = lista.pedidos[0].comanda.id;
    expect(comandaId).toBeDefined();

    const res = await fechar(comandaId);
    await expectStatus(res, 409);
    expect(((await res.json()) as any).error).toBe("Comandas de delivery não são fechadas por esta rota.");

    // A comanda continua existindo...
    const comandaRes = await authenticatedApi(`/api/comandas/${comandaId}`, garcom.token);
    await expectStatus(comandaRes, 200);
    expect(((await comandaRes.json()) as any).id).toBe(comandaId);

    // ...e a entrega também (apagar a comanda a apagaria por cascade)
    const listaDepoisRes = await authenticatedApi("/api/delivery/pedidos", adminToken);
    await expectStatus(listaDepoisRes, 200);
    const listaDepois = (await listaDepoisRes.json()) as any;
    expect(listaDepois.pedidos.length).toBe(1);
    expect(listaDepois.pedidos[0].comanda.id).toBe(comandaId);
  });

  // Cenário 13: gorjeta negativa no fechamento
  test("Cenário 13: gorjeta negativa no fechamento retorna 400 e não altera nada", async () => {
    const comandaId = await abrirComanda(30, 1);

    const res = await fechar(comandaId, { gorjeta: -5 });
    await expectStatus(res, 400);

    // A comanda continua aberta
    const mesaComandaRes = await authenticatedApi(`/api/mesas/${mesaId}/comanda`, garcom.token);
    await expectStatus(mesaComandaRes, 200);
    const mesaComanda = (await mesaComandaRes.json()) as any;
    expect(mesaComanda.comanda).not.toBeNull();
    expect(mesaComanda.comanda.id).toBe(comandaId);

    await cancelarComanda(comandaId);
  });

  // Cenário 14: gorjeta negativa no registro de pagamento
  test("Cenário 14: gorjeta negativa no registro de pagamento retorna 400 e o pagamento não é gravado", async () => {
    const comandaId = await abrirComanda(30, 1);

    const pagamentoRes = await authenticatedApi(`/api/comandas/${comandaId}/pagamentos`, garcom.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ forma_pagamento: "dinheiro", valor: 10, gorjeta: -5 }),
    });
    await expectStatus(pagamentoRes, 400);

    // Se o pagamento de 10 tivesse sido gravado, o fechamento (total 30) falharia com "Total pago".
    // Fechar com sucesso prova que nada foi gravado, e libera a mesa.
    const res = await fechar(comandaId);
    await expectStatus(res, 200);
  });
});
