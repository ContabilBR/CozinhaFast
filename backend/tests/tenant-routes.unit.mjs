import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

// Run with Node.js 24+: node tests/tenant-routes.unit.mjs
// Authorization regression harness: runs the actual route handlers with simulated auth/DB.
// Does not execute Fastify schemas/serialization, PostgreSQL SQL or production authentication.
// Run tenant-routes-isolation.test.ts against an isolated backend for HTTP/database coverage.
const routeFiles = ["orders", "order-items", "garcons", "usuarios", "estoque"];
const sources = { after: Object.fromEntries(routeFiles.map(name => [
  name, readFileSync(new URL("../src/routes/" + name + ".ts", import.meta.url), "utf8"),
])) };
const tables = new Map();
const table = (name) => {
  if (!tables.has(name)) tables.set(name, new Proxy({ _table: name }, {
    get(target, key) { return key in target ? target[key] : { table: name, column: key }; },
  }));
  return tables.get(name);
};
const schema = new Proxy({}, { get: (_, name) => table(name) });
const eq = (a, b) => ({ op: "eq", a, b });
const and = (...args) => ({ op: "and", args: args.filter(Boolean) });
const or = (...args) => ({ op: "or", args: args.filter(Boolean) });
const inArray = (a, b) => ({ op: "in", a, b });
const sql = (strings, ...values) => ({ op: "sql", text: strings.join("?"), values });
const id = (n) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
const R = { A: id(100), B: id(200) };
const ids = { A: { mesa: id(1), prato: id(2), comanda: id(3), pedido: id(4), garcom: id(5), usuario: id(6), insumo: id(7), vinculo: id(8), admin: id(9) },
              B: { mesa: id(11), prato: id(12), comanda: id(13), pedido: id(14), garcom: id(15), usuario: id(16), insumo: id(17), vinculo: id(18), admin: id(19) } };
