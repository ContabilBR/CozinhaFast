import { beforeAll, describe, expect, test } from "bun:test";
import { authenticatedApi, api, expectStatus } from "./helpers";

// Opt in only against an isolated backend/database. Creates two disposable restaurants.
// RUN_TENANT_SECURITY_TESTS=true TEST_BASE_URL=http://localhost:3001 bun test tests/tenant-routes-isolation.test.ts
const suite = process.env.RUN_TENANT_SECURITY_TESTS === "true" ? describe : describe.skip;

interface Fixture {
  token: string;
  mesa: string;
  prato: string;
  comanda: string;
  pedido: string;
  garcom: string;
  garcomEmail: string;
  insumo: string;
  vinculo: string;
}
async function call(token: string, method: string, path: string, body?: unknown) {
  return authenticatedApi(path, token, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}
async function createFixture(label: string): Promise<Fixture> {
  const unique = crypto.randomUUID();
  const signup = await api("/api/restaurantes/signup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: "Isolamento " + label + " " + unique, adminNome: "Admin " + label,
      adminEmail: "isolation-admin-" + unique + "@example.com", adminSenha: "TestOnly-Password123!" }),
  });
  await expectStatus(signup, 201);
  const { token } = await signup.json() as any;
  const create = async (path: string, body: unknown) => {
    const response = await call(token, "POST", path, body);
    await expectStatus(response, 201);
    return response.json() as Promise<any>;
  };
  const mesa = await create("/api/mesas", { numero: 1, capacidade: 4 });
  const pratoResponse = await create("/api/pratos", { nome: "Isolamento " + unique, preco: "10.00", disponivel: true });
  const prato = pratoResponse.prato ?? pratoResponse;
  const comandaResponse = await create("/api/comandas", { mesa_id: mesa.id,
    itens: [{ prato_id: prato.id, quantidade: 1, preco_unitario: 10 }] });
  const comanda = comandaResponse.comanda ?? comandaResponse;
  const detailResponse = await call(token, "GET", "/api/comandas/" + comanda.id);
  await expectStatus(detailResponse, 200);
  const detail = await detailResponse.json() as any;
  expect(detail.pedidos.length).toBe(1);
  const garcomEmail = "isolation-waiter-" + unique + "@example.com";
  const garcom = await create("/api/garcons", { name: "Garçom " + label, email: garcomEmail, password: "TestOnly-Password123!" });
  const insumo = await create("/api/insumos", { nome: "Insumo " + unique, unidade: "kg" });
  const vinculo = await create("/api/pratos/" + prato.id + "/insumos", { insumo_id: insumo.id, quantidade: "1" });
  return { token, mesa: mesa.id, prato: prato.id, comanda: comanda.id, pedido: detail.pedidos[0].id,
    garcom: garcom.id, garcomEmail, insumo: insumo.id, vinculo: vinculo.id };
}
suite("Rotas: isolamento entre restaurantes", () => {
  let a: Fixture, b: Fixture;
  beforeAll(async () => { a = await createFixture("A"); b = await createFixture("B"); });

  for (const direction of ["A para B", "B para A"]) {
    test(direction + ": IDs estrangeiros recebem 404 e a comanda permanece intacta", async () => {
      const [actor, target] = direction === "A para B" ? [a, b] : [b, a];
      const ownBefore = await call(target.token, "GET", "/api/comandas/" + target.comanda);
      await expectStatus(ownBefore, 200);
      const snapshot = await ownBefore.json();
      const attempts: Array<[string, string, unknown?]> = [
        ["PUT", "/api/comandas/" + target.comanda + "/cancelar"],
        ["DELETE", "/api/comandas/" + target.comanda],
        ["PATCH", "/api/pedidos/" + target.pedido + "/observacao", { observacao: "Não deve persistir" }],
        ["GET", "/api/mesas/" + target.mesa + "/comanda"],
        ["GET", "/api/mesas/" + target.mesa + "/historico"],
        ["GET", "/api/pedidos/" + target.pedido],
        ["PUT", "/api/garcons/" + target.garcom, { password: "MustNotChange-123!" }],
        ["DELETE", "/api/garcons/" + target.garcom],
      ];
      for (const [method, path, body] of attempts) await expectStatus(await call(actor.token, method, path, body), 404);
      const ownAfter = await call(target.token, "GET", "/api/comandas/" + target.comanda);
      await expectStatus(ownAfter, 200);
      expect(await ownAfter.json()).toEqual(snapshot);
      await expectStatus(await call(target.token, "GET", "/api/pedidos/" + target.pedido), 200);

      const oldPasswordLogin = await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target.garcomEmail, senha: "TestOnly-Password123!" }) });
      await expectStatus(oldPasswordLogin, 200);
      const changedPasswordLogin = await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target.garcomEmail, senha: "MustNotChange-123!" }) });
      await expectStatus(changedPasswordLogin, 401);
    });

    test(direction + ": criação rejeita vínculos cruzados", async () => {
      const [actor, target] = direction === "A para B" ? [a, b] : [b, a];
      const attempts: Array<[string, unknown]> = [
        ["/api/comandas", { mesa_id: target.mesa, itens: [] }],
        ["/api/comandas", { mesa_id: actor.mesa, itens: [{ prato_id: target.prato, quantidade: 1, preco_unitario: 10 }] }],
        ["/api/pedidos", { comanda_id: target.comanda, prato_id: actor.prato, quantidade: 1 }],
        ["/api/pedidos", { comanda_id: actor.comanda, prato_id: target.prato, quantidade: 1 }],
        ["/api/comandas/" + actor.comanda + "/pedidos", { items: [{ prato_id: target.prato, quantidade: 1, preco_unitario: 10 }] }],
        ["/api/pratos/" + actor.prato + "/insumos", { insumo_id: target.insumo, quantidade: "1" }],
        ["/api/pratos/" + target.prato + "/insumos", { insumo_id: actor.insumo, quantidade: "1" }],
      ];
      const beforeResponse = await call(actor.token, "GET", "/api/comandas/" + actor.comanda);
      await expectStatus(beforeResponse, 200);
      const before = await beforeResponse.json();
      for (const [path, body] of attempts) await expectStatus(await call(actor.token, "POST", path, body), 404);
      const afterResponse = await call(actor.token, "GET", "/api/comandas/" + actor.comanda);
      await expectStatus(afterResponse, 200);
      expect(await afterResponse.json()).toEqual(before);
    });

    test(direction + ": listagens e consulta de e-mail ficam no restaurante da sessão", async () => {
      const [actor, target] = direction === "A para B" ? [a, b] : [b, a];
      for (const path of ["/api/garcons", "/api/usuarios/garcons"]) {
        const response = await call(actor.token, "GET", path);
        await expectStatus(response, 200);
        const users = await response.json() as any[];
        expect(users.some(u => u.email === actor.garcomEmail)).toBe(true);
        expect(users.some(u => u.email === target.garcomEmail)).toBe(false);
      }
      const response = await call(actor.token, "GET", "/api/garcons/check-email?email=" + encodeURIComponent(target.garcomEmail));
      await expectStatus(response, 200);
      expect(await response.json()).toEqual({ exists: false, nome: null });
    });
  }

  test("vínculo de estoque é acessível somente pelo prato correto", async () => {
    await expectStatus(await call(a.token, "DELETE", "/api/pratos/" + b.prato + "/insumos/" + a.vinculo), 404);
    const response = await call(a.token, "GET", "/api/pratos/" + a.prato + "/insumos");
    await expectStatus(response, 200);
    expect((await response.json() as any[]).some(v => v.id === a.vinculo)).toBe(true);
  });

  test("edição legítima mantém o vínculo após trocar e-mail e senha", async () => {
    const updatedEmail = "updated-" + crypto.randomUUID() + "@example.com";
    await expectStatus(await call(a.token, "PUT", "/api/garcons/" + a.garcom,
      { name: "Nome atualizado", email: updatedEmail, password: "Updated-Password123!" }), 200);
    const response = await call(a.token, "GET", "/api/usuarios/garcons");
    await expectStatus(response, 200);
    expect((await response.json() as any[]).find(u => u.email === updatedEmail)?.nome).toBe("Nome atualizado");
    const login = await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: updatedEmail, senha: "Updated-Password123!" }) });
    await expectStatus(login, 200);
    await expectStatus(await call(a.token, "PUT", "/api/garcons/" + a.garcom, { name: "Após troca de e-mail" }), 200);
    const after = await call(a.token, "GET", "/api/usuarios/garcons");
    await expectStatus(after, 200);
    expect((await after.json() as any[]).find(u => u.email === updatedEmail)?.nome).toBe("Após troca de e-mail");
  });
});
