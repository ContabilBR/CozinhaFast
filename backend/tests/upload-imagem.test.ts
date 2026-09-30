import { describe, test, expect } from "bun:test";
import {
  api,
  authenticatedApi,
  signUpTestUser,
  expectStatus,
  createTestFile,
  createTestImage,
  PNG_1X1_DATA_URI,
} from "./helpers";

// ---------------------------------------------------------------------------
// Testes de imagem de prato e do cardápio público.
//
// Regras testadas:
// - a foto do prato só aceita JPEG, PNG e WebP, pelo conteúdo do arquivo (não pelo
//   Content-Type declarado); SVG, HTML e texto são rejeitados;
// - imagem_url (criar e editar prato) só aceita https:// e rejeita javascript:, data:,
//   http:// e aspas;
// - o reenvio do imagem_url já salvo na edição continua funcionando (o app faz isso);
// - a página /cardapio não deixa r e m (parâmetros da URL) virarem JavaScript.
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "Content-Type": "application/json" };

async function criarPrato(adminToken: string, extra: Record<string, unknown> = {}): Promise<Response> {
  return authenticatedApi("/api/pratos", adminToken, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ nome: `Prato imagem ${Date.now()}-${Math.floor(Math.random() * 1000)}`, preco: "10.00", ...extra }),
  });
}

async function enviarFoto(adminToken: string, pratoId: string, file: File): Promise<Response> {
  const form = new FormData();
  form.append("file", file);
  return authenticatedApi(`/api/pratos/${pratoId}/foto`, adminToken, { method: "POST", body: form });
}

describe("Imagem de prato e cardápio público", () => {
  let adminToken: string;
  let pratoId: string;

  test("Sign up admin and create prato", async () => {
    const { token } = await signUpTestUser("administrador");
    adminToken = token;
    const res = await criarPrato(adminToken);
    await expectStatus(res, 201);
    pratoId = ((await res.json()) as any).prato.id;
    expect(pratoId).toBeDefined();
  });

  // ---------- foto do prato ----------
  test("Foto PNG real é aceita", async () => {
    const res = await enviarFoto(adminToken, pratoId, createTestImage("prato.png"));
    await expectStatus(res, 200);
    const data = (await res.json()) as any;
    expect(data.url || data.imagem_url).toBeDefined();
  });

  test("Foto PNG real é aceita mesmo com Content-Type declarado errado", async () => {
    const png = createTestImage("prato.png");
    const res = await enviarFoto(adminToken, pratoId, new File([png], "prato.bin", { type: "application/octet-stream" }));
    await expectStatus(res, 200);
  });

  test("Texto declarado como image/jpeg é rejeitado com 400", async () => {
    const res = await enviarFoto(adminToken, pratoId, createTestFile("falso.jpg", "isso nao e uma imagem", "image/jpeg"));
    await expectStatus(res, 400);
  });

  test("SVG com script é rejeitado com 400", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const res = await enviarFoto(adminToken, pratoId, createTestFile("x.svg", svg, "image/svg+xml"));
    await expectStatus(res, 400);
  });

  test("HTML declarado como imagem é rejeitado com 400", async () => {
    const res = await enviarFoto(adminToken, pratoId, createTestFile("x.png", "<html><script>alert(1)</script></html>", "image/png"));
    await expectStatus(res, 400);
  });

  test("Foto maior que 5 MB é rejeitada com 413", async () => {
    const grande = new Uint8Array(5 * 1024 * 1024 + 1024);
    grande.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await enviarFoto(adminToken, pratoId, new File([grande], "grande.png", { type: "image/png" }));
    await expectStatus(res, 413);
  });

  test("Foto em base64 (JSON) de PNG real é aceita", async () => {
    const res = await authenticatedApi(`/api/pratos/${pratoId}/foto`, adminToken, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ imagem_base64: PNG_1X1_DATA_URI }),
    });
    await expectStatus(res, 200);
  });

  test("Foto em base64 (JSON) que não é imagem é rejeitada com 400", async () => {
    const res = await authenticatedApi(`/api/pratos/${pratoId}/foto`, adminToken, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ imagem_base64: "data:image/png;base64," + Buffer.from("texto qualquer").toString("base64") }),
    });
    await expectStatus(res, 400);
  });

  // ---------- imagem_url ao criar ----------
  test("Criar prato com imagem_url https é aceito", async () => {
    const res = await criarPrato(adminToken, { imagem_url: "https://exemplo.com/foto.jpg?x=1&y=2" });
    await expectStatus(res, 201);
    const prato = ((await res.json()) as any).prato;
    expect(prato.imagemUrl || prato.imagem_url).toBe("https://exemplo.com/foto.jpg?x=1&y=2");
  });

  for (const [rotulo, valor] of [
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/png;base64,AAAA"],
    ["http://", "http://exemplo.com/foto.jpg"],
    ["aspas", 'https://exemplo.com/a.jpg" onerror="alert(1)'],
    ["espaço", "https://exemplo.com/a b.jpg"],
    ["texto solto", "foto.jpg"],
  ] as const) {
    test(`Criar prato com imagem_url ${rotulo} é rejeitado com 400`, async () => {
      const res = await criarPrato(adminToken, { imagem_url: valor });
      await expectStatus(res, 400);
    });
  }

  // ---------- imagem_url ao editar ----------
  test("Editar prato com imagem_url inválida é rejeitado com 400", async () => {
    const res = await authenticatedApi(`/api/pratos/${pratoId}`, adminToken, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ imagem_url: 'javascript:alert(1)' }),
    });
    await expectStatus(res, 400);
  });

  test("Editar prato reenviando o imagem_url já salvo continua funcionando", async () => {
    const criar = await criarPrato(adminToken, { imagem_url: "https://exemplo.com/foto-atual.jpg" });
    await expectStatus(criar, 201);
    const id = ((await criar.json()) as any).prato.id;
    const res = await authenticatedApi(`/api/pratos/${id}`, adminToken, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ nome: "Prato renomeado", imagem_url: "https://exemplo.com/foto-atual.jpg" }),
    });
    await expectStatus(res, 200);
  });

  // ---------- página do cardápio público ----------
  test("/cardapio ignora r que não é UUID (sem injeção de script)", async () => {
    const res = await api('/cardapio?r=' + encodeURIComponent('";alert(1);//') + '&m=1');
    await expectStatus(res, 200);
    const html = await res.text();
    expect(html).not.toContain("alert(1)");
    expect(html).toContain('var R="",');
  });

  test("/cardapio ignora m que não é número (sem injeção de script)", async () => {
    const res = await api("/cardapio?r=00000000-0000-0000-0000-000000000000&m=" + encodeURIComponent("1;alert(1)"));
    await expectStatus(res, 200);
    const html = await res.text();
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("M=0,");
  });

  test("/cardapio com r UUID e m numérico mantém os valores", async () => {
    const res = await api("/cardapio?r=00000000-0000-0000-0000-000000000000&m=12");
    await expectStatus(res, 200);
    const html = await res.text();
    expect(html).toContain('var R="00000000-0000-0000-0000-000000000000",M=12,');
  });
});
