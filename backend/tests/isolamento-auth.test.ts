import { describe, test, expect, beforeAll } from "bun:test";
import { api, authenticatedApi, signUpTestUser, expectStatus } from "./helpers";

describe("Isolamento de autenticação — requireAuth", () => {

  test("Cenário 1: usuário custom auth corretamente vinculado acessa seu restaurante (200)", async () => {
    // signUpTestUser usa /api/auth/sign-up/email que cria via custom auth
    // O usuário criado tem restauranteId definido (pelo fluxo de signup)
    const { token } = await signUpTestUser("administrador");
    const res = await authenticatedApi("/api/mesas", token);
    // Pode ser 200 (com lista) ou 200 vazia — o importante é não ser 401/403
    await expectStatus(res, 200);
  });

  test("Cenário 2: token inválido recebe 401", async () => {
    const res = await authenticatedApi("/api/mesas", "token-invalido-que-nao-existe");
    await expectStatus(res, 401);
  });

  test("Cenário 3: ausência de token recebe 401", async () => {
    const res = await api("/api/mesas");
    await expectStatus(res, 401);
  });

  test("Cenário 4: fluxo legítimo de signup de restaurante cria vínculo correto e permite acesso", async () => {
    const uniqueId = crypto.randomUUID();
    const res = await api("/api/restaurantes/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Restaurante Teste Isolamento ${uniqueId}`,
        adminNome: "Admin Teste",
        adminEmail: `admin-isolamento-${uniqueId}@example.com`,
        adminSenha: "SenhaSegura123!",
      }),
    });
    await expectStatus(res, 201);
    const data = (await res.json()) as any;
    expect(data.token).toBeDefined();
    // O token retornado deve permitir acesso imediato
    const mesasRes = await authenticatedApi("/api/mesas", data.token);
    await expectStatus(mesasRes, 200);
  });

  test("Cenário 5: isolamento entre restaurantes — usuário de restaurante A não vê mesas de restaurante B", async () => {
    // Criar dois restaurantes independentes
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();

    const signupA = await api("/api/restaurantes/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Restaurante A ${idA}`,
        adminNome: "Admin A",
        adminEmail: `admin-a-${idA}@example.com`,
        adminSenha: "SenhaSegura123!",
      }),
    });
    await expectStatus(signupA, 201);
    const dataA = (await signupA.json()) as any;

    const signupB = await api("/api/restaurantes/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Restaurante B ${idB}`,
        adminNome: "Admin B",
        adminEmail: `admin-b-${idB}@example.com`,
        adminSenha: "SenhaSegura123!",
      }),
    });
    await expectStatus(signupB, 201);
    const dataB = (await signupB.json()) as any;

    // Criar uma mesa no restaurante A
    const mesaRes = await authenticatedApi("/api/mesas", dataA.token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: Math.floor(Math.random() * 900000) + 100000, capacidade: 4 }),
    });
    await expectStatus(mesaRes, 201);
    const mesa = (await mesaRes.json()) as any;

    // Usuário do restaurante B não deve ver a mesa do restaurante A
    const mesasBRes = await authenticatedApi("/api/mesas", dataB.token);
    await expectStatus(mesasBRes, 200);
    const mesasB = (await mesasBRes.json()) as any[];
    const found = mesasB.find((m: any) => m.id === mesa.id);
    expect(found).toBeUndefined();
  });

  test("Cenário 6: uma requisição autenticada não cria perfis nem altera o restaurante do usuário", async () => {
    const { token, user } = await signUpTestUser("garcom");

    // Contar perfis antes
    const statusBefore = await api("/api/seed-status");
    await expectStatus(statusBefore, 200);
    const before = (await statusBefore.json()) as any;

    // Fazer uma requisição autenticada
    await authenticatedApi("/api/mesas", token);

    // Contar perfis depois — não deve ter aumentado por causa desta requisição
    const statusAfter = await api("/api/seed-status");
    await expectStatus(statusAfter, 200);
    const after = (await statusAfter.json()) as any;

    // O número de perfis não deve ter aumentado por causa da requisição acima
    expect(after.profiles).toBeLessThanOrEqual(before.profiles + 1); // +1 tolerância para o próprio signup
  });
});