function fixtures() {
  const data = Object.fromEntries(["mesas", "pratos", "comandas", "pedidos", "user", "profiles", "account",
    "usuarios", "usuariosSession", "insumos", "pratoInsumos", "comandasHistorico", "pedidosHistorico"].map(k => [k, []]));
  for (const k of ["A", "B"]) {
    const x = ids[k], restauranteId = R[k], date = new Date("2026-09-29T12:00:00Z");
    data.mesas.push({ id: x.mesa, restauranteId, numero: k === "A" ? 1 : 2, status: "ocupada" });
    data.pratos.push({ id: x.prato, restauranteId, nome: "Prato " + k, preco: "10.00" });
    data.comandas.push({ id: x.comanda, restauranteId, mesaId: x.mesa, mesaNumero: k === "A" ? 1 : 2, garcomId: x.admin, status: "aberta", total: "10", gorjeta: "0", createdAt: date });
    data.pedidos.push({ id: x.pedido, restauranteId, comandaId: x.comanda, pratoId: x.prato, quantidade: 1, precoUnitario: "10", observacao: null, status: "pendente", createdAt: date });
    data.user.push({ id: x.garcom, name: "Garçom " + k, email: "garcom-" + k + "@example.com", role: "garcom", active: true, createdAt: date },
                   { id: x.admin, name: "Admin " + k, email: "admin-" + k + "@example.com", role: "administrador", active: true, createdAt: date });
    data.profiles.push({ id: id(k === "A" ? 30 : 31), userId: x.garcom, restauranteId, role: "garcom" },
                       { id: id(k === "A" ? 32 : 33), userId: x.admin, restauranteId, role: "administrador" });
    data.account.push({ id: id(k === "A" ? 40 : 41), userId: x.garcom, password: "unchanged-" + k });
    data.usuarios.push({ id: x.usuario, restauranteId, nome: "Garçom " + k, email: "garcom-" + k + "@example.com", role: "garcom", ativo: true, senhaHash: "unchanged-" + k });
    data.usuariosSession.push({ token: "test-session-" + k, userId: x.usuario });
    data.insumos.push({ id: x.insumo, restauranteId, nome: "Insumo " + k, estoqueAtual: "10", unidade: "kg" });
    data.pratoInsumos.push({ id: x.vinculo, restauranteId, pratoId: x.prato, insumoId: x.insumo, quantidadeUsada: "1" });
  }
  return data;
}
function value(v, row) {
  if (v && v.table) return row[v.table]?.[v.column];
  return v;
}
function matches(expr, row) {
  if (!expr) return true;
  if (expr.op === "eq") return value(expr.a, row) === value(expr.b, row);
  if (expr.op === "and") return expr.args.every(x => matches(x, row));
  if (expr.op === "or") return expr.args.some(x => matches(x, row));
  if (expr.op === "in") {
    const list = Array.isArray(expr.b) ? expr.b : expr.b.run().map(x => Object.values(x)[0]);
    return list.includes(value(expr.a, row));
  }
  if (expr.op === "sql" && expr.text.includes("LOWER")) {
    return String(value(expr.values[0], row)).toLowerCase() === String(expr.values[1]).toLowerCase();
  }
  throw Error("Unsupported predicate: " + JSON.stringify(expr));
}
class Query {
  constructor(db, op, fields) { Object.assign(this, { db, op, fields, joins: [], limitN: Infinity }); }
  from(t) { this.table = t._table; return this; }
  where(p) { this.predicate = p; return this; }
  leftJoin(t, p) { this.joins.push({ t: t._table, p, left: true }); return this; }
  innerJoin(t, p) { this.joins.push({ t: t._table, p }); return this; }
  set(updates) { this.updates = updates; return this; }
  values(values) { this.inserts = Array.isArray(values) ? values : [values]; return this; }
  limit(n) { this.limitN = n; return this; }
  orderBy() { return this; }
  for() { return this; }
  returning() { return this; }
  then(resolve, reject) { try { return Promise.resolve(this.run()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); } }
  run() {
    if (this.op === "insert") {
      const rows = this.inserts.map(x => ({ id: randomUUID(), createdAt: new Date(), ...x }));
      this.db.data[this.table].push(...rows); return rows;
    }
    const base = this.db.data[this.table] ?? [];
    let contexts = base.map(row => ({ [this.table]: row }));
    for (const { t, p, left } of this.joins) contexts = contexts.flatMap(ctx => {
      const found = (this.db.data[t] ?? []).map(r => ({ ...ctx, [t]: r })).filter(c => matches(p, c));
      return found.length ? found : left ? [{ ...ctx, [t]: null }] : [];
    });
    contexts = contexts.filter(row => matches(this.predicate, row)).slice(0, this.limitN);
    if (this.op === "update") {
      const selected = contexts.map(c => c[this.table]);
      selected.forEach(r => Object.assign(r, this.updates)); return selected;
    }
    if (this.op === "delete") {
      const selected = new Set(contexts.map(c => c[this.table]));
      this.db.data[this.table] = base.filter(r => !selected.has(r));
      if (this.table === "user") for (const t of ["profiles", "account"]) this.db.data[t] = this.db.data[t].filter(r => ![...selected].some(u => u.id === r.userId));
      if (this.table === "comandas") this.db.data.pedidos = this.db.data.pedidos.filter(r => ![...selected].some(c => c.id === r.comandaId));
      return [...selected];
    }
    if (!this.fields) return contexts.map(row => row[this.table]);
    if (Object.values(this.fields).some(v => v?.op === "sql")) {
      const sum = contexts.reduce((s, c) => s + (c[this.table].status === "cancelado" ? 0 : c[this.table].quantidade * Number(c[this.table].precoUnitario)), 0);
      return [{ total: String(sum), subtotal: String(sum) }];
    }
    return contexts.map(ctx => Object.fromEntries(Object.entries(this.fields).map(([k, v]) => [k, value(v, ctx)])));
  }
}
class DB {
  constructor(data) { this.data = data; }
  select(fields) { return new Query(this, "select", fields); }
  update(t) { return new Query(this, "update").from(t); }
  delete(t) { return new Query(this, "delete").from(t); }
  insert(t) { return new Query(this, "insert").from(t); }
  async transaction(fn) { const before = structuredClone(this.data); try { return await fn(this); } catch (e) { this.data = before; throw e; } }
  async execute(expr) {
    if (expr.text.includes("COUNT(*)")) return [{ count: 0 }];
    // SQL read/total formatting is outside this authorization-only harness.
    return [];
  }
}
const noop = () => {};
function register(source, app) {
  const js = stripTypeScriptTypes(source).replace(/^import .*;\r?$/gm, "").replace(/\bexport function\b/g, "function");
  assert(!/^import /m.test(js), "Unexpected import remaining");
  const functionName = source.match(/export function (\w+)/)[1];
  const bindings = { schema, user: table("user"), userTable: table("user"), accountTable: table("account"),
    eq, and, or, inArray, sql, desc: v => v, lte: eq, randomUUID,
    customRequireAuth: async (_, __, reply) => { if (app.actor) return app.actor; reply.status(401).send({ error: "Unauthorized" }); return null; },
    requireTenant: a => { if (!a?.restauranteId) throw Error("Missing tenant"); return a.restauranteId; },
    requireRole: (a, roles, reply) => roles.includes(a.role) || (reply.status(403).send({ error: "Forbidden" }), false),
    resolveGarcomId: async (_, __, actorId) => ({ garcomId: actorId }),
    realtimeHub: { publish: noop }, fecharComanda: noop, cancelarPedido: noop,
    MOTIVOS_CANCELAMENTO: ["outro"], ROLES_ATENDIMENTO: ["garcom", "gerente", "administrador"],
    bcrypt: { hash: async password => "test-hash:" + password } };
  new Function(...Object.keys(bindings), js + "\nreturn " + functionName + ";")(...Object.values(bindings))(app);
}
async function request(version, method, path, actor, body = {}, params = {}, query = {}) {
  const routes = new Map(), errors = [];
  const app = { actor, db: new DB(fixtures()), logger: { info: noop, debug: noop, warn: noop, error: (...args) => errors.push(args) }, fastify: {} };
  for (const m of ["get", "post", "put", "patch", "delete"]) app.fastify[m] = (p, ...args) => routes.set(m.toUpperCase() + " " + p, args.at(-1));
  for (const source of Object.values(sources[version])) register(source, app);
  const before = structuredClone(app.db.data);
  const reply = { statusCode: 200, payload: undefined, code(n) { this.statusCode = n; return this; }, status(n) { return this.code(n); }, send(p) { this.payload = p; return this; } };
  const handler = routes.get(method + " " + path); assert(handler, method + " " + path);
  await handler({ params, body, query, headers: {}, log: app.logger }, reply);
  return { ...reply, before, data: app.db.data, errors };
}
const actor = k => ({ id: ids[k].admin, restauranteId: R[k], role: "administrador", email: "admin-" + k + "@example.com", name: "Admin " + k });
const checks = [];
function add(name, run) { checks.push({ name, run }); }
for (const a of ["A", "B"]) {
  const b = a === "A" ? "B" : "A", x = ids[a], y = ids[b], session = actor(a);
  const denied = [
    ["PUT", "/api/comandas/:id/cancelar", { id: y.comanda }, {}],
    ["DELETE", "/api/comandas/:id", { id: y.comanda }, {}],
    ["PATCH", "/api/pedidos/:id/observacao", { id: y.pedido }, { observacao: "forbidden" }],
    ["GET", "/api/mesas/:id/comanda", { id: y.mesa }, {}],
    ["GET", "/api/mesas/:id/historico", { id: y.mesa }, {}],
    ["GET", "/api/pedidos/:id", { id: y.pedido }, {}],
    ["PUT", "/api/garcons/:id", { id: y.garcom }, { password: "dummy-test-only", email: "changed@example.com" }],
    ["DELETE", "/api/garcons/:id", { id: y.garcom }, {}],
    ["POST", "/api/comandas", {}, { mesa_id: y.mesa, itens: [] }],
    ["POST", "/api/comandas", {}, { mesa_id: x.mesa, itens: [{ prato_id: y.prato, quantidade: 1, preco_unitario: 10 }] }],
    ["POST", "/api/pedidos", {}, { comanda_id: y.comanda, prato_id: x.prato, quantidade: 1 }],
    ["POST", "/api/pedidos", {}, { comanda_id: x.comanda, prato_id: y.prato, quantidade: 1 }],
    ["POST", "/api/comandas/:id/pedidos", { id: x.comanda }, { items: [{ prato_id: y.prato, quantidade: 1, preco_unitario: 10 }] }],
    ["POST", "/api/pratos/:pratoId/insumos", { pratoId: y.prato }, { insumo_id: x.insumo, quantidade: "1" }],
    ["POST", "/api/pratos/:pratoId/insumos", { pratoId: x.prato }, { insumo_id: y.insumo, quantidade: "1" }],
    ["DELETE", "/api/pratos/:pratoId/insumos/:id", { pratoId: y.prato, id: x.vinculo }, {}],
  ];
  for (const [method, path, params, body] of denied) add(a + " denies " + method + " " + path + " " + JSON.stringify(params) + " " + JSON.stringify(body), async version => {
    const r = await request(version, method, path, session, body, params);
    assert.equal(r.statusCode, 404, JSON.stringify(r.errors)); assert.deepEqual(r.data, r.before, "Rejected request changed data");
  });
  for (const path of ["/api/garcons", "/api/usuarios/garcons"]) add(a + " scoped list " + path, async version => {
    const r = await request(version, "GET", path, session);
    assert.equal(r.statusCode, 200); assert.deepEqual(r.payload.map(u => u.id), [path.includes("usuarios") ? x.usuario : x.garcom]);
  });
  add(a + " scoped email lookup", async version => {
    const r = await request(version, "GET", "/api/garcons/check-email", session, {}, {}, { email: "garcom-" + b + "@example.com" });
    assert.equal(r.statusCode, 200); assert.equal(r.payload.exists, false); assert.equal(r.payload.nome, null);
  });
}
for (const path of ["/api/insumos", "/api/insumos/alertas", "/api/estoque/movimentacoes/:insumoId", "/api/pratos/:pratoId/insumos"]) add("No auth " + path, async version => {
  const r = await request(version, "GET", path, null, {}, { insumoId: ids.A.insumo, pratoId: ids.A.prato });
  assert.equal(r.statusCode, 401, JSON.stringify(r.errors)); assert.deepEqual(r.data, r.before);
});
add("Own order remains readable", async version => {
  const r = await request(version, "GET", "/api/pedidos/:id", actor("A"), {}, { id: ids.A.pedido });
  assert.equal(r.statusCode, 200); assert.equal(r.payload.id, ids.A.pedido);
});
add("Own observation remains editable", async version => {
  const r = await request(version, "PATCH", "/api/pedidos/:id/observacao", actor("A"), { observacao: "own change" }, { id: ids.A.pedido });
  assert.equal(r.statusCode, 200); assert.equal(r.payload.observacao, "own change");
  assert.deepEqual(r.data.pedidos.find(p => p.id === ids.B.pedido), r.before.pedidos.find(p => p.id === ids.B.pedido));
});
add("Own waiter credentials update both identities only within tenant", async version => {
  const r = await request(version, "PUT", "/api/garcons/:id", actor("A"), { name: "Renamed", email: "renamed@example.com", password: "dummy-test-only" }, { id: ids.A.garcom });
  assert.equal(r.statusCode, 200, JSON.stringify(r.errors));
  assert.equal(r.data.usuarios.find(u => u.id === ids.A.usuario).email, "renamed@example.com");
  assert.equal(r.data.usuarios.find(u => u.id === ids.A.usuario).senhaHash, "test-hash:dummy-test-only");
  assert.equal(r.data.account.find(u => u.userId === ids.B.garcom).password, "unchanged-B");
});
add("Own waiter deletion revokes both identities", async version => {
  const r = await request(version, "DELETE", "/api/garcons/:id", actor("A"), {}, { id: ids.A.garcom });
  assert.equal(r.statusCode, 204, JSON.stringify(r.errors)); assert(!r.data.user.some(u => u.id === ids.A.garcom));
  assert(!r.data.usuarios.some(u => u.id === ids.A.usuario)); assert(!r.data.usuariosSession.some(u => u.userId === ids.A.usuario));
  assert(r.data.user.some(u => u.id === ids.B.garcom));
});
add("Create waiter provisions explicit restaurant profile", async version => {
  const r = await request(version, "POST", "/api/garcons", actor("A"), { name: "New waiter", email: "new@example.com", password: "dummy-test-only" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.errors));
  const profile = r.data.profiles.find(p => p.userId === r.payload.id); assert(profile); assert.equal(profile.restauranteId, R.A);
});
add("Own stock link succeeds", async version => {
  const r = await request(version, "POST", "/api/pratos/:pratoId/insumos", actor("A"), { insumo_id: ids.A.insumo, quantidade: "1" }, { pratoId: ids.A.prato });
  assert.equal(r.statusCode, 201); assert.equal(r.payload.restauranteId, R.A);
});
add("Waiter cannot manage other waiter credentials", async version => {
  const session = { ...actor("A"), id: ids.A.garcom, role: "garcom" };
  const r = await request(version, "PUT", "/api/garcons/:id", session, { password: "dummy-test-only" }, { id: ids.A.garcom });
  assert.equal(r.statusCode, 403); assert.deepEqual(r.data, r.before);
});
add("Waiter endpoint cannot edit manager account in own restaurant", async version => {
  const r = await request(version, "PUT", "/api/garcons/:id", actor("A"), { name: "forbidden" }, { id: ids.A.admin });
  assert.equal(r.statusCode, 404); assert.deepEqual(r.data, r.before);
});
add("Initial comanda ignores restaurant and waiter supplied by client", async version => {
  const r = await request(version, "POST", "/api/comandas", actor("A"),
    { mesa_id: ids.A.mesa, restaurante_id: R.B, restauranteId: R.B, garcom_id: ids.B.garcom, garcomId: ids.B.garcom,
      itens: [{ prato_id: ids.A.prato, quantidade: 1, preco_unitario: 10 }] });
  assert.equal(r.statusCode, 201, JSON.stringify(r.errors));
  const created = r.data.comandas.find(c => !r.before.comandas.some(old => old.id === c.id));
  assert(created); assert.equal(created.restauranteId, R.A); assert.equal(created.garcomId, ids.A.admin);
});
add("Order creation ignores restaurant supplied by client", async version => {
  const r = await request(version, "POST", "/api/pedidos", actor("A"),
    { comanda_id: ids.A.comanda, prato_id: ids.A.prato, quantidade: 1, restaurante_id: R.B, restauranteId: R.B });
  assert.equal(r.statusCode, 201, JSON.stringify(r.errors));
  const created = r.data.pedidos.find(p => !r.before.pedidos.some(old => old.id === p.id));
  assert(created); assert.equal(created.restauranteId, R.A);
});
add("Stock link creation ignores restaurant supplied by client", async version => {
  const r = await request(version, "POST", "/api/pratos/:pratoId/insumos", actor("A"),
    { insumo_id: ids.A.insumo, quantidade: "1", restaurante_id: R.B, restauranteId: R.B }, { pratoId: ids.A.prato });
  assert.equal(r.statusCode, 201); assert.equal(r.payload.restauranteId, R.A);
});
const failures = [];
for (const { name, run } of checks) {
  try { await run("after"); }
  catch (error) { failures.push({ name, error: error.message }); }
}
console.log(JSON.stringify({ tests: checks.length, passes: checks.length - failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
