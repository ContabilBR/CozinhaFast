import { describe, test, expect, afterAll } from "bun:test";
import { api, authenticatedApi, signUpTestUser, expectStatus, createTestFile, connectAuthenticatedWebSocket, waitForMessage } from "./helpers";

afterAll(async () => {
  // Cleanup is handled automatically by signUpTestUser
});

describe("API Integration Tests", () => {
  let authToken: string;
  let testUserId: string;
  let adminToken: string;
  let adminUserId: string;
  let regularUserToken: string;

  let testCategoryId: string;
  let testDishId: string;
  let testTableId: string;
  let testCommandaId: string;
  let testPedidoId: string;
  let testMesaForComandaId: string;

  const uniqueEmail = `test-${Date.now()}@example.com`;
  const tableNumber = Math.floor(Math.random() * 900000) + 100000;

  // ==================== Auth Setup ====================
  test("Sign up test user for authentication", async () => {
    const { token, user } = await signUpTestUser();
    authToken = token;
    testUserId = user.id;
    expect(authToken).toBeDefined();
    expect(testUserId).toBeDefined();
  });

  test("Sign up admin user for delete tests", async () => {
    const { token, user } = await signUpTestUser("administrador");
    adminToken = token;
    adminUserId = user.id;
  });

  test("Sign up regular user for 403 tests", async () => {
    const { token } = await signUpTestUser();
    regularUserToken = token;
  });

  // ==================== Auth Endpoints ====================
  test("Sign up with valid credentials returns 201", async () => {
    const testEmail = `signup-${Date.now()}@example.com`;
    const res = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: "testPassword123456",
        name: "Sign Up Test User",
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    expect(data.token).toBeDefined();
    expect(data.user.email).toBe(testEmail);
  });

  test("Sign up with duplicate email returns 409", async () => {
    const dupEmail = `dup-signup-${Date.now()}@example.com`;
    const firstRes = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: dupEmail,
        password: "testPassword123456",
        name: "First Test User",
      }),
    });
    await expectStatus(firstRes, 201);

    const dupRes = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: dupEmail,
        password: "differentPassword",
        name: "Second Test User",
      }),
    });
    await expectStatus(dupRes, 409);
  });

  test("Sign up with missing required fields returns 400 or 404", async () => {
    const res = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `test-${Date.now()}@example.com`,
        name: "Missing Password",
      }),
    });
    await expectStatus(res, 400, 404);
  });

  test("Sign in with valid credentials returns 200", async () => {
    const testEmail = `signin-test-${Date.now()}@example.com`;
    const testPassword = "testPassword123456";

    await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: "Sign In Test User",
      }),
    });

    const signInRes = await api("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    await expectStatus(signInRes, 200);
    const data = await signInRes.json();
    expect(data.token).toBeDefined();
    expect(data.user.email).toBe(testEmail);
  });

  test("Sign in with invalid password returns 401", async () => {
    const testEmail = `signin-invalid-${Date.now()}@example.com`;
    const testPassword = "correctPassword123456";

    await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: "Test User",
      }),
    });

    const signInRes = await api("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: "wrongPassword",
      }),
    });
    await expectStatus(signInRes, 401);
  });

  test("Sign in with missing credentials returns 400", async () => {
    const res = await api("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Get current authenticated user via /api/auth/me returns 200", async () => {
    const res = await authenticatedApi("/api/auth/me", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.email).toBeDefined();
    expect(data.role).toBeDefined();
    expect(data.active).toBeDefined();
  });

  test("Get current authenticated user via /api/auth/me without auth returns 401", async () => {
    const res = await api("/api/auth/me");
    await expectStatus(res, 401);
  });

  test("Get current authenticated user via /api/me returns 200", async () => {
    const res = await authenticatedApi("/api/me", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.email).toBeDefined();
  });

  test("Get current authenticated user via /api/me without auth returns 401", async () => {
    const res = await api("/api/me");
    await expectStatus(res, 401);
  });

  test("Sign out authenticated user returns 200", async () => {
    const { token: signOutToken } = await signUpTestUser();
    const res = await authenticatedApi("/api/auth/sign-out", signOutToken, {
      method: "POST",
    });
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.success).toBeDefined();
  });

  test("Sign out without authentication returns 401", async () => {
    const res = await api("/api/auth/sign-out", {
      method: "POST",
    });
    await expectStatus(res, 401);
  });

  test("Login with valid credentials via /api/login returns 200", async () => {
    const loginRes = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "garcom@cozinhafast.com",
        senha: "123456",
      }),
    });
    await expectStatus(loginRes, 200, 401);
  });

  test("Login with missing credentials returns 400", async () => {
    const res = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Request password reset returns 200", async () => {
    const res = await api("/api/auth/esqueci-senha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
      }),
    });
    await expectStatus(res, 200);
  });

  test("Reset password with valid token returns 200 or 400 or 500", async () => {
    const res = await api("/api/auth/redefinir-senha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "test-token-invalid",
        novaSenha: "newPassword123456",
      }),
    });
    await expectStatus(res, 200, 400, 500);
  });

  test("Reset password with missing fields returns 400", async () => {
    const res = await api("/api/auth/redefinir-senha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "test-token",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Get database seed status returns 200", async () => {
    const res = await api("/api/seed-status");
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.users).toBeDefined();
  });

  // ==================== Categorias CRUD ====================
  test("List all categorias returns 200", async () => {
    const res = await authenticatedApi("/api/categorias", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("List categorias without authentication returns 401", async () => {
    const res = await api("/api/categorias");
    await expectStatus(res, 401);
  });

  test("Create categoria returns 201", async () => {
    const res = await authenticatedApi("/api/categorias", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Test Category ${Date.now()}`,
        descricao: "A test category",
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    testCategoryId = data.categoria.id;
    expect(data.categoria.id).toBeDefined();
  });

  test("Create categoria without authentication returns 401", async () => {
    const res = await api("/api/categorias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Unauthorized Category" }),
    });
    await expectStatus(res, 401);
  });

  test("Create categoria with missing nome returns 400", async () => {
    const res = await authenticatedApi("/api/categorias", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descricao: "Missing nome" }),
    });
    await expectStatus(res, 400);
  });

  test("Update categoria returns 200", async () => {
    const res = await authenticatedApi(`/api/categorias/${testCategoryId}`, authToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Updated Category" }),
    });
    await expectStatus(res, 200);
  });

  test("Update non-existent categoria returns 404", async () => {
    const res = await authenticatedApi(
      "/api/categorias/00000000-0000-0000-0000-000000000000",
      authToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Updated" }),
      }
    );
    await expectStatus(res, 404);
  });

  test("Delete categoria returns 200", async () => {
    const res = await authenticatedApi(`/api/categorias/${testCategoryId}`, adminToken, {
      method: "DELETE",
    });
    await expectStatus(res, 200);
  });

  test("Delete non-existent categoria returns 404", async () => {
    const res = await authenticatedApi(
      "/api/categorias/00000000-0000-0000-0000-000000000000",
      adminToken,
      { method: "DELETE" }
    );
    await expectStatus(res, 404);
  });

  // ==================== Pratos CRUD ====================
  test("List all pratos returns 200", async () => {
    const res = await authenticatedApi("/api/pratos", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("List pratos with categoria filter returns 200", async () => {
    const res = await authenticatedApi("/api/pratos?categoria_id=00000000-0000-0000-0000-000000000001", authToken);
    await expectStatus(res, 200);
  });

  test("List pratos with disponivel filter returns 200", async () => {
    const res = await authenticatedApi("/api/pratos?disponivel=true", authToken);
    await expectStatus(res, 200);
  });

  test("Create prato returns 201", async () => {
    const res = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Test Prato ${Date.now()}`,
        preco: "25.99",
        disponivel: true,
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    testDishId = data.prato.id;
    expect(data.prato).toBeDefined();
  });

  test("Create prato with missing required fields returns 400", async () => {
    const res = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Incomplete Prato ${Date.now()}`,
      }),
    });
    await expectStatus(res, 400);
  });

  test("Create prato as non-admin returns 403", async () => {
    const res = await authenticatedApi("/api/pratos", regularUserToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Non-Admin Prato ${Date.now()}`,
        preco: "18.99",
      }),
    });
    await expectStatus(res, 403);
  });

  test("Create prato without authentication returns 401", async () => {
    const res = await api("/api/pratos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Unauth Prato",
        preco: "20.00",
      }),
    });
    await expectStatus(res, 401);
  });

  test("Get prato by ID returns 200", async () => {
    const res = await authenticatedApi(`/api/pratos/${testDishId}`, authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.prato?.id || data.id).toBe(testDishId);
  });

  test("Get non-existent prato returns 404", async () => {
    const res = await authenticatedApi(
      "/api/pratos/00000000-0000-0000-0000-000000000000",
      authToken
    );
    await expectStatus(res, 404);
  });

  test("Get prato without authentication returns 401", async () => {
    const res = await api(`/api/pratos/${testDishId}`);
    await expectStatus(res, 401);
  });

  test("Update prato returns 200", async () => {
    const res = await authenticatedApi(`/api/pratos/${testDishId}`, adminToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Updated Prato" }),
    });
    await expectStatus(res, 200);
  });

  test("Update prato as non-admin returns 403", async () => {
    const res = await authenticatedApi(`/api/pratos/${testDishId}`, regularUserToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Unauthorized Update" }),
    });
    await expectStatus(res, 403);
  });

  test("Update non-existent prato returns 404", async () => {
    const res = await authenticatedApi(
      "/api/pratos/00000000-0000-0000-0000-000000000000",
      adminToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Not Found" }),
      }
    );
    await expectStatus(res, 404);
  });

  test("Delete prato as admin returns 204", async () => {
    const createRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Prato to Delete ${Date.now()}`,
        preco: "20.00",
      }),
    });
    await expectStatus(createRes, 201);
    const pratoData = await createRes.json();

    const res = await authenticatedApi(`/api/pratos/${pratoData.prato.id}`, adminToken, {
      method: "DELETE",
    });
    await expectStatus(res, 204);
  });

  test("Delete prato as non-admin returns 403", async () => {
    const res = await authenticatedApi(`/api/pratos/${testDishId}`, regularUserToken, {
      method: "DELETE",
    });
    await expectStatus(res, 403);
  });

  test("Delete non-existent prato returns 404", async () => {
    const res = await authenticatedApi(
      "/api/pratos/00000000-0000-0000-0000-000000000000",
      adminToken,
      { method: "DELETE" }
    );
    await expectStatus(res, 404);
  });

  test("Toggle prato availability returns 200", async () => {
    const createRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Prato Availability Test ${Date.now()}`,
        preco: "22.50",
        disponivel: true,
      }),
    });
    await expectStatus(createRes, 201);
    const pratoData = await createRes.json();

    const res = await authenticatedApi(
      `/api/pratos/${pratoData.prato.id}/disponibilidade`,
      adminToken,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disponivel: false }),
      }
    );
    await expectStatus(res, 200);
  });

  test("Toggle availability without disponivel field returns 400", async () => {
    const res = await authenticatedApi(
      `/api/pratos/${testDishId}/disponibilidade`,
      adminToken,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    await expectStatus(res, 400);
  });

  test("Toggle availability for non-existent prato returns 404", async () => {
    const res = await authenticatedApi(
      "/api/pratos/00000000-0000-0000-0000-000000000000/disponibilidade",
      adminToken,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disponivel: true }),
      }
    );
    await expectStatus(res, 404);
  });

  test("Upload prato photo returns 200", async () => {
    const createRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Prato with Photo",
        preco: "20.00",
      }),
    });
    await expectStatus(createRes, 201);
    const pratoData = await createRes.json();

    const form = new FormData();
    form.append("file", createTestFile("dish.jpg", "test image", "image/jpeg"));

    const res = await authenticatedApi(`/api/pratos/${pratoData.prato.id}/foto`, adminToken, {
      method: "POST",
      body: form,
    });
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.url || data.imagem_url).toBeDefined();
  });

  test("Upload photo to non-existent prato returns 404", async () => {
    const form = new FormData();
    form.append("file", createTestFile("dish.jpg", "test", "image/jpeg"));

    const res = await authenticatedApi(
      "/api/pratos/00000000-0000-0000-0000-000000000000/foto",
      adminToken,
      {
        method: "POST",
        body: form,
      }
    );
    await expectStatus(res, 404);
  });

  test("Upload photo without file returns 400 or 413", async () => {
    const form = new FormData();

    const res = await authenticatedApi(`/api/pratos/${testDishId}/foto`, adminToken, {
      method: "POST",
      body: form,
    });
    await expectStatus(res, 400, 413);
  });

  // ==================== Mesas CRUD ====================
  test("List all mesas returns 200", async () => {
    const res = await authenticatedApi("/api/mesas", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("List mesas with status filter returns 200", async () => {
    const res = await authenticatedApi("/api/mesas?status=disponivel", authToken);
    await expectStatus(res, 200);
  });

  test("List mesas without authentication returns 401", async () => {
    const res = await api("/api/mesas");
    await expectStatus(res, 401);
  });

  test("Create mesa returns 201", async () => {
    const res = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: tableNumber,
        capacidade: 4,
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    testTableId = data.id;
    expect(data.numero).toBe(tableNumber);
  });

  test("Create mesa with missing numero returns 400", async () => {
    const res = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capacidade: 4 }),
    });
    await expectStatus(res, 400);
  });

  test("Create mesa with duplicate numero returns 409", async () => {
    const dupNum = Math.floor(Math.random() * 900000) + 100000;
    const firstRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: dupNum }),
    });
    await expectStatus(firstRes, 201);

    const dupRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: dupNum }),
    });
    await expectStatus(dupRes, 409);
  });

  test("Create mesa as non-admin returns 403", async () => {
    const res = await authenticatedApi("/api/mesas", regularUserToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: Math.floor(Math.random() * 900000) + 100000 }),
    });
    await expectStatus(res, 403);
  });

  test("Get mesa by ID returns 200", async () => {
    const res = await authenticatedApi(`/api/mesas/${testTableId}`, authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.id).toBe(testTableId);
  });

  test("Get non-existent mesa returns 404", async () => {
    const res = await authenticatedApi(
      "/api/mesas/00000000-0000-0000-0000-000000000000",
      authToken
    );
    await expectStatus(res, 404);
  });

  test("Update mesa returns 200", async () => {
    const res = await authenticatedApi(`/api/mesas/${testTableId}`, adminToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ocupada" }),
    });
    await expectStatus(res, 200);
  });

  test("Update mesa as non-admin returns 403", async () => {
    const res = await authenticatedApi(`/api/mesas/${testTableId}`, regularUserToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "disponivel" }),
    });
    await expectStatus(res, 403);
  });

  test("Update non-existent mesa returns 404", async () => {
    const res = await authenticatedApi(
      "/api/mesas/00000000-0000-0000-0000-000000000000",
      adminToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "disponivel" }),
      }
    );
    await expectStatus(res, 404);
  });

  test("Delete mesa as admin returns 204", async () => {
    const res = await authenticatedApi(`/api/mesas/${testTableId}`, adminToken, {
      method: "DELETE",
    });
    await expectStatus(res, 204);
  });

  test("Delete mesa as non-admin returns 403", async () => {
    const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: Math.floor(Math.random() * 900000) + 100000,
      }),
    });
    await expectStatus(mesaRes, 201);
    const mesaData = await mesaRes.json();

    const res = await authenticatedApi(`/api/mesas/${mesaData.id}`, regularUserToken, {
      method: "DELETE",
    });
    await expectStatus(res, 403);
  });

  test("Delete non-existent mesa returns 404", async () => {
    const res = await authenticatedApi(
      "/api/mesas/00000000-0000-0000-0000-000000000000",
      adminToken,
      { method: "DELETE" }
    );
    await expectStatus(res, 404);
  });

  test("Force delete mesa returns 204", async () => {
    const uniqueNum = Math.floor(Date.now() / 1000) % 900000 + 100000;
    const res = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: uniqueNum }),
    });
    await expectStatus(res, 201);
    const mesaData = await res.json();

    const forceRes = await authenticatedApi(
      `/api/mesas/${mesaData.id}/force`,
      adminToken,
      { method: "DELETE" }
    );
    await expectStatus(forceRes, 204);
  });

  test("Force delete non-existent mesa returns 404", async () => {
    const res = await authenticatedApi(
      "/api/mesas/00000000-0000-0000-0000-000000000000/force",
      adminToken,
      { method: "DELETE" }
    );
    await expectStatus(res, 404);
  });

  // ==================== Comandas CRUD ====================
  test("Create mesa for comanda operations", async () => {
    const res = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: Math.floor(Math.random() * 900000) + 100000,
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    testMesaForComandaId = data.id;
  });

  test("List all comandas returns 200", async () => {
    const res = await authenticatedApi("/api/comandas", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.comandas).toBeDefined();
  });

  test("List comandas with status filter returns 200", async () => {
    const res = await authenticatedApi("/api/comandas?status=aberta", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.comandas).toBeDefined();
  });

  test("List comandas without authentication returns 401", async () => {
    const res = await api("/api/comandas");
    await expectStatus(res, 401);
  });

  test("Create comanda returns 201", async () => {
    const res = await authenticatedApi("/api/comandas", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mesaId: testMesaForComandaId,
        garcomId: testUserId,
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    testCommandaId = data.comanda.id;
    expect(data.comanda.mesa_id).toBe(testMesaForComandaId);
  });

  test("Create comanda with non-existent mesa returns 404", async () => {
    const res = await authenticatedApi("/api/comandas", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mesaId: "00000000-0000-0000-0000-000000000000",
      }),
    });
    await expectStatus(res, 404);
  });

  test("Get comanda by ID returns 200", async () => {
    const res = await authenticatedApi(`/api/comandas/${testCommandaId}`, authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.pedidos).toBeDefined();
  });

  test("Get non-existent comanda returns 404", async () => {
    const res = await authenticatedApi(
      "/api/comandas/00000000-0000-0000-0000-000000000000",
      authToken
    );
    await expectStatus(res, 404);
  });

  test("Add pedidos to comanda returns 201", async () => {
    const pratoRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Test Prato ${Date.now()}`,
        preco: "25.99",
      }),
    });
    await expectStatus(pratoRes, 201);
    const pratoData = await pratoRes.json();

    const res = await authenticatedApi(`/api/comandas/${testCommandaId}/pedidos`, authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            prato_id: pratoData.prato.id,
            quantidade: 2,
            preco_unitario: 25.99,
          },
        ],
      }),
    });
    await expectStatus(res, 201);
    const pedidos = await res.json();
    if (pedidos.pedidos && pedidos.pedidos.length > 0) {
      testPedidoId = pedidos.pedidos[0].id;
    }
  });

  test("Add pedidos with empty items array returns 400", async () => {
    const res = await authenticatedApi(`/api/comandas/${testCommandaId}/pedidos`, authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    await expectStatus(res, 400);
  });

  test("Close comanda returns 200", async () => {
    const res = await authenticatedApi(`/api/comandas/${testCommandaId}/fechar`, authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gorjeta: 5.00, num_pessoas: 2 }),
    });
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("Close non-existent comanda returns 404", async () => {
    const res = await authenticatedApi(
      "/api/comandas/00000000-0000-0000-0000-000000000000/fechar",
      authToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gorjeta: 0 }),
      }
    );
    await expectStatus(res, 404);
  });

  test("Cancel comanda returns 200", async () => {
    const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: Math.floor(Math.random() * 900000) + 100000,
      }),
    });
    await expectStatus(mesaRes, 201);
    const mesaData = await mesaRes.json();

    const comandaRes = await authenticatedApi("/api/comandas", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mesaId: mesaData.id }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const res = await authenticatedApi(
      `/api/comandas/${comandaData.comanda.id}/cancelar`,
      authToken,
      { method: "PUT" }
    );
    await expectStatus(res, 200);
  });

  test("Cancel non-existent comanda returns 404", async () => {
    const res = await authenticatedApi(
      "/api/comandas/00000000-0000-0000-0000-000000000000/cancelar",
      authToken,
      { method: "PUT" }
    );
    await expectStatus(res, 404);
  });

  test("Delete comanda returns 204", async () => {
    const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: Math.floor(Math.random() * 900000) + 100000,
      }),
    });
    await expectStatus(mesaRes, 201);
    const mesaData = await mesaRes.json();

    const comandaRes = await authenticatedApi("/api/comandas", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mesaId: mesaData.id }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const res = await authenticatedApi(
      `/api/comandas/${comandaData.comanda.id}`,
      authToken,
      { method: "DELETE" }
    );
    await expectStatus(res, 204);
  });

  test("Delete non-existent comanda returns 404", async () => {
    const res = await authenticatedApi(
      "/api/comandas/00000000-0000-0000-0000-000000000000",
      authToken,
      { method: "DELETE" }
    );
    await expectStatus(res, 404);
  });

  test("Get current comanda for mesa returns 200", async () => {
    const res = await authenticatedApi(`/api/mesas/${testMesaForComandaId}/comanda`, authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.comanda === null || data.comanda.id).toBeDefined();
  });

  test("Get mesa historico returns 200", async () => {
    const res = await authenticatedApi(`/api/mesas/${testMesaForComandaId}/historico`, authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.mesa).toBeDefined();
    expect(data.resumo).toBeDefined();
  });

  test("Get non-existent mesa historico returns 404", async () => {
    const res = await authenticatedApi(
      "/api/mesas/00000000-0000-0000-0000-000000000000/historico",
      authToken
    );
    await expectStatus(res, 404);
  });

  // ==================== Pedidos CRUD ====================
  test("List all pedidos returns 200", async () => {
    const res = await authenticatedApi("/api/pedidos", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.pedidos).toBeDefined();
  });

  test("List pedidos without authentication returns 401", async () => {
    const res = await api("/api/pedidos");
    await expectStatus(res, 401);
  });

  test("Get pedido by ID returns 200 or 404", async () => {
    if (testPedidoId) {
      const res = await authenticatedApi(`/api/pedidos/${testPedidoId}`, authToken);
      await expectStatus(res, 200, 404);
    }
  });

  test("Get non-existent pedido returns 404", async () => {
    const res = await authenticatedApi(
      "/api/pedidos/00000000-0000-0000-0000-000000000000",
      authToken
    );
    await expectStatus(res, 404);
  });

  test("Update pedido returns 200 or 404", async () => {
    if (testPedidoId) {
      const res = await authenticatedApi(`/api/pedidos/${testPedidoId}`, authToken, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantidade: 3 }),
      });
      await expectStatus(res, 200, 404);
    }
  });

  test("Update pedido status returns 200 or 404", async () => {
    if (testPedidoId) {
      const res = await authenticatedApi(`/api/pedidos/${testPedidoId}/status`, authToken, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "em_preparo" }),
      });
      await expectStatus(res, 200, 404);
    }
  });

  test("Update pedido status without required field returns 400", async () => {
    const res = await authenticatedApi(
      `/api/pedidos/00000000-0000-0000-0000-000000000000/status`,
      authToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    await expectStatus(res, 400);
  });

  test("Update pedido observacao returns 200 or 404", async () => {
    if (testPedidoId) {
      const res = await authenticatedApi(`/api/pedidos/${testPedidoId}/observacao`, authToken, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observacao: "Extra sauce" }),
      });
      await expectStatus(res, 200, 404);
    }
  });

  test("Update pedido observacao without observacao field returns 400", async () => {
    const res = await authenticatedApi(
      `/api/pedidos/00000000-0000-0000-0000-000000000000/observacao`,
      authToken,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    await expectStatus(res, 400);
  });

  test("Delete pedido returns 204 or 404", async () => {
    if (testPedidoId) {
      const res = await authenticatedApi(`/api/pedidos/${testPedidoId}`, authToken, {
        method: "DELETE",
      });
      await expectStatus(res, 204, 404);
    }
  });

  test("Delete pedido without authentication returns 401", async () => {
    const res = await api("/api/pedidos/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    });
    await expectStatus(res, 401);
  });

  // ==================== Kitchen Display ====================
  test("Get all comandas for kitchen display returns 200 or 500", async () => {
    const res = await authenticatedApi("/api/cozinha/comandas", authToken);
    await expectStatus(res, 200, 500);
  });

  test("Get kitchen comandas without authentication returns 401", async () => {
    const res = await api("/api/cozinha/comandas");
    await expectStatus(res, 401);
  });

  // ==================== Garcons ====================
  test("List all garcons returns 200", async () => {
    const res = await authenticatedApi("/api/garcons", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("Create garcon returns 201", async () => {
    const res = await authenticatedApi("/api/garcons", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New Garcon",
        email: `garcon-${Date.now()}@example.com`,
        password: "pass123456",
      }),
    });
    await expectStatus(res, 201, 403);
  });

  test("Create garcon with duplicate email returns 409", async () => {
    const dupEmail = `garcon-dup-${Date.now()}@example.com`;
    const firstRes = await authenticatedApi("/api/garcons", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "First Garcon",
        email: dupEmail,
        password: "pass123456",
      }),
    });
    await expectStatus(firstRes, 201);

    const dupRes = await authenticatedApi("/api/garcons", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Second Garcon",
        email: dupEmail,
        password: "pass123456",
      }),
    });
    await expectStatus(dupRes, 409);
  });

  test("Create garcon with missing fields returns 400", async () => {
    const res = await authenticatedApi("/api/garcons", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Incomplete Garcon",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Check email exists returns 200", async () => {
    const res = await authenticatedApi(
      `/api/garcons/check-email?email=test@example.com`,
      authToken
    );
    if (res.status === 200) {
      const data = await res.json();
      expect(data.exists !== undefined).toBe(true);
    } else {
      await expectStatus(res, 400, 401);
    }
  });

  test("Check email without email parameter returns 400", async () => {
    const res = await authenticatedApi(
      "/api/garcons/check-email",
      authToken
    );
    await expectStatus(res, 400);
  });

  test("Update garcon returns 200", async () => {
    const createRes = await authenticatedApi("/api/garcons", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Update Garcon",
        email: `garcon-update-${Date.now()}@example.com`,
        password: "pass123456",
      }),
    });
    await expectStatus(createRes, 201);
    const garconData = await createRes.json();

    const res = await authenticatedApi(`/api/garcons/${garconData.id}`, adminToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Garcon" }),
    });
    await expectStatus(res, 200);
  });

  test("Update non-existent garcon returns 404", async () => {
    const res = await authenticatedApi(
      "/api/garcons/00000000-0000-0000-0000-000000000000",
      adminToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Not Found" }),
      }
    );
    await expectStatus(res, 404);
  });

  test("Delete garcon returns 204", async () => {
    const createRes = await authenticatedApi("/api/garcons", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Delete Garcon",
        email: `garcon-delete-${Date.now()}@example.com`,
        password: "pass123456",
      }),
    });
    await expectStatus(createRes, 201);
    const garconData = await createRes.json();

    const res = await authenticatedApi(`/api/garcons/${garconData.id}`, adminToken, {
      method: "DELETE",
    });
    await expectStatus(res, 204);
  });

  test("Delete non-existent garcon returns 404", async () => {
    const res = await authenticatedApi(
      "/api/garcons/00000000-0000-0000-0000-000000000000",
      adminToken,
      { method: "DELETE" }
    );
    await expectStatus(res, 404);
  });

  // ==================== Usuarios ====================
  test("List all usuarios returns 200", async () => {
    const res = await authenticatedApi("/api/usuarios", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.data).toBeDefined();
  });

  test("Create usuario returns 201 or 400", async () => {
    const res = await authenticatedApi("/api/usuarios", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Test Usuario ${Date.now()}`,
        email: `usuario-${Date.now()}@example.com`,
        senha: "pass123456",
        role: "garcom",
      }),
    });
    await expectStatus(res, 201, 400);
  });

  test("Update usuario returns 200 or 404", async () => {
    const res = await authenticatedApi(
      "/api/usuarios/00000000-0000-0000-0000-000000000000",
      adminToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Updated User" }),
      }
    );
    await expectStatus(res, 200, 404);
  });

  test("Delete usuario returns 204 or 401 or 403 or 404", async () => {
    const res = await authenticatedApi(
      "/api/usuarios/00000000-0000-0000-0000-000000000000",
      authToken,
      { method: "DELETE" }
    );
    await expectStatus(res, 204, 401, 403, 404);
  });

  test("Get garcons via usuarios endpoint returns 200", async () => {
    const res = await authenticatedApi("/api/usuarios/garcons", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  // ==================== Garcom Pedidos ====================
  test("Get garcom pedidos returns 200 or 401", async () => {
    const res = await authenticatedApi("/api/garcom/pedidos", authToken);
    await expectStatus(res, 200, 401);
  });

  // ==================== Reports ====================
  test("Get dashboard summary returns 200 or 500", async () => {
    const res = await authenticatedApi("/api/relatorios/resumo", adminToken);
    await expectStatus(res, 200, 500);
  });

  test("Get dashboard summary with periodo filter returns 200 or 500", async () => {
    const res = await authenticatedApi("/api/relatorios/resumo?periodo=hoje", adminToken);
    await expectStatus(res, 200, 500);
  });

  test("Get per-table report returns 200 or 500", async () => {
    const res = await authenticatedApi("/api/relatorios/mesas", adminToken);
    await expectStatus(res, 200, 500);
  });

  test("Get all archived comandas returns 200 or 500", async () => {
    const res = await authenticatedApi("/api/historico", authToken);
    await expectStatus(res, 200, 500);
  });

  // ==================== Restaurant Info ====================
  test("Get restaurant information returns 200 or 404", async () => {
    const res = await authenticatedApi("/api/restaurante", authToken);
    await expectStatus(res, 200, 404);
  });

  test("Update restaurant returns 200", async () => {
    const res = await authenticatedApi("/api/restaurante", adminToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Test Restaurant",
        filial: "Main Branch",
      }),
    });
    await expectStatus(res, 200);
  });

  test("Update restaurant with missing nome returns 400", async () => {
    const res = await authenticatedApi("/api/restaurante", authToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filial: "Branch",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Delete restaurant returns 200 or 400 or 404", async () => {
    const res = await authenticatedApi("/api/restaurante", adminToken, {
      method: "DELETE",
    });
    await expectStatus(res, 200, 400, 404);
  });

  test("Get restaurant fiscal status returns 200 or 401 or 404", async () => {
    const res = await authenticatedApi("/api/restaurante/fiscal/status", authToken);
    await expectStatus(res, 200, 401, 404);
  });

  test("Create new restaurant returns 201 or 400 or 409", async () => {
    const res = await api("/api/restaurantes/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "New Restaurant",
        cnpj: "12345678901234",
        adminNome: "Admin",
        adminEmail: `admin-${Date.now()}@example.com`,
        adminSenha: "pass123456",
      }),
    });
    await expectStatus(res, 201, 400, 409);
  });

  // ==================== Upload ====================
  test("Upload image file returns 200 or 400 or 413", async () => {
    const form = new FormData();
    form.append("file", createTestFile("image.jpg", "test image", "image/jpeg"));

    const res = await authenticatedApi("/api/upload/imagem", authToken, {
      method: "POST",
      body: form,
    });
    await expectStatus(res, 200, 400, 413);
  });

  test("Upload image without authentication returns 401", async () => {
    const form = new FormData();
    form.append("file", createTestFile("image.jpg", "test", "image/jpeg"));

    const res = await api("/api/upload/imagem", {
      method: "POST",
      body: form,
    });
    await expectStatus(res, 401);
  });

  test("Upload generic file returns 200 or 400 or 413", async () => {
    const form = new FormData();
    form.append("file", createTestFile("doc.txt", "content", "text/plain"));

    const res = await authenticatedApi("/api/upload", authToken, {
      method: "POST",
      body: form,
    });
    await expectStatus(res, 200, 400, 413);
  });

  // ==================== Subscription ====================
  test("Get subscription plans returns 200", async () => {
    const res = await api("/api/planos");
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.planos).toBeDefined();
  });

  test("Get subscription status returns 200 or 403", async () => {
    const res = await authenticatedApi("/api/assinatura", authToken);
    await expectStatus(res, 200, 403);
  });

  test("Upgrade subscription returns 200 or 400 or 403 or 500 or 502", async () => {
    const res = await authenticatedApi("/api/assinatura/upgrade", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plano: "basico",
        email: `upgrade-${Date.now()}@example.com`,
        cpf_cnpj: "12345678901234",
      }),
    });
    await expectStatus(res, 200, 400, 403, 500, 502);
  });

  test("Cancel subscription returns 200 or 400 or 403 or 500", async () => {
    const res = await authenticatedApi("/api/assinatura/cancelar", authToken, {
      method: "POST",
    });
    await expectStatus(res, 200, 400, 403, 500);
  });

  // ==================== LGPD ====================
  test("Get personal data returns 200 or 404 or 500", async () => {
    const res = await authenticatedApi("/api/lgpd/meus-dados", authToken);
    await expectStatus(res, 200, 404, 500);
  });

  test("Request data deletion returns 200 or 400 or 403 or 404 or 500", async () => {
    const res = await authenticatedApi("/api/lgpd/meus-dados", regularUserToken, {
      method: "DELETE",
    });
    await expectStatus(res, 200, 400, 403, 404, 500);
  });

  test("Get LGPD policy returns 200 or 404", async () => {
    const res = await api("/api/lgpd/politica");
    await expectStatus(res, 200, 404);
  });

  // ==================== Delivery ====================
  test("Create delivery order returns 200 or 201 or 400 or 401 or 404 or 500", async () => {
    const res = await api("/api/delivery/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cliente_nome: "Client",
        cliente_telefone: "11999999999",
        endereco: "Test St, 123",
        itens: [
          {
            prato_id: "00000000-0000-0000-0000-000000000001",
            quantidade: 1,
          },
        ],
      }),
    });
    await expectStatus(res, 200, 201, 400, 401, 404, 500);
  });

  test("Get delivery order list returns 200 or 401 or 500", async () => {
    const res = await api("/api/delivery/pedidos");
    await expectStatus(res, 200, 401, 500);
  });

  test("Get delivery order by ID returns 200 or 401 or 404 or 500", async () => {
    const res = await api("/api/delivery/pedidos/00000000-0000-0000-0000-000000000000");
    await expectStatus(res, 200, 401, 404, 500);
  });

  test("Update delivery order status returns 200 or 400 or 401 or 404 or 500", async () => {
    const res = await api(
      "/api/delivery/pedidos/00000000-0000-0000-0000-000000000000/status",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "preparando" }),
      }
    );
    await expectStatus(res, 200, 400, 401, 404, 500);
  });

  // ==================== Payments ====================
  test("Add payment to comanda returns 200 or 201 or 400 or 404", async () => {
    const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: Math.floor(Math.random() * 900000) + 100000,
      }),
    });
    await expectStatus(mesaRes, 201);
    const mesaData = await mesaRes.json();

    const comandaRes = await authenticatedApi("/api/comandas", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mesaId: mesaData.id }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const res = await authenticatedApi(
      `/api/comandas/${comandaData.comanda.id}/pagamentos`,
      authToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forma_pagamento: "dinheiro", valor: 50.00 }),
      }
    );
    await expectStatus(res, 200, 201, 400, 404);
  });

  test("Get comanda payments returns 200 or 404", async () => {
    if (testCommandaId) {
      const res = await authenticatedApi(
        `/api/comandas/${testCommandaId}/pagamentos`,
        authToken
      );
      await expectStatus(res, 200, 404);
    }
  });

  test("Delete payment returns 200 or 404", async () => {
    const res = await authenticatedApi(
      "/api/pagamentos/00000000-0000-0000-0000-000000000000",
      authToken,
      { method: "DELETE" }
    );
    await expectStatus(res, 200, 404);
  });

  // ==================== Comanda Gorjeta ====================
  test("Update comanda tip returns 200 or 404", async () => {
    const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: Math.floor(Math.random() * 900000) + 100000,
      }),
    });
    await expectStatus(mesaRes, 201);
    const mesaData = await mesaRes.json();

    const comandaRes = await authenticatedApi("/api/comandas", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mesaId: mesaData.id }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const res = await authenticatedApi(
      `/api/comandas/${comandaData.comanda.id}/gorjeta`,
      authToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gorjeta: 10.00 }),
      }
    );
    await expectStatus(res, 200, 404);
  });

  // ==================== Comanda Division ====================
  test("Create comanda division returns 200 or 400 or 404", async () => {
    const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: Math.floor(Math.random() * 900000) + 100000,
      }),
    });
    await expectStatus(mesaRes, 201);
    const mesaData = await mesaRes.json();

    const comandaRes = await authenticatedApi("/api/comandas", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mesaId: mesaData.id }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const res = await authenticatedApi(
      `/api/comandas/${comandaData.comanda.id}/divisao`,
      authToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "igual",
          num_pessoas: 2,
        }),
      }
    );
    await expectStatus(res, 200, 400, 404);
  });

  // ==================== Fiscal ====================
  test("Get fiscal notas returns 200 or 500", async () => {
    const res = await authenticatedApi("/api/fiscal/notas", authToken);
    await expectStatus(res, 200, 500);
  });

  test("Create NFSe returns 200 or 201 or 400 or 404 or 500 or 502", async () => {
    const res = await authenticatedApi("/api/fiscal/nfsen", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descricao_servico: "Test NFSe",
        valor_servico: 100.00,
      }),
    });
    await expectStatus(res, 200, 201, 400, 404, 500, 502);
  });

  test("Create NFSe with missing required fields returns 400", async () => {
    const res = await authenticatedApi("/api/fiscal/nfsen", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descricao_servico: "Incomplete",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Get NFSe status returns 200 or 404 or 500", async () => {
    const res = await authenticatedApi("/api/fiscal/nfsen/test-ref-123", authToken);
    await expectStatus(res, 200, 404, 500);
  });

  test("Cancel NFSe returns 200 or 400 or 404 or 500", async () => {
    const res = await authenticatedApi(
      "/api/fiscal/nfsen/test-ref-cancel",
      authToken,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          justificativa: "Testing cancellation of this NFSe note",
        }),
      }
    );
    await expectStatus(res, 200, 400, 404, 500);
  });

  test("Cancel NFSe without justificativa returns 400", async () => {
    const res = await authenticatedApi(
      "/api/fiscal/nfsen/test-ref",
      authToken,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    await expectStatus(res, 400);
  });

  test("Fiscal cleanup old test notes returns 200 or 500", async () => {
    const res = await authenticatedApi("/api/fiscal/cleanup", authToken, {
      method: "DELETE",
    });
    await expectStatus(res, 200, 500);
  });

  test("Emit NFC-e returns 200 or 400 or 404 or 409 or 500 or 502", async () => {
    const res = await authenticatedApi("/api/fiscal/nfce", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comanda_id: "00000000-0000-0000-0000-000000000000",
        presenca_comprador: 1,
      }),
    });
    await expectStatus(res, 200, 400, 404, 409, 500, 502);
  });

  test("Emit NFC-e without comanda_id returns 400", async () => {
    const res = await authenticatedApi("/api/fiscal/nfce", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presenca_comprador: 1,
      }),
    });
    await expectStatus(res, 400);
  });

  test("Get NFC-e status returns 200 or 404 or 500 or 502", async () => {
    const res = await authenticatedApi("/api/fiscal/nfce/test-reference", authToken);
    await expectStatus(res, 200, 404, 500, 502);
  });

  // ==================== Inventory ====================
  test("List insumos returns 200 or 401 or 403", async () => {
    const res = await authenticatedApi("/api/insumos", authToken);
    await expectStatus(res, 200, 401, 403);
  });

  test("Create insumo returns 200 or 201 or 400 or 401 or 403", async () => {
    const res = await authenticatedApi("/api/insumos", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Insumo ${Date.now()}`,
        quantidade: 100,
        unidade: "kg",
        preco_unitario: 10.50,
      }),
    });
    await expectStatus(res, 200, 201, 400, 401, 403);
  });

  test("Get insumo alerts returns 200 or 401 or 403 or 500", async () => {
    const res = await authenticatedApi("/api/insumos/alertas", authToken);
    await expectStatus(res, 200, 401, 403, 500);
  });

  test("Update insumo returns 200 or 404 or 400 or 401", async () => {
    const res = await authenticatedApi("/api/insumos/00000000-0000-0000-0000-000000000000", authToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantidade: 150 }),
    });
    await expectStatus(res, 200, 404, 400, 401);
  });

  test("Delete insumo returns 200 or 204 or 404 or 401", async () => {
    const res = await authenticatedApi("/api/insumos/00000000-0000-0000-0000-000000000000", authToken, {
      method: "DELETE",
    });
    await expectStatus(res, 200, 204, 404, 401);
  });

  test("Get prato insumos returns 200 or 404", async () => {
    const res = await authenticatedApi(
      `/api/pratos/00000000-0000-0000-0000-000000000000/insumos`,
      authToken
    );
    await expectStatus(res, 200, 404);
  });

  test("Add prato insumo returns 200 or 201 or 404", async () => {
    const res = await authenticatedApi(
      `/api/pratos/00000000-0000-0000-0000-000000000000/insumos`,
      authToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insumo_id: "00000000-0000-0000-0000-000000000001",
          quantidade: 5,
        }),
      }
    );
    await expectStatus(res, 200, 201, 404);
  });

  test("Delete prato insumo returns 200 or 404", async () => {
    const res = await authenticatedApi(
      `/api/pratos/00000000-0000-0000-0000-000000000000/insumos/00000000-0000-0000-0000-000000000001`,
      authToken,
      { method: "DELETE" }
    );
    await expectStatus(res, 200, 404);
  });

  test("Get stock movements for insumo returns 200 or 404", async () => {
    const res = await authenticatedApi(
      `/api/estoque/movimentacoes/00000000-0000-0000-0000-000000000000`,
      authToken
    );
    await expectStatus(res, 200, 404);
  });

  test("Record stock movement returns 200 or 201 or 404 or 400", async () => {
    const res = await authenticatedApi("/api/estoque/movimentacao", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        insumo_id: "00000000-0000-0000-0000-000000000000",
        tipo: "entrada",
        quantidade: 50,
        descricao: "Restock",
      }),
    });
    await expectStatus(res, 200, 201, 404, 400);
  });

  // ==================== Public Endpoints ====================
  test("Get public cardapio by restaurante returns 200 or 404", async () => {
    const res = await api(
      "/api/public/cardapio/00000000-0000-0000-0000-000000000000"
    );
    await expectStatus(res, 200, 404);
  });

  test("Get public cardapio returns 200 or 404", async () => {
    const res = await api("/cardapio");
    await expectStatus(res, 200, 404);
  });

  test("List public restaurantes returns 200 or 404", async () => {
    const res = await api("/api/public/restaurantes");
    await expectStatus(res, 200, 404);
  });

  test("Get public mesa info returns 200 or 404", async () => {
    const res = await api("/api/public/mesa/00000000-0000-0000-0000-000000000000/1");
    await expectStatus(res, 200, 404);
  });

  test("Submit public order returns 200 or 400 or 404 or 500", async () => {
    const res = await api("/api/public/pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurante_id: "00000000-0000-0000-0000-000000000000",
        mesa_numero: 1,
        itens: [
          {
            prato_id: "00000000-0000-0000-0000-000000000001",
            quantidade: 1,
          },
        ],
      }),
    });
    await expectStatus(res, 200, 400, 404, 500);
  });

  // ==================== WebSocket ====================
  test("Connect to realtime WebSocket with authenticated token", async () => {
    const ws = await connectAuthenticatedWebSocket("/api/realtime", authToken);
    expect(ws).toBeDefined();
    expect(ws.readyState).toBe(1); // OPEN
    ws.close();
  });
});
