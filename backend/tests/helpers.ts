import { afterAll } from "bun:test";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3001";

/**
 * Strip Content-Type: application/json when there's no body.
 */
function sanitizeOptions(options?: RequestInit): RequestInit | undefined {
  if (!options?.headers || options.body) return options;
  const headers = new Headers(options.headers);
  if (headers.get("content-type")?.includes("application/json")) {
    headers.delete("content-type");
  }
  const entries = [...headers.entries()];
  return {
    ...options,
    headers: entries.length > 0 ? Object.fromEntries(entries) : undefined,
  };
}

/**
 * Make a request to the API under test.
 */
export async function api(
  path: string,
  options?: RequestInit
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, sanitizeOptions(options));
}

/**
 * Make an authenticated request to the API under test.
 */
export async function authenticatedApi(
  path: string,
  token: string,
  options?: RequestInit
): Promise<Response> {
  const sanitized = sanitizeOptions(options);
  return fetch(`${BASE_URL}${path}`, {
    ...sanitized,
    headers: {
      ...sanitized?.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

export interface TestUser {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

/**
 * Create a test user via Better Auth sign-up with optional role.
 * Returns the Better Auth token which works with all authenticated endpoints.
 */
export async function signUpTestUser(role: string = "garcom"): Promise<TestUser> {
  const id = crypto.randomUUID();
  const email = `testuser+${id}@example.com`;
  const password = "TestPassword123!";
  const name = "Test User";

  // Sign up via Better Auth with optional role
  const signUpRes = await api("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, role }),
  });

  if (!signUpRes.ok) {
    const body = await signUpRes.text();
    throw new Error(`Failed to sign up test user (${signUpRes.status}): ${body}`);
  }

  const signUpData = await signUpRes.json() as any;

  // Better Auth returns { token, user }
  const token = signUpData.token;
  const user = signUpData.user;

  if (!token) {
    throw new Error(`Failed to extract token from sign-up response: ${JSON.stringify(signUpData)}`);
  }

  const testUser: TestUser = {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || role,
    },
  };

  // Auto-register cleanup so the test file doesn't need to
  afterAll(async () => {
    await deleteTestUser(testUser.user.id, token);
  });

  return testUser;
}

/**
 * Assert response status and include response body in error on mismatch.
 * Use instead of expect(res.status).toBe(x) for better error messages.
 */
export async function expectStatus(res: Response, ...expected: number[]): Promise<void> {
  if (!expected.includes(res.status)) {
    let body = "(unable to read body)";
    try {
      if (typeof res.clone === "function") {
        body = await res.clone().text();
      } else if (typeof res.text === "function") {
        body = await res.text();
      }
    } catch (e) {
      // body stays as "(unable to read body)"
    }
    if (body.length > 500) body = body.slice(0, 500) + "...";
    let path = "(unknown path)";
    try {
      if (res.url) {
        const url = new URL(res.url);
        path = url.pathname + url.search;
      }
    } catch (e) {
      // path stays as "(unknown path)"
    }
    console.error(`${path} — Expected ${expected.join("|")}, got ${res.status} — ${body}`);
    throw ``;
  }
}

// ---------------------------------------------------------------------------
// Test data cleanup
// ---------------------------------------------------------------------------
// These suites hit the real API (TEST_BASE_URL defaults to the local dev
// backend, which uses the same DATABASE_URL as everything else — there is no
// separate test database yet). Several tests intentionally leave data behind
// on purpose (e.g. a permission check that expects DELETE to fail with 403),
// so per-test cleanup isn't enough. Instead:
//   - garcom/administrador test users are deleted individually via the
//     afterAll registered in signUpTestUser above (deleteTestUser now
//     actually deletes instead of no-op'ing).
//   - mesas/pratos/categorias are swept up in bulk by cleanupTestData(),
//     which each test file registers once via `afterAll(cleanupTestData)`.
//
// Detection is name/number based rather than ID-tracking, since tests don't
// consistently expose the IDs they create. Patterns are deliberately narrow
// so this can never touch real restaurant data:
//   - mesas: numero >= 100000 (every test mesa uses this range via
//     `Math.floor(Math.random() * 900000) + 100000`; no real restaurant has
//     100k+ tables)
//   - pratos/categorias: an exact match against known static test names, or
//     a name ending in a 13-digit millisecond timestamp (the `${Date.now()}`
//     suffix pattern used throughout these files)
// If a new static (non-timestamped) prato/categoria name is added to a test,
// add it to KNOWN_TEST_NAMES below or it will leak like the others did.

const KNOWN_TEST_NAMES = new Set([
  "To Delete",
  "Test",
  "Test Prato",
  "Prato for 403",
  "Prato for 413",
  "Prato with Photo",
  "Unauthorized Prato",
  "Unauthorized Category",
  "Updated Prato",
  "Updated Category",
]);

const TIMESTAMP_SUFFIX = /\d{13}$/;

function isTestGeneratedName(nome: string | undefined | null): boolean {
  if (!nome) return false;
  return KNOWN_TEST_NAMES.has(nome) || TIMESTAMP_SUFFIX.test(nome);
}

let cleanupAdminToken: string | null = null;

/**
 * Lazily create (once) and cache an administrador session used only to run
 * cleanup requests. Reuses the same real sign-up endpoint the tests use, so
 * it requires ALLOW_TEST_SIGNUP=true just like everything else here.
 */
async function getCleanupAdminToken(): Promise<string | null> {
  if (cleanupAdminToken) return cleanupAdminToken;
  try {
    const id = crypto.randomUUID();
    const res = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Cleanup Admin",
        email: `testcleanup+${id}@example.com`,
        password: "TestPassword123!",
        role: "administrador",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    cleanupAdminToken = data.token ?? null;
    return cleanupAdminToken;
  } catch {
    return null;
  }
}

/**
 * Delete a test user (and, via cascading FKs, its account/session/profile
 * rows) through the real DELETE /api/garcons/:id endpoint. That endpoint
 * requires an admin/gerente caller, so this uses a dedicated cleanup admin
 * rather than the test user's own token.
 */
export async function deleteTestUser(userId: string, _token?: string): Promise<void> {
  try {
    const adminToken = await getCleanupAdminToken();
    if (!adminToken) return;
    await authenticatedApi(`/api/garcons/${userId}`, adminToken, { method: "DELETE" });
  } catch {
    // Best-effort cleanup — never fail a test run because cleanup failed.
  }
}

/**
 * Sweep and remove mesas/pratos/categorias left behind by a test file.
 * Each test file should call `afterAll(cleanupTestData)` once at the top
 * level — not per test.
 */
export async function cleanupTestData(): Promise<void> {
  const adminToken = await getCleanupAdminToken();
  if (!adminToken) return;

  try {
    const res = await authenticatedApi("/api/mesas", adminToken);
    if (res.ok) {
      const mesas = (await res.json()) as any[];
      for (const mesa of mesas) {
        if (typeof mesa.numero === "number" && mesa.numero >= 100000) {
          try {
            await authenticatedApi(`/api/mesas/${mesa.id}/force`, adminToken, { method: "DELETE" });
          } catch {
            // best-effort
          }
        }
      }
    }
  } catch {
    // best-effort
  }

  // Pratos before categorias, so a prato never blocks its categoria's delete.
  try {
    const res = await authenticatedApi("/api/pratos", adminToken);
    if (res.ok) {
      const pratos = (await res.json()) as any[];
      for (const prato of pratos) {
        if (isTestGeneratedName(prato.nome)) {
          try {
            await authenticatedApi(`/api/pratos/${prato.id}`, adminToken, { method: "DELETE" });
          } catch {
            // best-effort
          }
        }
      }
    }
  } catch {
    // best-effort
  }

  try {
    const res = await authenticatedApi("/api/categorias", adminToken);
    if (res.ok) {
      const categorias = (await res.json()) as any[];
      for (const categoria of categorias) {
        if (isTestGeneratedName(categoria.nome)) {
          try {
            await authenticatedApi(`/api/categorias/${categoria.id}`, adminToken, { method: "DELETE" });
          } catch {
            // best-effort
          }
        }
      }
    }
  } catch {
    // best-effort
  }
}

/**
 * Create a dummy file for multipart upload testing.
 * Returns a File object that can be appended to FormData.
 */
export function createTestFile(filename = "test.txt", content = "test file content", type = "text/plain"): File {
  return new File([content], filename, { type });
}

const WS_URL = BASE_URL.replace(/^http/, "ws");

/**
 * Connect to a WebSocket endpoint. Resolves when the connection is open.
 */
export async function connectWebSocket(path: string): Promise<WebSocket> {
  const url = new URL(path, WS_URL);
  const ws = new WebSocket(url.toString());
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`WebSocket connection failed: ${url}`));
    setTimeout(() => { ws.close(); reject(new Error("WebSocket connection timeout")); }, 5000);
  });
}

/**
 * Connect to an authenticated WebSocket endpoint.
 * Sends the token as the first message and waits for the authentication response.
 */
export async function connectAuthenticatedWebSocket(path: string, token: string): Promise<WebSocket> {
  const ws = await connectWebSocket(path);
  ws.send(JSON.stringify({ token }));
  const response = await waitForMessage(ws);
  const data = JSON.parse(response);
  if (data.error) {
    ws.close();
    throw new Error(`WebSocket auth failed: ${data.error}`);
  }
  return ws;
}

/**
 * Wait for the next message on a WebSocket.
 */
export function waitForMessage(ws: WebSocket, timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.onmessage = (event) => resolve(String(event.data));
    setTimeout(() => reject(new Error("WebSocket message timeout")), timeout);
  });
}
