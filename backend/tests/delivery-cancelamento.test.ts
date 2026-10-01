import { describe, test, expect, beforeAll } from "bun:test";
import { api, authenticatedApi, expectStatus } from "./helpers";

// ---------------------------------------------------------------------------
// Testes de cancelamento completo de pedidos de delivery
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
      adminEmail: `admin-cancel-${sufixo}-${Math.floor(Math.random() * 100000)}@test.com`,
      adminSenha: SENHA,
    }),
  });
  await expectStatus(res, 201);
  const token = ((await res.json()) as any).token;
  expect(token).toBeDefined();
  return token;
}

async function criarUsuario(adminToken: string, role: "garcom" | "gerente" | "cozinheiro"): Promise<UsuarioTeste> {
  const email = `${role}-cancel-${Date.now()}-${Math.floor(Math.random() * 100000)}@delivery.test`;
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

describe("Delivery: cancelamento completo", () => {
  let adminToken: string;
  let garcom: UsuarioTeste;
  let gerente: UsuarioTeste;
  let cozinheiro: UsuarioTeste;
  let pratoId: string;

  async function criarDelivery(token: string): Promise<{ comandaId: string; entregaId: string; itemId: string }> {
    const res = await authenticatedApi("/api/delivery/pedidos", token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        cliente_nome: "Cliente Cancelamento",
        cliente_telefone: "11999999999",
        endereco: "Rua Cancelamento, 1",
        itens: [{ prato_id: pratoId, quantidade: 1 }],
      }),
    });
    await expectStatus(res, 201);
    const data = (await res.json()) as any;
    const itensRes = await authenticatedApi(`/api/pedidos?comanda_id=${data.comanda.id}`, token);
    await expectStatus(itensRes, 200);
    const itensData = (await itensRes.json()) as any;
    const itemId = itensData.pedidos[0]?.id;
    return { comandaId: data.comanda.id, entregaId: data.entrega.id, itemId };
  }

  async function criarDelivery2Itens(token: string): Promise<{ comandaId: string; entregaId: string; item1Id: string; item2Id: string }> {
    const res = await authenticatedApi("/api/delivery/pedidos", token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        cliente_nome: "Cliente 2 Itens",
        cliente_telefone: "11988888888",
        endereco: "Rua Dois Itens, 2",
        itens: [
          { prato_id: pratoId, quantidade: 1 },
          { prato_id: pratoId, quantidade: 1 },
        ],
      }),
    });
    await expectStatus(res, 201);
    const data = (await res.json()) as any;
    const itensRes = await authenticatedApi(`/api/pedidos?comanda_id=${data.comanda.id}`, token);
    await expectStatus(itensRes, 200);
    const itensData = (await itensRes.json()) as any;
    const item1Id = itensData.pedidos[0]?.id;
    const item2Id = itensData.pedidos[1]?.id;
    return { comandaId: data.comanda.id, entregaId: data.entrega.id, item1Id, item2Id };
  }

  async function cancelarDelivery(entregaId: string, token: string, motivo: string, detalhe?: string): Promise<Response> {
    return authenticatedApi(`/api/delivery/pedidos/${entregaId}/cancelar`, token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ motivo, ...(detalhe ? { detalhe } : {}) }),
    });
  }

  async function mudarStatusItem(itemId: string, status: string, token: string): Promise<Response> {
    return authenticatedApi(`/api/pedidos/${itemId}/status`, token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status }),
    });
  }

  async function mudarStatusEntrega(entregaId: string, status: string, token: string, extra: Record<string, string> = {}): Promise<Response> {
    return authenticatedApi(`/api/delivery/pedidos/${entregaId}/status`, token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status, ...extra }),
    });
  }

  beforeAll(async () => {
    adminToken = await criarRestauranteDeTeste("Teste Delivery Cancelamento");
    const sufixo = Date.now();

    const pratoRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        nome: `Prato Cancel ${sufixo}`,
        preco: "25.00",
        disponivel: true,
        cfop: "5102",
        origem_mercadoria: 0,
        unidade_comercial: "un",
      }),
    });
    await expectStatus(pratoRes, 201);
    pratoId = ((await pratoRes.json()) as any).prato.id;

    garcom = await criarUsuario(adminToken, "garcom");
    gerente = await criarUsuario(adminToken, "gerente");
    cozinheiro = await criarUsuario(adminToken, "cozinheiro");
  });

  test("1. garçom aceito quando todos os itens estão pendentes", async () => {
    const { entregaId } = await criarDelivery(garcom.token);
    const res = await cancelarDelivery(entregaId, garcom.token, "cliente_desistiu");
    await expectStatus(res, 200);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.houve_perda).toBe(false);
  });

  test("2. garçom recusado quando há item em preparo", async () => {
    const { entregaId, itemId } = await criarDelivery(garcom.token);
    await mudarStatusItem(itemId, "em_preparo", cozinheiro.token);
    const res = await cancelarDelivery(entregaId, garcom.token, "cliente_desistiu");
    await expectStatus(res, 403);
  });

  test("3. gerente aceito com item em preparo — itens iniciados marcados como perda", async () => {
    const { entregaId, itemId, comandaId } = await criarDelivery(gerente.token);
    await mudarStatusItem(itemId, "em_preparo", cozinheiro.token);
    const res = await cancelarDelivery(entregaId, gerente.token, "item_em_falta");
    await expectStatus(res, 200);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.houve_perda).toBe(true);

    // Verificar que o item tem canceladoAposInicio=true
    const itensRes = await authenticatedApi(`/api/pedidos?comanda_id=${comandaId}`, gerente.token);
    await expectStatus(itensRes, 200);
    const itensData = (await itensRes.json()) as any;
    const item = itensData.pedidos.find((i: any) => i.id === itemId);
    expect(item).toBeDefined();
    expect(item.canceladoAposInicio ?? item.cancelado_apos_inicio).toBe(true);
  });

  test("4. gerente aceito após saiu_entrega — todos os itens marcados como perda", async () => {
    const { entregaId, itemId } = await criarDelivery(gerente.token);
    await mudarStatusItem(itemId, "em_preparo", cozinheiro.token);
    await mudarStatusItem(itemId, "pronto", cozinheiro.token);
    await mudarStatusEntrega(entregaId, "saiu_entrega", gerente.token, { entregador_nome: "Entregador" });
    const res = await cancelarDelivery(entregaId, gerente.token, "cliente_nao_atendeu");
    await expectStatus(res, 200);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.houve_perda).toBe(true);
  });

  test("5. cozinheiro recusado", async () => {
    const { entregaId } = await criarDelivery(garcom.token);
    const res = await cancelarDelivery(entregaId, cozinheiro.token, "cliente_desistiu");
    await expectStatus(res, 403);
  });

  test("6. motivo obrigatório", async () => {
    const { entregaId } = await criarDelivery(garcom.token);
    const res = await authenticatedApi(`/api/delivery/pedidos/${entregaId}/cancelar`, garcom.token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    await expectStatus(res, 400);
  });

  test("7. detalhe obrigatório quando motivo='outro'", async () => {
    const { entregaId } = await criarDelivery(garcom.token);
    const res = await cancelarDelivery(entregaId, garcom.token, "outro");
    await expectStatus(res, 400);
    const data = (await res.json()) as any;
    expect(data.error).toMatch(/detalhe/i);
  });

  test("8. entregue recusado", async () => {
    const { entregaId, itemId } = await criarDelivery(garcom.token);
    await mudarStatusItem(itemId, "em_preparo", cozinheiro.token);
    await mudarStatusItem(itemId, "pronto", cozinheiro.token);
    await mudarStatusEntrega(entregaId, "saiu_entrega", garcom.token, { entregador_nome: "Entregador" });
    await mudarStatusEntrega(entregaId, "entregue", garcom.token);
    const res = await cancelarDelivery(entregaId, gerente.token, "outro", "Detalhe qualquer");
    await expectStatus(res, 409);
  });

  test("9. já cancelada recusada", async () => {
    const { entregaId } = await criarDelivery(garcom.token);
    const res1 = await cancelarDelivery(entregaId, garcom.token, "cliente_desistiu");
    await expectStatus(res1, 200);
    const res2 = await cancelarDelivery(entregaId, gerente.token, "cliente_desistiu");
    await expectStatus(res2, 409);
  });

  test("10. comanda com pagamento confirmado recusada", async () => {
    const { entregaId, comandaId } = await criarDelivery(garcom.token);
    // Criar pagamento na comanda
    const pagRes = await authenticatedApi(`/api/comandas/${comandaId}/pagamentos`, garcom.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ valor: "25.00", metodo: "dinheiro" }),
    });
    // Aceitar 200 ou 201
    expect([200, 201]).toContain(pagRes.status);
    const res = await cancelarDelivery(entregaId, gerente.token, "cliente_desistiu");
    await expectStatus(res, 409);
    const data = (await res.json()) as any;
    expect(data.error).toMatch(/pagamento/i);
  });

  test("11. item entregue recusa o pedido inteiro", async () => {
    const { entregaId, itemId } = await criarDelivery(garcom.token);
    await mudarStatusItem(itemId, "em_preparo", cozinheiro.token);
    await mudarStatusItem(itemId, "pronto", cozinheiro.token);
    await mudarStatusEntrega(entregaId, "saiu_entrega", garcom.token, { entregador_nome: "Entregador" });
    // Marcar item como entregue diretamente
    await mudarStatusItem(itemId, "entregue", garcom.token);
    const res = await cancelarDelivery(entregaId, gerente.token, "outro", "Detalhe qualquer");
    await expectStatus(res, 409);
    const data = (await res.json()) as any;
    expect(data.error).toMatch(/entregue/i);
  });

  test("12. itens já cancelados mantêm registro original", async () => {
    const { entregaId, item1Id, item2Id, comandaId } = await criarDelivery2Itens(garcom.token);

    // Cancelar item1 individualmente com motivo "erro_lancamento"
    await authenticatedApi(`/api/pedidos/${item1Id}/cancelar`, garcom.token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ motivo: "erro_lancamento" }),
    });

    // Cancelar o delivery inteiro com motivo "cliente_desistiu"
    const res = await cancelarDelivery(entregaId, garcom.token, "cliente_desistiu");
    await expectStatus(res, 200);

    // Buscar itens e verificar que item1 ainda tem motivoCancelamento="erro_lancamento"
    const itensRes = await authenticatedApi(`/api/pedidos?comanda_id=${comandaId}`, garcom.token);
    await expectStatus(itensRes, 200);
    const itensData = (await itensRes.json()) as any;
    const item1 = itensData.pedidos.find((i: any) => i.id === item1Id);
    expect(item1).toBeDefined();
    const motivo1 = item1.motivoCancelamento ?? item1.motivo_cancelamento;
    expect(motivo1).toBe("erro_lancamento");
  });

  test("13. subtotal e total zerados e comanda cancelada", async () => {
    const { entregaId, comandaId } = await criarDelivery(garcom.token);
    const res = await cancelarDelivery(entregaId, garcom.token, "demora");
    await expectStatus(res, 200);

    // Buscar comanda
    const comandaRes = await authenticatedApi(`/api/comandas/${comandaId}`, garcom.token);
    await expectStatus(comandaRes, 200);
    const comandaData = (await comandaRes.json()) as any;
    const comanda = comandaData.comanda ?? comandaData;
    expect(comanda.status).toBe("cancelada");
    expect(parseFloat(comanda.subtotal)).toBe(0);
    expect(parseFloat(comanda.total)).toBe(0);
  });

  test("14. rota antiga recusa 'cancelada'", async () => {
    const { entregaId } = await criarDelivery(garcom.token);
    const res = await mudarStatusEntrega(entregaId, "cancelada", garcom.token);
    await expectStatus(res, 409);
    const data = (await res.json()) as any;
    expect(data.error).toMatch(/cancelar/i);
  });

  test("15. isolamento: garçom de outro restaurante não cancela", async () => {
    const { entregaId } = await criarDelivery(garcom.token);

    // Criar segundo restaurante e garçom
    const outroAdminToken = await criarRestauranteDeTeste("Outro Restaurante Cancel");
    const outroGarcomEmail = `garcom-outro-cancel-${Date.now()}@delivery.test`;
    const criarRes = await authenticatedApi("/api/usuarios", outroAdminToken, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ nome: "Garcom Outro", email: outroGarcomEmail, senha: SENHA, role: "garcom" }),
    });
    await expectStatus(criarRes, 201);
    const loginRes = await api("/api/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: outroGarcomEmail, senha: SENHA }),
    });
    await expectStatus(loginRes, 200);
    const outroGarcomToken = ((await loginRes.json()) as any).token;

    const res = await cancelarDelivery(entregaId, outroGarcomToken, "cliente_desistiu");
    await expectStatus(res, 404);
  });
});
