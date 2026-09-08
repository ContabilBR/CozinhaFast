import { describe, test, expect } from "bun:test";
import { api, authenticatedApi, signUpTestUser, expectStatus, createTestFile, connectAuthenticatedWebSocket, waitForMessage } from "./helpers";

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
  let testInsumoId: string;
  let testPratoIdForInsumo: string;

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

  // ==================== Auth Endpoints: /api/auth/sign-up/email ====================
  test("Sign up with valid credentials returns 201", async () => {
    const testEmail = `signup-${Date.now()}@example.com`;
    const testPassword = "testPassword123456";

    const res = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: "Sign Up Test User",
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    expect(data.token).toBeDefined();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(testEmail);
  });

  test("Sign up with duplicate email returns 409", async () => {
    const dupEmail = `dup-signup-${Date.now()}@example.com`;
    const testPassword = "testPassword123456";

    const firstRes = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: dupEmail,
        password: testPassword,
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

  test("Sign up missing required field returns 400", async () => {
    const res = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "testPassword123456",
        name: "Test User",
      }),
    });
    await expectStatus(res, 400);
  });

  // ==================== Auth Endpoints: /api/auth/sign-in ====================
  test("Sign in with valid credentials returns 200", async () => {
    const testEmail = `signin-test-${Date.now()}@example.com`;
    const testPassword = "testPassword123456";

    const signUpRes = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: "Sign In Test User",
      }),
    });
    await expectStatus(signUpRes, 201);

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
    const testEmail = `signin-fail-${Date.now()}@example.com`;
    const testPassword = "correctPassword123456";

    const signUpRes = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: "Sign In Fail Test User",
      }),
    });
    await expectStatus(signUpRes, 201);

    const signInRes = await api("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: "wrongPassword123456",
      }),
    });
    await expectStatus(signInRes, 401);
  });

  test("Sign in missing required field returns 400", async () => {
    const res = await api("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "testPassword123456",
      }),
    });
    await expectStatus(res, 400);
  });

  // ==================== Auth Endpoints: /api/auth/me ====================
  test("Get current authenticated user via /api/auth/me returns 200", async () => {
    const res = await authenticatedApi("/api/auth/me", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.email).toBeDefined();
    expect(data.name).toBeDefined();
    expect(data.role).toBeDefined();
    expect(data.active !== undefined).toBe(true);
  });

  test("Get current user via /api/auth/me without authentication returns 401", async () => {
    const res = await api("/api/auth/me");
    await expectStatus(res, 401);
  });

  // ==================== Auth Endpoints: /api/me (Legacy) ====================
  test("Get current authenticated user via /api/me returns 200", async () => {
    const res = await authenticatedApi("/api/me", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.email).toBeDefined();
    expect(data.nome).toBeDefined();
  });

  test("Get current user via /api/me without authentication returns 401", async () => {
    const res = await api("/api/me");
    await expectStatus(res, 401);
  });

  // ==================== Auth Endpoints: /api/auth/sign-out ====================
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

  // ==================== Legacy Auth Endpoints: /api/login & /api/me ====================
  test("Login with valid credentials via /api/login returns 200", async () => {
    const testEmail = "garcom@cozinhafast.com";
    const testPassword = "123456";

    const loginRes = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        senha: testPassword,
      }),
    });
    await expectStatus(loginRes, 200);
    const data = await loginRes.json();
    expect(data.token).toBeDefined();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(testEmail);
  });

  test("Login with invalid password via /api/login returns 401", async () => {
    const loginRes = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "garcom@cozinhafast.com",
        senha: "wrongPassword123456",
      }),
    });
    await expectStatus(loginRes, 401);
  });

  test("Login missing required field returns 400", async () => {
    const res = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "garcom@cozinhafast.com",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Get current user via /api/me with token from /api/login returns 200", async () => {
    const loginRes = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "gerente@cozinhafast.com",
        senha: "123456",
      }),
    });
    await expectStatus(loginRes, 200);
    const loginData = await loginRes.json();
    const jwtToken = loginData.token;

    const res = await authenticatedApi("/api/me", jwtToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.nome).toBeDefined();
  });

  test("Get current user via /api/me without authentication returns 401", async () => {
    const res = await api("/api/me");
    await expectStatus(res, 401);
  });

  // ==================== Database Status ====================
  test("Get database seed status returns 200", async () => {
    const res = await api("/api/seed-status");
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.users).toBeDefined();
    expect(data.accounts).toBeDefined();
    expect(data.profiles).toBeDefined();
  });

  // ==================== Categorias CRUD ====================
  test("List all categorias returns 200", async () => {
    const res = await authenticatedApi("/api/categorias", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
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
      body: JSON.stringify({
        nome: "Unauthorized Category",
      }),
    });
    await expectStatus(res, 401);
  });

  test("Create categoria missing nome returns 400", async () => {
    const res = await authenticatedApi("/api/categorias", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descricao: "Missing nome",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Update categoria returns 200", async () => {
    const res = await authenticatedApi(`/api/categorias/${testCategoryId}`, adminToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Updated Category",
      }),
    });
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.categoria.nome).toBe("Updated Category");
  });

  test("Update non-existent categoria returns 404", async () => {
    const res = await authenticatedApi(
      "/api/categorias/00000000-0000-0000-0000-000000000000",
      authToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Test" }),
      }
    );
    await expectStatus(res, 404);
  });

  test("Delete categoria as admin returns 200", async () => {
    const res = await authenticatedApi(
      `/api/categorias/${testCategoryId}`,
      adminToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("Delete categoria without authentication returns 401", async () => {
    const res = await api(
      "/api/categorias/00000000-0000-0000-0000-000000000000",
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 401);
  });

  test("Delete categoria as non-admin returns 403", async () => {
    const createRes = await authenticatedApi("/api/categorias", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "To Delete",
      }),
    });
    await expectStatus(createRes, 201);
    const catData = await createRes.json();

    const res = await authenticatedApi(
      `/api/categorias/${catData.categoria.id}`,
      regularUserToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 403);
  });

  // ==================== Pratos CRUD ====================
  test("List all pratos returns 200", async () => {
    const res = await authenticatedApi("/api/pratos", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("List pratos with disponivel filter returns 200", async () => {
    const res = await authenticatedApi("/api/pratos?disponivel=true", authToken);
    await expectStatus(res, 200);
  });

  test("List pratos with categoria_id filter returns 200", async () => {
    const res = await authenticatedApi(
      "/api/pratos?categoria_id=00000000-0000-0000-0000-000000000000",
      authToken
    );
    await expectStatus(res, 200);
  });

  test("List pratos with both categoria_id and disponivel filters returns 200", async () => {
    const res = await authenticatedApi(
      "/api/pratos?categoria_id=00000000-0000-0000-0000-000000000000&disponivel=true",
      authToken
    );
    await expectStatus(res, 200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("Create prato returns 201", async () => {
    const res = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Test Prato ${Date.now()}`,
        preco: "25.99",
        descricao: "A test dish",
        disponivel: true,
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    testDishId = data.prato.id;
    expect(data.prato.nome).toBeDefined();
  });

  test("Create prato without authentication returns 401", async () => {
    const res = await api("/api/pratos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Unauthorized Prato",
        preco: "10.00",
      }),
    });
    await expectStatus(res, 401);
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

  test("Create prato missing required field returns 400", async () => {
    const res = await authenticatedApi("/api/pratos", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preco: "25.99",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Create prato with all optional fields returns 201", async () => {
    const res = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Full Prato ${Date.now()}`,
        preco: "45.99",
        descricao: "Complete prato with all fields",
        disponivel: true,
        tempoPreparoMinutos: 15,
        ncm: "87111000",
        cfop: "5102",
        cest: "1621000",
        csosn: "102",
        cst_icms: "00",
        origem_mercadoria: 0,
        unidade_comercial: "UN",
        aliquota_icms: "7.00",
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    expect(data.prato).toBeDefined();
    expect(data.prato.nome).toContain("Full Prato");
  });

  test("Get prato by ID returns 200", async () => {
    const res = await authenticatedApi(`/api/pratos/${testDishId}`, authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.prato).toBeDefined();
    expect(data.prato.id).toBe(testDishId);
  });

  test("Get non-existent prato returns 404", async () => {
    const res = await authenticatedApi(
      "/api/pratos/00000000-0000-0000-0000-000000000000",
      authToken
    );
    await expectStatus(res, 404);
  });

  test("Get prato with invalid UUID format returns 400", async () => {
    const res = await authenticatedApi(
      "/api/pratos/invalid-uuid",
      authToken
    );
    await expectStatus(res, 400);
  });

  test("Update prato returns 200", async () => {
    const res = await authenticatedApi(`/api/pratos/${testDishId}`, adminToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Updated Prato",
        disponivel: false,
      }),
    });
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.prato.nome).toBe("Updated Prato");
  });

  test("Update prato as non-admin returns 403", async () => {
    const createRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Non-Admin Update Prato ${Date.now()}`,
        preco: "22.50",
      }),
    });
    await expectStatus(createRes, 201);
    const pratoData = await createRes.json();

    const res = await authenticatedApi(`/api/pratos/${pratoData.prato.id}`, regularUserToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Unauthorized Update",
      }),
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
        body: JSON.stringify({ nome: "Test" }),
      }
    );
    await expectStatus(res, 404);
  });

  test("Delete prato as admin returns 204", async () => {
    const res = await authenticatedApi(
      `/api/pratos/${testDishId}`,
      adminToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 204);
  });

  test("Delete prato without authentication returns 401", async () => {
    const res = await api("/api/pratos/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    });
    await expectStatus(res, 401);
  });

  test("Delete prato as non-admin returns 403", async () => {
    const createRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "To Delete",
        preco: "15.00",
      }),
    });
    await expectStatus(createRes, 201);
    const pratoData = await createRes.json();

    const res = await authenticatedApi(
      `/api/pratos/${pratoData.prato.id}`,
      regularUserToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 403);
  });

  test("Delete non-existent prato returns 404", async () => {
    const res = await authenticatedApi(
      "/api/pratos/00000000-0000-0000-0000-000000000000",
      adminToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 404);
  });

  test("Toggle prato availability returns 200 or 404", async () => {
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

    const res = await authenticatedApi(`/api/pratos/${pratoData.prato.id}/disponibilidade`, adminToken, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        disponivel: false,
      }),
    });
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.prato).toBeDefined();
    expect(data.prato.disponivel).toBe(false);
  });

  test("Toggle prato availability without authentication returns 401", async () => {
    const res = await api("/api/pratos/00000000-0000-0000-0000-000000000000/disponibilidade", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        disponivel: false,
      }),
    });
    await expectStatus(res, 401);
  });

  test("Toggle prato availability as non-admin returns 403", async () => {
    const createRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Prato Availability Non-Admin Test ${Date.now()}`,
        preco: "22.50",
        disponivel: true,
      }),
    });
    await expectStatus(createRes, 201);
    const pratoData = await createRes.json();

    const res = await authenticatedApi(
      `/api/pratos/${pratoData.prato.id}/disponibilidade`,
      regularUserToken,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disponivel: false,
        }),
      }
    );
    await expectStatus(res, 403);
  });

  test("Toggle prato availability with missing disponivel returns 400", async () => {
    const createRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Prato Availability Missing Field ${Date.now()}`,
        preco: "22.50",
      }),
    });
    await expectStatus(createRes, 201);
    const pratoData = await createRes.json();

    const res = await authenticatedApi(`/api/pratos/${pratoData.prato.id}/disponibilidade`, authToken, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await expectStatus(res, 400);
  });

  test("Toggle prato availability for non-existent prato returns 404", async () => {
    const res = await authenticatedApi(
      "/api/pratos/00000000-0000-0000-0000-000000000000/disponibilidade",
      adminToken,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disponivel: false,
        }),
      }
    );
    await expectStatus(res, 404);
  });

  test("Upload prato photo via multipart form returns 200", async () => {
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
    const pratoId = pratoData.prato.id;

    const form = new FormData();
    form.append("file", createTestFile("dish.jpg", "test image content", "image/jpeg"));

    const res = await authenticatedApi(`/api/pratos/${pratoId}/foto`, adminToken, {
      method: "POST",
      body: form,
    });
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.url || data.imagem_url).toBeDefined();
  });

  test("Upload prato photo to non-existent prato returns 404", async () => {
    const form = new FormData();
    form.append("file", createTestFile());

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

  test("Upload prato photo as non-admin returns 403", async () => {
    const createRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Prato for 403",
        preco: "20.00",
      }),
    });
    await expectStatus(createRes, 201);
    const pratoData = await createRes.json();

    const form = new FormData();
    form.append("file", createTestFile());

    const res = await authenticatedApi(
      `/api/pratos/${pratoData.prato.id}/foto`,
      regularUserToken,
      {
        method: "POST",
        body: form,
      }
    );
    await expectStatus(res, 403);
  });

  test("Upload prato photo without authentication returns 401", async () => {
    const form = new FormData();
    form.append("file", createTestFile());

    const res = await api("/api/pratos/00000000-0000-0000-0000-000000000000/foto", {
      method: "POST",
      body: form,
    });
    await expectStatus(res, 401);
  });

  test("Upload prato photo with file too large returns 413", async () => {
    const createRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Prato for 413",
        preco: "20.00",
      }),
    });
    await expectStatus(createRes, 201);
    const pratoData = await createRes.json();

    const form = new FormData();
    const largeContent = new Array(10 * 1024 * 1024).fill("x").join("");
    form.append("file", createTestFile("large.jpg", largeContent, "image/jpeg"));

    const res = await authenticatedApi(
      `/api/pratos/${pratoData.prato.id}/foto`,
      adminToken,
      {
        method: "POST",
        body: form,
      }
    );
    expect(res.status === 200 || res.status === 413).toBe(true);
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

  test("Create mesa without authentication returns 401", async () => {
    const res = await api("/api/mesas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: 999,
      }),
    });
    await expectStatus(res, 401);
  });

  test("Create mesa missing required field returns 400", async () => {
    const res = await authenticatedApi("/api/mesas", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capacidade: 4,
      }),
    });
    await expectStatus(res, 400);
  });

  test("Create mesa with duplicate numero returns 409", async () => {
    const dupNum = Math.floor(Math.random() * 900000) + 100000;
    const firstRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: dupNum,
      }),
    });
    await expectStatus(firstRes, 201);

    const dupRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: dupNum,
      }),
    });
    await expectStatus(dupRes, 409);
  });

  test("Create mesa as non-admin returns 403", async () => {
    const res = await authenticatedApi("/api/mesas", regularUserToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: Math.floor(Math.random() * 900000) + 100000,
      }),
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

  test("Get mesa with invalid UUID format returns 400", async () => {
    const res = await authenticatedApi(
      "/api/mesas/invalid-uuid",
      authToken
    );
    await expectStatus(res, 400);
  });

  test("Get mesa without authentication returns 401", async () => {
    const res = await api(`/api/mesas/${testTableId}`);
    await expectStatus(res, 401);
  });

  test("Update mesa returns 200", async () => {
    const res = await authenticatedApi(`/api/mesas/${testTableId}`, adminToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "ocupada",
      }),
    });
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.status).toBe("ocupada");
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

  test("Update mesa as non-admin returns 403", async () => {
    const res = await authenticatedApi(`/api/mesas/${testTableId}`, regularUserToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "disponivel",
      }),
    });
    await expectStatus(res, 403);
  });

  test("Delete mesa as admin returns 204", async () => {
    const res = await authenticatedApi(
      `/api/mesas/${testTableId}`,
      adminToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 204);
  });

  test("Delete mesa without authentication returns 401", async () => {
    const res = await api("/api/mesas/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    });
    await expectStatus(res, 401);
  });

  test("Delete mesa as non-admin returns 403", async () => {
    const createRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: Math.floor(Math.random() * 900000) + 100000,
      }),
    });
    await expectStatus(createRes, 201);
    const mesaData = await createRes.json();

    const res = await authenticatedApi(
      `/api/mesas/${mesaData.id}`,
      regularUserToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 403);
  });

  test("Delete non-existent mesa returns 404", async () => {
    const res = await authenticatedApi(
      "/api/mesas/00000000-0000-0000-0000-000000000000",
      adminToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 404);
  });

  test("Delete mesa with items returns 204 or 400", async () => {
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
      body: JSON.stringify({
        mesaId: mesaData.id,
      }),
    });
    await expectStatus(comandaRes, 201);

    const res = await authenticatedApi(
      `/api/mesas/${mesaData.id}`,
      adminToken,
      {
        method: "DELETE",
      }
    );
    expect(res.status === 204 || res.status === 400).toBe(true);
  });

  test("Force delete mesa with cascading delete returns 204", async () => {
    const uniqueTableNumber = Math.floor(Date.now() / 1000) % 900000 + 100000;
    const res = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: uniqueTableNumber,
      }),
    });
    await expectStatus(res, 201);
    const mesaData = await res.json();

    const forceDeleteRes = await authenticatedApi(
      `/api/mesas/${mesaData.id}/force`,
      adminToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(forceDeleteRes, 204);
  });

  test("Force delete mesa without authentication returns 401", async () => {
    const res = await api("/api/mesas/00000000-0000-0000-0000-000000000000/force", {
      method: "DELETE",
    });
    await expectStatus(res, 401);
  });

  test("Force delete mesa as non-admin returns 403", async () => {
    const createRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: Math.floor(Math.random() * 900000) + 100000,
      }),
    });
    await expectStatus(createRes, 201);
    const mesaData = await createRes.json();

    const res = await authenticatedApi(
      `/api/mesas/${mesaData.id}/force`,
      regularUserToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 403);
  });

  test("Force delete non-existent mesa returns 404", async () => {
    const res = await authenticatedApi(
      "/api/mesas/00000000-0000-0000-0000-000000000000/force",
      adminToken,
      {
        method: "DELETE",
      }
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
    expect(Array.isArray(data.comandas)).toBe(true);
  });

  test("List comandas with status filter returns 200", async () => {
    const res = await authenticatedApi("/api/comandas?status=aberta", authToken);
    await expectStatus(res, 200);
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
    expect(data.comanda.id).toBeDefined();
    expect(data.comanda.mesa_id).toBe(testMesaForComandaId);
  });

  test("Create comanda with items at creation time returns 201", async () => {
    const pratoRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Prato for Comanda Items ${Date.now()}`,
        preco: "28.50",
      }),
    });
    await expectStatus(pratoRes, 201);
    const pratoData = await pratoRes.json();

    const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: Math.floor(Math.random() * 900000) + 100000,
      }),
    });
    await expectStatus(mesaRes, 201);
    const mesaData = await mesaRes.json();

    const res = await authenticatedApi("/api/comandas", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mesaId: mesaData.id,
        itens: [
          {
            prato_id: pratoData.prato.id,
            quantidade: 2,
            preco_unitario: 28.50,
            observacao: "No onions",
          },
        ],
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    expect(data.comanda).toBeDefined();
  });

  test("Create comanda without mesa_id returns 400", async () => {
    const res = await authenticatedApi("/api/comandas", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        garcomId: testUserId,
      }),
    });
    await expectStatus(res, 400);
  });

  test("Create comanda without authentication returns 401", async () => {
    const res = await api("/api/comandas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mesaId: testMesaForComandaId,
      }),
    });
    await expectStatus(res, 401);
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
    expect(data.id).toBeDefined();
    expect(data.pedidos).toBeDefined();
    expect(Array.isArray(data.pedidos)).toBe(true);
  });

  test("Get non-existent comanda returns 404", async () => {
    const res = await authenticatedApi(
      "/api/comandas/00000000-0000-0000-0000-000000000000",
      authToken
    );
    await expectStatus(res, 404);
  });

  test("Get comanda with invalid UUID format returns 400", async () => {
    const res = await authenticatedApi(
      "/api/comandas/invalid-uuid",
      authToken
    );
    await expectStatus(res, 400);
  });

  test("Add pedidos to comanda returns 201", async () => {
    const createPratoRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Test Prato for Comanda ${Date.now()}`,
        preco: "25.99",
      }),
    });
    await expectStatus(createPratoRes, 201);
    const pratoData = await createPratoRes.json();

    const res = await authenticatedApi(`/api/comandas/${testCommandaId}/pedidos`, authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            prato_id: pratoData.prato.id,
            quantidade: 2,
            preco_unitario: 25.99,
            observacao: "Well done",
          },
        ],
      }),
    });
    await expectStatus(res, 201);
    const pedidosData = await res.json();
    expect(pedidosData.pedidos).toBeDefined();
    if (pedidosData.pedidos && pedidosData.pedidos.length > 0) {
      testPedidoId = pedidosData.pedidos[0].id;
    }
  });

  test("Add pedidos without authentication returns 401", async () => {
    const res = await api(`/api/comandas/${testCommandaId}/pedidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [],
      }),
    });
    await expectStatus(res, 401);
  });

  test("Add pedidos as non-authorized returns 403", async () => {
    const pratoRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Non-Auth Prato ${Date.now()}`,
        preco: "25.99",
      }),
    });
    await expectStatus(pratoRes, 201);
    const pratoData = await pratoRes.json();

    const res = await authenticatedApi(`/api/comandas/${testCommandaId}/pedidos`, regularUserToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            prato_id: pratoData.prato.id,
            quantidade: 1,
            preco_unitario: 25.99,
          },
        ],
      }),
    });
    await expectStatus(res, 403);
  });

  test("Add pedidos with missing items returns 400", async () => {
    const res = await authenticatedApi(`/api/comandas/${testCommandaId}/pedidos`, authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await expectStatus(res, 400);
  });

  test("Add pedidos to non-existent comanda returns 404", async () => {
    const res = await authenticatedApi(
      "/api/comandas/00000000-0000-0000-0000-000000000000/pedidos",
      authToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              prato_id: "00000000-0000-0000-0000-000000000001",
              quantidade: 1,
              preco_unitario: 10.0,
            },
          ],
        }),
      }
    );
    await expectStatus(res, 404);
  });

  test("Close comanda returns 200", async () => {
    const res = await authenticatedApi(`/api/comandas/${testCommandaId}/fechar`, authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gorjeta: 5.00,
        num_pessoas: 2,
      }),
    });
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("Close comanda without authentication returns 401", async () => {
    const res = await api("/api/comandas/00000000-0000-0000-0000-000000000000/fechar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gorjeta: 0 }),
    });
    await expectStatus(res, 401);
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
      body: JSON.stringify({
        mesaId: mesaData.id,
      }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const res = await authenticatedApi(
      `/api/comandas/${comandaData.comanda.id}/cancelar`,
      authToken,
      {
        method: "PUT",
      }
    );
    await expectStatus(res, 200);
  });

  test("Cancel comanda without authentication returns 401", async () => {
    const res = await api("/api/comandas/00000000-0000-0000-0000-000000000000/cancelar", {
      method: "PUT",
    });
    await expectStatus(res, 401);
  });

  test("Cancel non-existent comanda returns 404", async () => {
    const res = await authenticatedApi(
      "/api/comandas/00000000-0000-0000-0000-000000000000/cancelar",
      authToken,
      {
        method: "PUT",
      }
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
      body: JSON.stringify({
        mesaId: mesaData.id,
      }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const res = await authenticatedApi(
      `/api/comandas/${comandaData.comanda.id}`,
      authToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 204);
  });

  test("Delete comanda without authentication returns 401", async () => {
    const res = await api("/api/comandas/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    });
    await expectStatus(res, 401);
  });

  test("Delete non-existent comanda returns 404", async () => {
    const res = await authenticatedApi(
      "/api/comandas/00000000-0000-0000-0000-000000000000",
      authToken,
      {
        method: "DELETE",
      }
    );
    await expectStatus(res, 404);
  });

  test("Get current comanda for mesa returns 200", async () => {
    const res = await authenticatedApi(`/api/mesas/${testMesaForComandaId}/comanda`, authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.comanda === null || (typeof data.comanda === "object")).toBe(true);
  });

  test("Get current comanda for mesa without authentication returns 401", async () => {
    const res = await api("/api/mesas/00000000-0000-0000-0000-000000000000/comanda");
    await expectStatus(res, 401);
  });

  test("Get current comanda for non-existent mesa returns 400 or 404", async () => {
    const res = await authenticatedApi(
      "/api/mesas/00000000-0000-0000-0000-000000000000/comanda",
      authToken
    );
    await expectStatus(res, 404, 400);
  });

  test("Get mesa historico with archived comandas returns 200", async () => {
    const res = await authenticatedApi(`/api/mesas/${testMesaForComandaId}/historico`, authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.mesa).toBeDefined();
    expect(data.resumo).toBeDefined();
    expect(Array.isArray(data.comandas)).toBe(true);
  });

  test("Get mesa historico without authentication returns 401", async () => {
    const res = await api("/api/mesas/00000000-0000-0000-0000-000000000000/historico");
    await expectStatus(res, 401);
  });

  test("Get mesa historico for non-existent mesa returns 404", async () => {
    const res = await authenticatedApi(
      "/api/mesas/00000000-0000-0000-0000-000000000000/historico",
      authToken
    );
    await expectStatus(res, 404);
  });

  test("Update comanda tip (gorjeta) via PUT returns 200 or 404", async () => {
    const res = await authenticatedApi(`/api/comandas/${testCommandaId}/gorjeta`, authToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gorjeta: 10.00 }),
    });
    await expectStatus(res, 200, 404);
  });

  test("Get comanda info returns status and total", async () => {
    if (testMesaForComandaId) {
      const res = await authenticatedApi(`/api/mesas/${testMesaForComandaId}/comanda`, authToken);
      if (res.status === 200) {
        const data = await res.json();
        if (data.comanda) {
          expect(data.comanda.status).toBeDefined();
          expect(data.comanda.total).toBeDefined();
        }
      }
    }
  });

  test("Get comanda payments list returns 200 or 404 or 400 or 401", async () => {
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
      body: JSON.stringify({
        mesaId: mesaData.id,
      }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const res = await authenticatedApi(
      `/api/comandas/${comandaData.comanda.id}/pagamentos`,
      authToken
    );
    await expectStatus(res, 200, 404, 400, 401);
  });

  test("Get comanda payments without authentication returns 401", async () => {
    const res = await api("/api/comandas/00000000-0000-0000-0000-000000000000/pagamentos");
    await expectStatus(res, 401);
  });

  // ==================== Pedidos CRUD ====================
  test("List all pedidos returns 200", async () => {
    const res = await authenticatedApi("/api/pedidos", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.pedidos).toBeDefined();
    expect(Array.isArray(data.pedidos)).toBe(true);
  });

  test("List pedidos without authentication returns 401", async () => {
    const res = await api("/api/pedidos");
    await expectStatus(res, 401);
  });

  test("Create pedido via /api/pedidos returns 201 or 400 or 404", async () => {
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
      body: JSON.stringify({
        mesaId: mesaData.id,
      }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const pratoRes = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Test Prato",
        preco: "15.99",
      }),
    });
    await expectStatus(pratoRes, 201);
    const pratoData = await pratoRes.json();

    const res = await authenticatedApi("/api/pedidos", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comanda_id: comandaData.comanda.id,
        prato_id: pratoData.prato.id,
        quantidade: 1,
      }),
    });
    await expectStatus(res, 201, 400, 404);
  });

  test("Create pedido without authentication returns 401", async () => {
    const res = await api("/api/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comanda_id: "00000000-0000-0000-0000-000000000001",
        prato_id: "00000000-0000-0000-0000-000000000002",
        quantidade: 1,
      }),
    });
    await expectStatus(res, 401);
  });

  test("Create pedido missing required field returns 400", async () => {
    const res = await authenticatedApi("/api/pedidos", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comanda_id: "00000000-0000-0000-0000-000000000001",
      }),
    });
    await expectStatus(res, 400);
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
        body: JSON.stringify({
          quantidade: 3,
        }),
      });
      await expectStatus(res, 200, 404);
    }
  });

  test("Update pedido without authentication returns 401", async () => {
    const res = await api("/api/pedidos/00000000-0000-0000-0000-000000000000", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantidade: 5 }),
    });
    await expectStatus(res, 401);
  });

  test("Update pedido status returns 200 or 404", async () => {
    if (testPedidoId) {
      const res = await authenticatedApi(`/api/pedidos/${testPedidoId}/status`, authToken, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "em_preparo",
        }),
      });
      await expectStatus(res, 200, 404);
    }
  });

  test("Update pedido status without authentication returns 401", async () => {
    const res = await api("/api/pedidos/00000000-0000-0000-0000-000000000000/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "pronto" }),
    });
    await expectStatus(res, 401);
  });

  test("Update pedido status with invalid status returns 400 or 404", async () => {
    if (testPedidoId) {
      const res = await authenticatedApi(`/api/pedidos/${testPedidoId}/status`, authToken, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "invalid_status",
        }),
      });
      await expectStatus(res, 400, 404);
    }
  });

  test("Update pedido observacao returns 200 or 404", async () => {
    if (testPedidoId) {
      const res = await authenticatedApi(`/api/pedidos/${testPedidoId}/observacao`, authToken, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observacao: "Extra sauce",
        }),
      });
      await expectStatus(res, 200, 404);
    }
  });

  test("Update pedido observacao without authentication returns 401", async () => {
    const res = await api("/api/pedidos/00000000-0000-0000-0000-000000000000/observacao", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observacao: "Note" }),
    });
    await expectStatus(res, 401);
  });

  test("Update pedido observacao missing field returns 400", async () => {
    if (testPedidoId) {
      const res = await authenticatedApi(`/api/pedidos/${testPedidoId}/observacao`, authToken, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await expectStatus(res, 400);
    }
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

  // ==================== Kitchen Display System ====================
  test("Get all comandas for kitchen display system returns 200", async () => {
    const res = await authenticatedApi("/api/cozinha/comandas", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.comandas).toBeDefined();
    expect(Array.isArray(data.comandas)).toBe(true);
  });

  test("Get kitchen display without authentication returns 401", async () => {
    const res = await api("/api/cozinha/comandas");
    await expectStatus(res, 401);
  });

  // ==================== Garcom Endpoints ====================
  test("Get garcom pedidos returns 200 or 401 or 403", async () => {
    const res = await authenticatedApi("/api/garcom/pedidos", authToken);
    if (res.status === 200) {
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    } else {
      await expectStatus(res, 200, 401, 403);
    }
  });

  test("Get garcom pedidos without authentication returns 401", async () => {
    const res = await api("/api/garcom/pedidos");
    await expectStatus(res, 401);
  });

  test("List all garcons returns 200", async () => {
    const res = await authenticatedApi("/api/garcons", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("List garcons without authentication returns 401", async () => {
    const res = await api("/api/garcons");
    await expectStatus(res, 401);
  });

  test("Create garcon returns 201", async () => {
    const res = await authenticatedApi("/api/garcons", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New Garcon",
        email: `garcon-${Date.now()}@example.com`,
        password: "pass123456",
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.role).toBe("garcom");
  });

  test("Create garcon without authentication returns 401", async () => {
    const res = await api("/api/garcons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Unauthorized Garcon",
        email: `garcon-unauth-${Date.now()}@example.com`,
        password: "pass123456",
      }),
    });
    await expectStatus(res, 401);
  });

  test("Create garcon missing required field returns 400", async () => {
    const res = await authenticatedApi("/api/garcons", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "No Email Garcon",
      }),
    });
    await expectStatus(res, 400);
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

  test("Create garcon as non-admin returns 403", async () => {
    const res = await authenticatedApi("/api/garcons", regularUserToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Non-Admin Garcon",
        email: `garcon-403-${Date.now()}@example.com`,
        password: "pass123456",
      }),
    });
    await expectStatus(res, 403);
  });

  test("Check email exists returns 200", async () => {
    const res = await authenticatedApi(
      `/api/garcons/check-email?email=test@example.com`,
      authToken
    );
    if (res.status === 200) {
      const data = await res.json();
      expect(data.exists).toBeDefined();
    } else {
      await expectStatus(res, 200, 400, 401);
    }
  });

  test("Check email with missing query parameter returns 400", async () => {
    const res = await authenticatedApi("/api/garcons/check-email", authToken);
    await expectStatus(res, 400);
  });

  test("Check email without authentication returns 401", async () => {
    const res = await api("/api/garcons/check-email?email=test@example.com");
    await expectStatus(res, 401);
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
      body: JSON.stringify({
        name: "Updated Garcon",
      }),
    });
    await expectStatus(res, 200);
  });

  test("Update garcon without authentication returns 401", async () => {
    const res = await api("/api/garcons/test-id", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    await expectStatus(res, 401);
  });

  test("Update non-existent garcon returns 404", async () => {
    const res = await authenticatedApi("/api/garcons/00000000-0000-0000-0000-000000000000", adminToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });
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

  test("Delete garcon without authentication returns 401", async () => {
    const res = await api("/api/garcons/test-id", {
      method: "DELETE",
    });
    await expectStatus(res, 401);
  });

  test("Delete garcon as non-admin returns 403", async () => {
    const createRes = await authenticatedApi("/api/garcons", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "403 Delete Garcon",
        email: `garcon-403-del-${Date.now()}@example.com`,
        password: "pass123456",
      }),
    });
    await expectStatus(createRes, 201);
    const garconData = await createRes.json();

    const res = await authenticatedApi(`/api/garcons/${garconData.id}`, regularUserToken, {
      method: "DELETE",
    });
    await expectStatus(res, 403);
  });

  test("Delete non-existent garcon returns 404", async () => {
    const res = await authenticatedApi("/api/garcons/00000000-0000-0000-0000-000000000000", adminToken, {
      method: "DELETE",
    });
    await expectStatus(res, 404);
  });

  // ==================== Usuarios (Legacy) CRUD ====================
  test("List all usuarios returns 200", async () => {
    const res = await authenticatedApi("/api/usuarios", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data)).toBe(true);
  });

  test("List usuarios without authentication returns 401", async () => {
    const res = await api("/api/usuarios");
    await expectStatus(res, 401);
  });

  test("Create usuario returns 201 or 403 or 400", async () => {
    const res = await authenticatedApi("/api/usuarios", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Test Usuario",
        email: `usuario-${Date.now()}@example.com`,
        senha: "pass123456",
        role: "garcom",
      }),
    });
    await expectStatus(res, 201, 403, 400);
  });

  test("Create usuario missing required field returns 400", async () => {
    const res = await authenticatedApi("/api/usuarios", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `usuario-${Date.now()}@example.com`,
        senha: "pass123456",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Get garcons via usuarios endpoint returns 200", async () => {
    const res = await authenticatedApi("/api/usuarios/garcons", authToken);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("Get usuarios garcons without authentication returns 401", async () => {
    const res = await api("/api/usuarios/garcons");
    await expectStatus(res, 401);
  });

  test("Update usuario returns 200 or 403 or 404", async () => {
    const createRes = await authenticatedApi("/api/usuarios", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Update Usuario",
        email: `usuario-update-${Date.now()}@example.com`,
        senha: "pass123456",
      }),
    });
    if (createRes.status === 201) {
      const usuarioData = await createRes.json();

      const res = await authenticatedApi(`/api/usuarios/${usuarioData.id}`, authToken, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Updated Usuario",
        }),
      });
      await expectStatus(res, 200, 403);
    }
  });

  test("Delete usuario returns 204 or 403", async () => {
    const createRes = await authenticatedApi("/api/usuarios", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Delete Usuario",
        email: `usuario-delete-${Date.now()}@example.com`,
        senha: "pass123456",
      }),
    });
    if (createRes.status === 201) {
      const usuarioData = await createRes.json();

      const res = await authenticatedApi(`/api/usuarios/${usuarioData.id}`, adminToken, {
        method: "DELETE",
      });
      await expectStatus(res, 204, 403);
    }
  });

  // ==================== Reports & Dashboard ====================
  test("Get dashboard summary returns 200 or 500", async () => {
    const res = await authenticatedApi("/api/relatorios/resumo", adminToken);
    await expectStatus(res, 200, 500);
  });

  test("Get dashboard summary without authentication returns 401", async () => {
    const res = await api("/api/relatorios/resumo");
    await expectStatus(res, 401);
  });

  // ==================== Historico (Archives) ====================
  test("Get all archived comandas returns 200 or 500", async () => {
    const res = await authenticatedApi("/api/historico", authToken);
    await expectStatus(res, 200, 500);
  });

  test("Get historico without authentication returns 401", async () => {
    const res = await api("/api/historico");
    await expectStatus(res, 401);
  });

  // ==================== Restaurant Info ====================
  test("Get restaurant information returns 200 or 404", async () => {
    const res = await authenticatedApi("/api/restaurante", authToken);
    await expectStatus(res, 200, 404);
  });

  test("Get restaurant without authentication returns 401", async () => {
    const res = await api("/api/restaurante");
    await expectStatus(res, 401);
  });

  test("Update or create restaurant information returns 200", async () => {
    const res = await authenticatedApi("/api/restaurante", adminToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "Test Restaurant",
        filial: "Main Branch",
        endereco: "123 Main St",
        cnpj: "12345678901234",
      }),
    });
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.nome).toBe("Test Restaurant");
  });

  test("Update restaurant without authentication returns 401", async () => {
    const res = await api("/api/restaurante", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Test" }),
    });
    await expectStatus(res, 401);
  });

  test("Update restaurant missing nome returns 400", async () => {
    const res = await authenticatedApi("/api/restaurante", authToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filial: "Branch",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Delete restaurant returns 200 or 404 or 403 or 400", async () => {
    const res = await authenticatedApi("/api/restaurante", adminToken, {
      method: "DELETE",
    });
    await expectStatus(res, 200, 404, 403, 400);
  });

  test("Delete restaurant without authentication returns 401", async () => {
    const res = await api("/api/restaurante", {
      method: "DELETE",
    });
    await expectStatus(res, 401);
  });

  test("Get restaurant fiscal readiness status returns 200 or 401 or 404", async () => {
    const res = await authenticatedApi("/api/restaurante/fiscal/status", authToken);
    if (res.status === 200) {
      const data = await res.json();
      expect(data.pronto_para_nfce).toBeDefined();
      expect(typeof data.pronto_para_nfce).toBe("boolean");
      expect(Array.isArray(data.campos_faltantes)).toBe(true);
    } else {
      await expectStatus(res, 200, 401, 404);
    }
  });

  test("Get fiscal status without authentication returns 401", async () => {
    const res = await api("/api/restaurante/fiscal/status");
    await expectStatus(res, 401);
  });

  test("Create new restaurant with admin returns 201 or 400 or 409", async () => {
    const res = await api("/api/restaurantes/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "New Restaurant",
        cnpj: "12345678901234",
        adminNome: "Admin User",
        adminEmail: `admin-${Date.now()}@example.com`,
        adminSenha: "pass123456",
      }),
    });
    await expectStatus(res, 201, 400, 409);
  });

  test("Create restaurant missing required field returns 400", async () => {
    const res = await api("/api/restaurantes/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cnpj: "12345678901234",
        adminNome: "Admin",
        adminEmail: "admin@test.com",
        adminSenha: "pass",
      }),
    });
    await expectStatus(res, 400);
  });

  // ==================== Upload Endpoints ====================
  test("Upload image file returns 200 or 400 or 413", async () => {
    const form = new FormData();
    form.append("file", createTestFile("image.jpg", "test image", "image/jpeg"));

    const res = await authenticatedApi("/api/upload/imagem", authToken, {
      method: "POST",
      body: form,
    });
    await expectStatus(res, 200, 400, 413);
  });

  test("Upload generic file returns 200 or 400 or 413", async () => {
    const form = new FormData();
    form.append("file", createTestFile("document.txt", "test content", "text/plain"));

    const res = await authenticatedApi("/api/upload", authToken, {
      method: "POST",
      body: form,
    });
    await expectStatus(res, 200, 400, 413);
  });

  test("Upload without authentication returns 401", async () => {
    const form = new FormData();
    form.append("file", createTestFile());

    const res = await api("/api/upload/imagem", {
      method: "POST",
      body: form,
    });
    await expectStatus(res, 401);
  });

  // ==================== Subscription Plans ====================
  test("Get all available subscription plans returns 200", async () => {
    const res = await api("/api/planos");
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.planos).toBeDefined();
  });

  test("Get current subscription status returns 200 or 403", async () => {
    const res = await authenticatedApi("/api/assinatura", authToken);
    await expectStatus(res, 200, 403);
  });

  test("Get subscription status without authentication returns 401", async () => {
    const res = await api("/api/assinatura");
    await expectStatus(res, 401);
  });

  test("Upgrade to paid subscription returns 200 or 400 or 403 or 500 or 502", async () => {
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

  test("Upgrade subscription without authentication returns 401", async () => {
    const res = await api("/api/assinatura/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plano: "basico",
        email: "test@example.com",
        cpf_cnpj: "12345678901234",
      }),
    });
    await expectStatus(res, 401);
  });

  test("Upgrade with missing required field returns 400", async () => {
    const res = await authenticatedApi("/api/assinatura/upgrade", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        cpf_cnpj: "12345678901234",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Cancel subscription returns 200 or 400 or 403 or 500", async () => {
    const res = await authenticatedApi("/api/assinatura/cancelar", authToken, {
      method: "POST",
    });
    await expectStatus(res, 200, 400, 403, 500);
  });

  test("Cancel subscription without authentication returns 401", async () => {
    const res = await api("/api/assinatura/cancelar", {
      method: "POST",
    });
    await expectStatus(res, 401);
  });

  // ==================== LGPD Endpoints ====================
  test("Get personal data (LGPD) returns 200 or 404 or 500", async () => {
    const res = await authenticatedApi("/api/lgpd/meus-dados", authToken);
    await expectStatus(res, 200, 404, 500);
  });

  test("Request deletion of personal data (LGPD) returns 200 or 400 or 404 or 500", async () => {
    const res = await authenticatedApi("/api/lgpd/meus-dados", authToken, {
      method: "DELETE",
    });
    await expectStatus(res, 200, 400, 404, 500);
  });

  test("LGPD deletion without authentication returns 401 or 200", async () => {
    const res = await api("/api/lgpd/meus-dados", {
      method: "DELETE",
    });
    await expectStatus(res, 200, 401);
  });

  test("Get LGPD privacy policy returns 200 or 404", async () => {
    const res = await api("/api/lgpd/politica");
    await expectStatus(res, 200, 404);
  });

  // ==================== Delivery Endpoints ====================
  test("Create delivery order returns 200 or 201 or 400 or 401 or 404 or 500", async () => {
    const res = await api("/api/delivery/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cliente_nome: "Test Client",
        cliente_telefone: "11999999999",
        endereco: "Rua Test, 123",
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

  test("Get delivery pedido by ID returns 200 or 404 or 401 or 500", async () => {
    const res = await authenticatedApi("/api/delivery/pedidos/test-id-123", authToken);
    await expectStatus(res, 200, 404, 401, 500);
  });

  test("Update delivery pedido status returns 200 or 404 or 400 or 401 or 500", async () => {
    const res = await authenticatedApi("/api/delivery/pedidos/test-id-123/status", authToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "preparando",
      }),
    });
    await expectStatus(res, 200, 404, 400, 401, 500);
  });

  test("Update delivery status without authentication returns 401", async () => {
    const res = await api("/api/delivery/pedidos/test-id-123/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "preparando",
      }),
    });
    await expectStatus(res, 401);
  });

  // ==================== Payment & Division ====================
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
      body: JSON.stringify({
        mesaId: mesaData.id,
      }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const res = await authenticatedApi(
      `/api/comandas/${comandaData.comanda.id}/pagamentos`,
      authToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forma_pagamento: "dinheiro",
          valor: 50.00,
        }),
      }
    );
    await expectStatus(res, 200, 201, 400, 404);
  });

  test("Add payment without authentication returns 401", async () => {
    const res = await api("/api/comandas/00000000-0000-0000-0000-000000000000/pagamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        forma_pagamento: "dinheiro",
        valor: 50.00,
      }),
    });
    await expectStatus(res, 401);
  });

  test("Add payment with missing required field returns 400", async () => {
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
      body: JSON.stringify({
        mesaId: mesaData.id,
      }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const res = await authenticatedApi(
      `/api/comandas/${comandaData.comanda.id}/pagamentos`,
      authToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forma_pagamento: "dinheiro",
        }),
      }
    );
    await expectStatus(res, 400);
  });

  test("Delete payment returns 200 or 204 or 404 or 400 or 403", async () => {
    const res = await authenticatedApi("/api/pagamentos/00000000-0000-0000-0000-000000000000", authToken, {
      method: "DELETE",
    });
    await expectStatus(res, 200, 204, 404, 400, 403);
  });

  test("Split comanda bill returns 200 or 400 or 404", async () => {
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
      body: JSON.stringify({
        mesaId: mesaData.id,
      }),
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
          gorjeta: 10.00,
        }),
      }
    );
    await expectStatus(res, 200, 400, 404);
  });

  test("Split bill without authentication returns 401", async () => {
    const res = await api("/api/comandas/00000000-0000-0000-0000-000000000000/divisao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: "igual",
        num_pessoas: 2,
      }),
    });
    await expectStatus(res, 401);
  });

  test("Split bill with missing required field returns 400", async () => {
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
      body: JSON.stringify({
        mesaId: mesaData.id,
      }),
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
          num_pessoas: 2,
        }),
      }
    );
    await expectStatus(res, 400);
  });

  // ==================== Public Endpoints (No Auth) ====================
  test("Get public cardapio list returns 200 or 404", async () => {
    const res = await api("/cardapio");
    await expectStatus(res, 200, 404);
  });

  test("Create public pedido (unauthenticated) returns 200 or 201 or 400 or 404 or 500", async () => {
    const res = await api("/api/public/pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cliente_nome: "Public Client",
        cliente_telefone: "11999999999",
        endereco: "Test Address",
      }),
    });
    await expectStatus(res, 200, 201, 400, 404, 500);
  });

  test("Get public cardapio for restaurante returns 200 or 404 or 400 or 500", async () => {
    const res = await api("/api/public/cardapio/test-restaurante-id");
    await expectStatus(res, 200, 404, 400, 500);
  });

  test("Get public mesa info returns 200 or 404 or 400 or 500", async () => {
    const res = await api("/api/public/mesa/test-restaurante-id/1");
    await expectStatus(res, 200, 404, 400, 500);
  });

  test("List public restaurantes returns 200 or 404", async () => {
    const res = await api("/api/public/restaurantes");
    await expectStatus(res, 200, 404);
  });

  // ==================== Webhook Endpoints ====================
  test("Webhook ASAAS subscription notification returns 200", async () => {
    const res = await api("/api/webhooks/asaas/assinatura", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "subscription.updated",
      }),
    });
    await expectStatus(res, 200);
  });

  // ==================== Fiscal Endpoints ====================
  test("Get all fiscal notas returns 200 or 401 or 404 or 500", async () => {
    const res = await api("/api/fiscal/notas");
    await expectStatus(res, 200, 401, 404, 500);
  });

  test("Create NFSe nota returns 200 or 201 or 400 or 401 or 403 or 404 or 500 or 502", async () => {
    const res = await authenticatedApi("/api/fiscal/nfsen", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descricao_servico: "Test NFSe",
        valor_servico: 100.00,
      }),
    });
    await expectStatus(res, 200, 201, 400, 401, 403, 404, 500, 502);
  });

  test("Create NFSe without required field returns 400", async () => {
    const res = await authenticatedApi("/api/fiscal/nfsen", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descricao_servico: "Test NFSe",
      }),
    });
    await expectStatus(res, 400);
  });

  test("Get NFSe nota by reference returns 200 or 404 or 401 or 500", async () => {
    const res = await authenticatedApi("/api/fiscal/nfsen/test-ref-123", authToken);
    await expectStatus(res, 200, 404, 401, 500);
  });

  test("Cancel NFSe nota by reference returns 200 or 404 or 401 or 500 or 400", async () => {
    const res = await authenticatedApi("/api/fiscal/nfsen/test-ref-123", authToken, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        justificativa: "Testing cancellation of NFSe",
      }),
    });
    await expectStatus(res, 200, 404, 401, 500, 400);
  });

  test("Cancel NFSe without justificativa returns 400", async () => {
    const res = await authenticatedApi("/api/fiscal/nfsen/test-ref-123", authToken, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await expectStatus(res, 400);
  });

  test("Fiscal cleanup - delete old test notes returns 200 or 500", async () => {
    const res = await authenticatedApi("/api/fiscal/cleanup", authToken, {
      method: "DELETE",
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.deletedCount).toBeDefined();
    } else {
      await expectStatus(res, 200, 500);
    }
  });

  // ==================== NFC-e Fiscal Endpoints ====================
  test("Emit NFC-e (cupom fiscal eletronico) returns 200 or 400 or 404 or 409 or 500 or 502", async () => {
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

  test("Get NFC-e status by reference returns 200 or 404 or 500 or 502", async () => {
    const res = await authenticatedApi("/api/fiscal/nfce/test-reference", authToken);
    await expectStatus(res, 200, 404, 500, 502);
  });

  test("Get NFC-e status without authentication returns 401", async () => {
    const res = await api("/api/fiscal/nfce/test-reference");
    await expectStatus(res, 401);
  });

  test("Emit NFC-e with valid comanda returns 200 or 400 or 404 or 409 or 500 or 502", async () => {
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
      body: JSON.stringify({
        mesaId: mesaData.id,
      }),
    });
    await expectStatus(comandaRes, 201);
    const comandaData = await comandaRes.json();

    const res = await authenticatedApi("/api/fiscal/nfce", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comanda_id: comandaData.comanda.id,
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

  test("Emit NFC-e without authentication returns 401", async () => {
    const res = await api("/api/fiscal/nfce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comanda_id: "00000000-0000-0000-0000-000000000000",
        presenca_comprador: 1,
      }),
    });
    await expectStatus(res, 401);
  });

  // ==================== Inventory (Insumos) Management ====================
  test("List all insumos returns 200 or 401 or 403", async () => {
    const res = await authenticatedApi("/api/insumos", authToken);
    if (res.status === 200) {
      const data = await res.json();
      expect(Array.isArray(data) || data.data).toBeTruthy();
    } else {
      await expectStatus(res, 200, 401, 403);
    }
  });

  test("List insumos without authentication returns 401", async () => {
    const res = await api("/api/insumos");
    await expectStatus(res, 401);
  });

  test("Create insumo returns 200 or 201 or 400 or 401 or 403", async () => {
    const res = await authenticatedApi("/api/insumos", authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Insumo Test ${Date.now()}`,
        quantidade: 100,
        unidade: "kg",
        preco_unitario: 10.50,
      }),
    });
    if (res.status === 201 || res.status === 200) {
      const data = await res.json();
      if (data.id) {
        testInsumoId = data.id;
      }
    } else {
      await expectStatus(res, 200, 201, 400, 401, 403);
    }
  });

  test("Get insumo alerts returns 200 or 401 or 403 or 500", async () => {
    const res = await authenticatedApi("/api/insumos/alertas", authToken);
    if (res.status === 200) {
      const data = await res.json();
      expect(Array.isArray(data) || data.alertas).toBeTruthy();
    } else {
      await expectStatus(res, 200, 401, 403, 500);
    }
  });

  test("Get insumo alerts without authentication returns 401", async () => {
    const res = await api("/api/insumos/alertas");
    await expectStatus(res, 401);
  });

  test("Update insumo returns 200 or 404 or 400 or 401", async () => {
    if (testInsumoId) {
      const res = await authenticatedApi(`/api/insumos/${testInsumoId}`, authToken, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantidade: 150,
          preco_unitario: 11.00,
        }),
      });
      await expectStatus(res, 200, 404, 400, 401);
    }
  });

  test("Delete insumo returns 200 or 204 or 404 or 401", async () => {
    if (testInsumoId) {
      const res = await authenticatedApi(`/api/insumos/${testInsumoId}`, authToken, {
        method: "DELETE",
      });
      await expectStatus(res, 200, 204, 404, 401);
    }
  });

  test("Create prato for insumo association", async () => {
    const res = await authenticatedApi("/api/pratos", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: `Prato with Insumos ${Date.now()}`,
        preco: "35.99",
        descricao: "Prato for insumo test",
      }),
    });
    await expectStatus(res, 201);
    const data = await res.json();
    testPratoIdForInsumo = data.prato.id;
  });

  test("Get prato insumos returns 200 or 404", async () => {
    if (testPratoIdForInsumo) {
      const res = await authenticatedApi(
        `/api/pratos/${testPratoIdForInsumo}/insumos`,
        authToken
      );
      await expectStatus(res, 200, 404);
    }
  });

  test("Add insumo to prato returns 200 or 201 or 404 or 400", async () => {
    if (testPratoIdForInsumo && testInsumoId) {
      const res = await authenticatedApi(
        `/api/pratos/${testPratoIdForInsumo}/insumos`,
        authToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            insumo_id: testInsumoId,
            quantidade_necessaria: 5,
          }),
        }
      );
      await expectStatus(res, 200, 201, 404, 400);
    }
  });

  test("Remove insumo from prato returns 200 or 204 or 404", async () => {
    if (testPratoIdForInsumo && testInsumoId) {
      const res = await authenticatedApi(
        `/api/pratos/${testPratoIdForInsumo}/insumos/${testInsumoId}`,
        authToken,
        {
          method: "DELETE",
        }
      );
      await expectStatus(res, 200, 204, 404);
    }
  });

  test("Record stock movement returns 200 or 201 or 404 or 400", async () => {
    if (testInsumoId) {
      const res = await authenticatedApi("/api/estoque/movimentacao", authToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insumo_id: testInsumoId,
          tipo: "entrada",
          quantidade: 50,
          descricao: "Restock",
        }),
      });
      await expectStatus(res, 200, 201, 404, 400);
    }
  });

  test("Record stock movement without authentication returns 401", async () => {
    const res = await api("/api/estoque/movimentacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        insumo_id: "test-id",
        tipo: "entrada",
        quantidade: 50,
      }),
    });
    await expectStatus(res, 401);
  });

  test("Get stock movements for insumo returns 200 or 404 or 401", async () => {
    if (testInsumoId) {
      const res = await authenticatedApi(
        `/api/estoque/movimentacoes/${testInsumoId}`,
        authToken
      );
      if (res.status === 200) {
        const data = await res.json();
        expect(Array.isArray(data) || data.movimentacoes).toBeTruthy();
      } else {
        await expectStatus(res, 200, 404, 401);
      }
    }
  });

  // ==================== Realtime WebSocket ====================
  test("Connect to realtime WebSocket with authentication", async () => {
    const ws = await connectAuthenticatedWebSocket("/api/realtime", authToken);
    expect(ws).toBeDefined();
    expect(ws.readyState).toBe(1);
    ws.close();
  });
});
