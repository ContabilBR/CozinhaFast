// Trava de segurança: protege contra rodar testes contra servidores remotos.
// Este módulo é importado por helpers.ts antes de qualquer teste rodar.
// Testes são permitidos contra localhost (desenvolvimento local).
// Testes contra servidores remotos exigem confirmação explícita via ALLOW_REMOTE_TESTS=true.

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:8083";
const ENDERECO_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

if (!ENDERECO_LOCAL.test(BASE_URL) && process.env.ALLOW_REMOTE_TESTS !== "true") {
  throw new Error(
    `Testes bloqueados: tentativa de rodar contra ${BASE_URL}. ` +
    `Testes gravam dados reais no banco. Use um servidor local. ` +
    `Se tiver CERTEZA que é um banco de testes, defina ALLOW_REMOTE_TESTS=true.`
  );
}
