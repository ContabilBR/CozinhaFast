import { describe, test, expect } from "bun:test";
import { api } from "./helpers";

describe("Tenant Isolation Tests", () => {
  let restaurantAId: string;
  let restaurantBId: string;
  let tokenA: string;
  let tokenB: string;
  let mesaAId: string;
  let pratoAId: string;
  let comandaAId: string;

  // Create first restaurant with admin user
  test("Create restaurant A with admin user", async () => {
    const signupRes = await api("/api/restaurantes/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Restaurante A ${Date.now()}`,
        cnpj: `12345678${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
        adminNome: "Admin A",
        adminEmail: `admin-a-${Date.now()}@test.com`,
        adminSenha: "SenhaForte123!",
      }),
    });
    expect(signupRes.status).toBe(201);
    const data = await signupRes.json();
    restaurantAId = data.restaurante.id;
    tokenA = data.token;
    expect(restaurantAId).toBeDefined();
    expect(tokenA).toBeDefined();
  });

  // Create second restaurant with admin user
  test("Create restaurant B with admin user", async () => {
    const signupRes = await api("/api/restaurantes/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Restaurante B ${Date.now()}`,
        cnpj: `87654321${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
        adminNome: "Admin B",
        adminEmail: `admin-b-${Date.now()}@test.com`,
        adminSenha: "SenhaForte456!",
      }),
    });
    expect(signupRes.status).toBe(201);
    const data = await signupRes.json();
    restaurantBId = data.restaurante.id;
    tokenB = data.token;
    expect(restaurantBId).toBeDefined();
    expect(tokenB).toBeDefined();
  });

  // Create a mesa in restaurant A
  test("Create mesa in restaurant A", async () => {
    const mesaRes = await api("/api/mesas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        numero: 99,
        capacidade: 4,
        status: "disponivel",
      }),
    });
    expect(mesaRes.status).toBe(201);
    const data = await mesaRes.json();
    mesaAId = data.id;
    expect(mesaAId).toBeDefined();
  });

  // Create a categoria and prato in restaurant A
  test("Create categoria and prato in restaurant A", async () => {
    const catRes = await api("/api/categorias", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        nome: "Pratos Principais",
        descricao: "Pratos principais da casa",
      }),
    });
    expect(catRes.status).toBe(201);
    const catData = await catRes.json();
    const categoriaId = catData.id;

    const pratoRes = await api("/api/pratos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        nome: "Frango Grelhado",
        descricao: "Frango com acompanhamentos",
        preco: "45.90",
        categoria_id: categoriaId,
        disponivel: true,
      }),
    });
    expect(pratoRes.status).toBe(201);
    const pratoData = await pratoRes.json();
    pratoAId = pratoData.prato?.id ?? pratoData.id;
    expect(pratoAId).toBeDefined();
  });

  // Create a comanda in restaurant A
  test("Create comanda in restaurant A", async () => {
    const comandaRes = await api("/api/comandas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        mesa_id: mesaAId,
        itens: [
          {
            prato_id: pratoAId,
            quantidade: 2,
            preco_unitario: 45.90,
          },
        ],
      }),
    });
    expect(comandaRes.status).toBe(201);
    const comandaData = await comandaRes.json();
    comandaAId = comandaData.comanda.id;
    expect(comandaAId).toBeDefined();
  });

  // Test: Restaurant B admin cannot see mesas from A
  test("Restaurant B admin cannot see mesas from restaurant A", async () => {
    const mesasRes = await api("/api/mesas", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(mesasRes.status).toBe(200);
    const data = await mesasRes.json();
    // Should be empty or not contain mesa from A
    expect(!data.some((m: any) => m.id === mesaAId)).toBe(true);
  });

  // Test: Restaurant B admin cannot see pratos from A
  test("Restaurant B admin cannot see pratos from restaurant A", async () => {
    const pratosRes = await api("/api/pratos", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(pratosRes.status).toBe(200);
    const data = await pratosRes.json();
    // Should be empty or not contain prato from A
    expect(!data.some((p: any) => p.id === pratoAId)).toBe(true);
  });

  // Test: Restaurant B admin cannot see comandas from A
  test("Restaurant B admin cannot see comandas from restaurant A", async () => {
    const comandasRes = await api("/api/comandas", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(comandasRes.status).toBe(200);
    const data = await comandasRes.json();
    const comandas = data.comandas || [];
    // Should be empty or not contain comanda from A
    expect(!comandas.some((c: any) => c.id === comandaAId)).toBe(true);
  });

  // Test: Restaurant B admin gets 404 accessing mesa from A by ID
  test("Restaurant B admin gets 404 accessing mesa from restaurant A by ID", async () => {
    const mesaRes = await api(`/api/mesas/${mesaAId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(mesaRes.status).toBe(404);
  });

  // Test: Restaurant B admin gets 404 accessing prato from A by ID
  test("Restaurant B admin gets 404 accessing prato from restaurant A by ID", async () => {
    const pratoRes = await api(`/api/pratos/${pratoAId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(pratoRes.status).toBe(404);
  });

  // Test: Restaurant B admin gets 404 accessing comanda from A by ID
  test("Restaurant B admin gets 404 accessing comanda from restaurant A by ID", async () => {
    const comandaRes = await api(`/api/comandas/${comandaAId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(comandaRes.status).toBe(404);
  });

  // Test: Restaurant B admin can create mesa with same numero as A
  test("Restaurant B admin can create mesa with same numero as restaurant A", async () => {
    const mesaRes = await api("/api/mesas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        numero: 99,
        capacidade: 4,
        status: "disponivel",
      }),
    });
    expect(mesaRes.status).toBe(201);
    const data = await mesaRes.json();
    expect(data.numero).toBe(99);
  });

  // Test: Restaurant B admin gets 404 when trying to update mesa from A
  test("Restaurant B admin gets 404 when trying to update mesa from restaurant A", async () => {
    const updateRes = await api(`/api/mesas/${mesaAId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        numero: 100,
        capacidade: 6,
        status: "ocupada",
      }),
    });
    expect(updateRes.status).toBe(404);
  });

  // Test: Restaurant B admin gets 404 when trying to delete mesa from A
  test("Restaurant B admin gets 404 when trying to delete mesa from restaurant A", async () => {
    const deleteRes = await api(`/api/mesas/${mesaAId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(deleteRes.status).toBe(404);
  });

  // Test: Restaurant A admin can still see their mesa
  test("Restaurant A admin can still see their mesa", async () => {
    const mesaRes = await api(`/api/mesas/${mesaAId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenA}`,
      },
    });
    expect(mesaRes.status).toBe(200);
    const data = await mesaRes.json();
    expect(data.id).toBe(mesaAId);
  });

  // Test: Restaurant A admin can still see their prato
  test("Restaurant A admin can still see their prato", async () => {
    const pratoRes = await api(`/api/pratos/${pratoAId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenA}`,
      },
    });
    expect(pratoRes.status).toBe(200);
    const data = await pratoRes.json();
    const prato = data.prato ?? data;
    expect(prato.id).toBe(pratoAId);
  });

  // Test: Restaurant A admin can still see their comanda
  test("Restaurant A admin can still see their comanda", async () => {
    const comandaRes = await api(`/api/comandas/${comandaAId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenA}`,
      },
    });
    expect(comandaRes.status).toBe(200);
    const data = await comandaRes.json();
    expect(data.id).toBe(comandaAId);
  });

  // Test: Restaurant B admin cannot see historico from restaurant A
  test("Restaurant B admin cannot see historico from restaurant A", async () => {
    const historicoRes = await api("/api/historico", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(historicoRes.status).toBe(200);
    const data = await historicoRes.json();
    expect(Array.isArray(data)).toBe(true);
    // Should not contain any entry with comandaAId
    expect(!data.some((h: any) => h.id === comandaAId)).toBe(true);
  });

  // Test: Restaurant B admin relatorios resumo does not include revenue from restaurant A
  test("Restaurant B admin relatorios resumo does not include revenue from restaurant A", async () => {
    const relatoriosRes = await api("/api/relatorios/resumo", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(relatoriosRes.status).toBe(200);
    const data = await relatoriosRes.json();
    expect(data.total_revenue).toBe(0);
    expect(typeof data.total_mesas).toBe("number");
  });

  // Test: GET /api/cozinha/comandas without token returns 401
  test("GET /api/cozinha/comandas without token returns 401", async () => {
    const cozinhaRes = await api("/api/cozinha/comandas", {
      method: "GET",
    });
    expect(cozinhaRes.status).toBe(401);
  });

  // Test: GET /api/cozinha/comandas with token B does not return comandas from restaurant A
  test("GET /api/cozinha/comandas with token B does not return comandas from restaurant A", async () => {
    const cozinhaRes = await api("/api/cozinha/comandas", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(cozinhaRes.status).toBe(200);
    const data = await cozinhaRes.json();
    const comandas = data.comandas || [];
    // Should not contain comanda from restaurant A
    expect(!comandas.some((c: any) => c.id === comandaAId)).toBe(true);
  });
});
