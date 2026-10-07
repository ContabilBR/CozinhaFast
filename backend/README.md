## Getting Started

**1. Create a GitHub Personal Access Token:**
- Go to [GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens)
- Generate a token with `read:packages` scope

**2. Set the token and install:**
```bash
export NPM_TOKEN=<your-token>
npm install
npm run dev
```

**Important:** Never commit your token. Use environment variables locally or secure secrets in CI/CD.

## Database

This template uses Neon (Postgres) for the database.

**After editing `src/db/schema.ts`, push your changes:**
```bash
npm run db:push
```

This command generates migration files and applies them to the database.

**Or run steps separately:**
```bash
# Generate migration files
npm run db:generate

# Apply migrations
npm run db:migrate
```

## Customization

- Add your API endpoints in `src/index.ts`
- Define your database schema in `src/db/schema.ts`
- Generate and apply migrations as needed

## Testes

Os testes de integração (`tests/`) **criam dados de verdade** (usuários, garçons, restaurantes). Rode-os apenas contra um backend local ligado a um banco de desenvolvimento, nunca contra a produção:

```bash
ALLOW_TEST_SIGNUP=true npm run dev   # em um terminal (banco de desenvolvimento)
bun test                             # em outro; usa http://localhost:8083 por padrão
```

- `ALLOW_TEST_SIGNUP=true` abre o endpoint de cadastro usado só pelos testes. Nunca defina em produção.
- Os testes se recusam a rodar contra endereço que não seja `localhost`, a menos que `ALLOW_REMOTE_TESTS=true`.
