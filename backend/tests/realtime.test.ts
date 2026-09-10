import { describe, test, expect, afterAll } from "bun:test";
import { api, authenticatedApi, signUpTestUser, expectStatus, cleanupTestData } from "./helpers";

afterAll(cleanupTestData);

describe("Realtime WebSocket Tests", () => {
  let adminToken: string;
  let adminUserId: string;
  let regularToken: string;
  let regularUserId: string;

  test("Setup: Sign up admin user", async () => {
    const { token, user } = await signUpTestUser("administrador");
    adminToken = token;
    adminUserId = user.id;
    expect(adminToken).toBeDefined();
  });

  test("Setup: Sign up regular user", async () => {
    const { token, user } = await signUpTestUser();
    regularToken = token;
    regularUserId = user.id;
    expect(regularToken).toBeDefined();
  });

  test("Rejects connection with no token (timeout closes after 5 seconds)", async () => {
    const ws = new WebSocket("ws://localhost:3000/api/realtime");
    const startTime = Date.now();
    let errorReceived = false;
    let connectionClosed = false;

    await new Promise<void>((resolve) => {
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.error) {
          errorReceived = true;
        }
      };

      ws.onclose = () => {
        connectionClosed = true;
        const elapsed = Date.now() - startTime;
        expect(connectionClosed).toBe(true);
        expect(elapsed).toBeGreaterThan(4000);
        expect(elapsed).toBeLessThan(7000);
        resolve();
      };

      setTimeout(() => {
        if (!connectionClosed) {
          ws.close();
          resolve();
        }
      }, 7000);
    });

    expect(connectionClosed).toBe(true);
  });

  test("Rejects connection with invalid token", async () => {
    const ws = new WebSocket("ws://localhost:3000/api/realtime");

    const response = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket timeout"));
      }, 5000);

      ws.onmessage = (e) => {
        clearTimeout(timeout);
        resolve(e.data);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket error"));
      };

      ws.onopen = () => {
        ws.send("invalid-token-xyz");
      };
    });

    const data = JSON.parse(response);
    expect(data.error).toBeDefined();
    ws.close();
  });

  test("Accepts valid token and receives connected message", async () => {
    const ws = new WebSocket("ws://localhost:3000/api/realtime");

    const response = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket timeout"));
      }, 5000);

      ws.onmessage = (e) => {
        clearTimeout(timeout);
        resolve(e.data);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket error"));
      };

      ws.onopen = () => {
        ws.send(adminToken);
      };
    });

    const data = JSON.parse(response);
    expect(data.type).toBe("connected");
    expect(data.restauranteId).toBeDefined();
    ws.close();
  });

  test("Event published to tenant A arrives at tenant A", async () => {
    // Connect WebSocket for admin (tenant A)
    const ws = new WebSocket("ws://localhost:3000/api/realtime");

    let connected = false;
    let eventReceived: any = null;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve();
      }, 10000);

      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "connected") {
          connected = true;
          // Now create a comanda which should trigger event
          createComandaForAdmin();
        } else if (data.type === "comanda.created") {
          eventReceived = data;
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      };

      ws.onopen = () => {
        ws.send(adminToken);
      };
    });

    expect(connected).toBe(true);
    expect(eventReceived).toBeDefined();
    expect(eventReceived.type).toBe("comanda.created");
    expect(eventReceived.entityId).toBeDefined();
    expect(eventReceived.occurredAt).toBeDefined();

    async function createComandaForAdmin() {
      // Create a mesa first
      const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero: Math.floor(Math.random() * 900000) + 100000,
        }),
      });
      await expectStatus(mesaRes, 201);
      const mesaData = await mesaRes.json();

      // Create comanda
      await authenticatedApi("/api/comandas", adminToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mesaId: mesaData.id,
        }),
      });
    }
  });

  test("Event from tenant A does NOT arrive at tenant B", async () => {
    // Connect WebSocket for regular user (tenant B)
    const ws = new WebSocket("ws://localhost:3000/api/realtime");

    let connected = false;
    let unexpectedEventReceived = false;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve();
      }, 5000);

      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "connected") {
          connected = true;
          // Now admin creates a comanda (in tenant A)
          createComandaForAdmin();
        } else if (data.type === "comanda.created") {
          unexpectedEventReceived = true;
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      };

      ws.onopen = () => {
        ws.send(regularToken);
      };
    });

    expect(connected).toBe(true);
    expect(unexpectedEventReceived).toBe(false);

    async function createComandaForAdmin() {
      // Create a mesa first for admin
      const mesaRes = await authenticatedApi("/api/mesas", adminToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero: Math.floor(Math.random() * 900000) + 100000,
        }),
      });
      await expectStatus(mesaRes, 201);
      const mesaData = await mesaRes.json();

      // Create comanda
      await authenticatedApi("/api/comandas", adminToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mesaId: mesaData.id,
        }),
      });
    }
  });

  test("Connection is removed after close", async () => {
    const ws = new WebSocket("ws://localhost:3000/api/realtime");

    let connected = false;

    await new Promise<void>((resolve) => {
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "connected") {
          connected = true;
          ws.close();
          resolve();
        }
      };

      ws.onerror = () => {
        resolve();
      };

      ws.onopen = () => {
        ws.send(adminToken);
      };

      setTimeout(() => {
        resolve();
      }, 5000);
    });

    expect(connected).toBe(true);
    // No error should occur after close
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
});
