import { describe, test, expect, beforeAll } from "bun:test";
import { api, authenticatedApi, expectStatus } from "./helpers";

// ---------------------------------------------------------------------------
// Testes de regras de status e permissões do delivery
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
      adminNome: "Admin Delivery",
      adminEmail: `admin-delivery-${sufixo}-${Math.floor(Math.random() * 100000)}@test.com`,
      adminSenha: SENHA,
    }),
  });
  await expectStatus(res, 201);
  const token = ((await res.json()) as any).token;
  expect(token).toBeDefined();
  return token;
}

async function criarUsuario(adminToken: string, role: "garcom" | "gerente" | "cozinheiro"): Promise<UsuarioTeste> {
  const email = `${role}-${Date.now()}-${Math.floor(Math.random() * 100000)}@delivery.test`;
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

describe("Delivery: regras de status e permissões", () => {
  let adminToken: string;
  let garcom: UsuarioTeste;
  let gerente: UsuarioTeste;
  let cozinheiro: UsuarioTeste;
  let pratoId: string;

  async function criarDelivery(token: string, pId: string): Promise<{ comandaId: string; entregaId: string; itemId: string }> {
    const res = await authenticatedApi("/api/delivery/pedidos", token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        cliente_nome: "Cliente Teste",
        cliente_telefone: "11999999999",
        endereco: "Rua Teste, 123",
        itens: [{ prato_id: pId, quantidade: 1 }],
      }),
    });
    await expectStatus(res, 201);
    const data = (await res.json()) as any;
    // Buscar o item criado
    const itensRes = await authenticatedApi(`/api/pedidos?comanda_id=${data.comanda.id}`, token);
    await expectStatus(itensRes, 200);
    const itensData = (await itensRes.json()) as any;
    const itemId = itensData.pedidos[0]?.id;
    return { comandaId: data.comanda.id, entregaId: data.entrega.id, itemId };
  }

  async function mudarStatusEntrega(
    entregaId: string,
    status: string,
    token: string,
    extra: Record<string, string> = {}
  ): Promise<Response> {
    return authenticatedApi(`/api/delivery/pedidos/${entregaId}/status`, token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status, ...extra }),
    });
  }

  async function mudarStatusItem(itemId: string, status: string, token: string): Promise<Response> {
    return authenticatedApi(`/api/pedidos/${itemId}/status`, token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status }),
    });
  }

  beforeAll(async () => {
    adminToken = await criarRestauranteDeTeste("Teste Delivery Status");
    const sufixo = Date.now();

    const pratoRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        nome: `Prato Delivery ${sufixo}`,
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

  test("1. cozinheiro não pode criar delivery", async () => {
    const res = await authenticatedApi("/api/delivery/pedidos", cozinheiro.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        cliente_nome: "Cliente",
        cliente_telefone: "11999999999",
        endereco: "Rua X",
        itens: [{ prato_id: pratoId, quantidade: 1 }],
      }),
    });
    await expectStatus(res, 403);
  });

  test("2. cozinheiro não pode mudar status da entrega", async () => {
    const { entregaId } = await criarDelivery(garcom.token, pratoId);
    const res = await mudarStatusEntrega(entregaId, "cancelada", cozinheiro.token);
    await expectStatus(res, 403);
  });

  test("3. salto de status recusado: pendente → entregue", async () => {
    const { entregaId } = await criarDelivery(garcom.token, pratoId);
    const res = await mudarStatusEntrega(entregaId, "entregue", garcom.token);
    await expectStatus(res, 409);
  });

  test("4. salto de status recusado: pendente → saiu_entrega (sem entregador)", async () => {
    const { entregaId } = await criarDelivery(garcom.token, pratoId);
    const res = await mudarStatusEntrega(entregaId, "saiu_entrega", garcom.token, { entregador_nome: "João" });
    // pendente → saiu_entrega pula preparando → 409
    await expectStatus(res, 409);
  });

  test("5. despacho recusado sem entregador_nome", async () => {
    const { entregaId, itemId } = await criarDelivery(garcom.token, pratoId);
    // Avançar para preparando via item em_preparo
    await mudarStatusItem(itemId, "em_preparo", cozinheiro.token);
    // Marcar como pronto
    await mudarStatusItem(itemId, "pronto", cozinheiro.token);
    // Tentar despachar sem entregador_nome
    const res = await mudarStatusEntrega(entregaId, "saiu_entrega", garcom.token);
    await expectStatus(res, 400);
    const data = (await res.json()) as any;
    expect(data.error).toContain("entregador");
  });

  test("6. despacho recusado com item cru (não pronto)", async () => {
    const { entregaId, itemId } = await criarDelivery(garcom.token, pratoId);
    // Avançar entrega para preparando via item
    await mudarStatusItem(itemId, "em_preparo", cozinheiro.token);
    // Tentar despachar sem marcar como pronto
    const res = await mudarStatusEntrega(entregaId, "saiu_entrega", garcom.token, { entregador_nome: "João" });
    await expectStatus(res, 409);
    const data = (await res.json()) as any;
    expect(data.error).toMatch(/itens|preparo/i);
  });

  test("7. despacho aceito com tudo pronto", async () => {
    const { entregaId, itemId } = await criarDelivery(garcom.token, pratoId);
    await mudarStatusItem(itemId, "em_preparo", cozinheiro.token);
    await mudarStatusItem(itemId, "pronto", cozinheiro.token);
    const res = await mudarStatusEntrega(entregaId, "saiu_entrega", garcom.token, { entregador_nome: "Maria" });
    await expectStatus(res, 200);
    const data = (await res.json()) as any;
    expect(data.entrega.status).toBe("saiu_entrega");
    expect(data.entrega.entregadorNome).toBe("Maria");
  });

  test("8. item cancelado não impede despacho", async () => {
    // Criar delivery com 2 itens
    const res = await authenticatedApi("/api/delivery/pedidos", garcom.token, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        cliente_nome: "Cliente 2 Itens",
        cliente_telefone: "11988888888",
        endereco: "Rua Y, 456",
        itens: [
          { prato_id: pratoId, quantidade: 1 },
          { prato_id: pratoId, quantidade: 1 },
        ],
      }),
    });
    await expectStatus(res, 201);
    const data = (await res.json()) as any;
    const entregaId = data.entrega.id;
    const comandaId = data.comanda.id;

    const itensRes = await authenticatedApi(`/api/pedidos?comanda_id=${comandaId}`, garcom.token);
    await expectStatus(itensRes, 200);
    const itens = ((await itensRes.json()) as any).pedidos as any[];
    expect(itens.length).toBe(2);

    const item1 = itens[0].id;
    const item2 = itens[1].id;

    // Cancelar item1
    await authenticatedApi(`/api/pedidos/${item1}/cancelar`, garcom.token, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ motivo: "cliente_desistiu" }),
    });

    // Marcar item2 como pronto
    await mudarStatusItem(item2, "em_preparo", cozinheiro.token);
    await mudarStatusItem(item2, "pronto", cozinheiro.token);

    // Despachar
    const despacho = await mudarStatusEntrega(entregaId, "saiu_entrega", garcom.token, { entregador_nome: "Carlos" });
    await expectStatus(despacho, 200);
  });

  test("9. avanço automático para preparando quando item entra em preparo", async () => {
    const { entregaId, itemId } = await criarDelivery(garcom.token, pratoId);

    // Verificar status inicial da entrega
    const antes = await authenticatedApi(`/api/delivery/pedidos/${entregaId}`, garcom.token);
    await expectStatus(antes, 200);
    expect(((await antes.json()) as any).entrega.status).toBe("pendente");

    // Marcar item como em_preparo
    await mudarStatusItem(itemId, "em_preparo", cozinheiro.token);

    // Verificar que a entrega avançou para preparando
    const depois = await authenticatedApi(`/api/delivery/pedidos/${entregaId}`, garcom.token);
    await expectStatus(depois, 200);
    expect(((await depois.json()) as any).entrega.status).toBe("preparando");
  });

  test("10. cozinha recusada ao mudar item de delivery despachado", async () => {
    const { entregaId, itemId } = await criarDelivery(garcom.token, pratoId);
    await mudarStatusItem(itemId, "em_preparo", cozinheiro.token);
    await mudarStatusItem(itemId, "pronto", cozinheiro.token);
    await mudarStatusEntrega(entregaId, "saiu_entrega", garcom.token, { entregador_nome: "Pedro" });

    // Tentar mudar status do item após despacho
    const res = await mudarStatusItem(itemId, "entregue", cozinheiro.token);
    await expectStatus(res, 409);
    const data = (await res.json()) as any;
    expect(data.error).toMatch(/saiu|entrega/i);
  });

  test("11. entregue só a partir de saiu_entrega — de preparando retorna 409", async () => {
    const { entregaId, itemId } = await criarDelivery(garcom.token, pratoId);
    await mudarStatusItem(itemId, "em_preparo", cozinheiro.token);
    // entrega agora está em "preparando" (avanço automático)
    const res = await mudarStatusEntrega(entregaId, "entregue", garcom.token);
    await expectStatus(res, 409);
  });

  test("12. isolamento: garçom de outro restaurante não acessa entrega", async () => {
    const { entregaId } = await criarDelivery(garcom.token, pratoId);

    // Criar segundo restaurante
    const outroAdminToken = await criarRestauranteDeTeste("Outro Restaurante Delivery");
    const outroGarcomEmail = `garcom-outro-${Date.now()}@delivery.test`;
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

    // Tentar mudar status da entrega do primeiro restaurante
    const res = await mudarStatusEntrega(entregaId, "cancelada", outroGarcomToken);
    await expectStatus(res, 404);
  });
});
