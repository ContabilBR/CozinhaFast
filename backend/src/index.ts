// deploy trigger 2026-09-08
import { createApplication } from "@specific-dev/framework";
import * as appSchema from './db/schema/schema.js';
import * as authSchema from './db/schema/auth-schema.js';
import { registerCustomAuthRoutes } from './routes/auth-custom.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDishRoutes } from './routes/dishes.js';
import { registerTableRoutes } from './routes/tables.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerOrderItemRoutes } from './routes/order-items.js';
import { registerCategoriasRoutes } from './routes/categorias.js';
import { registerUsuariosRoutes } from './routes/usuarios.js';
import { registerRelatoriosRoutes } from './routes/relatorios.js';
import { registerUploadRoutes } from './routes/upload.js';
import { registerGarconRoutes } from './routes/garcons.js';
import { registerHistoricoRoutes } from './routes/historico.js';
import { registerRestauranteRoutes } from './routes/restaurante.js';
import { registerRestauranteSignupRoutes } from './routes/restaurante-signup.js';
import { registerPagamentoRoutes } from './routes/pagamentos.js';
import { registerFiscalRoutes } from './routes/fiscal.js';
import { registerFiscalNfceRoutes } from './routes/fiscal-nfce.js';
import { registerAssinaturaRoutes } from './routes/assinatura.js';
import { registerLgpdRoutes } from './routes/lgpd.js';
import { registerDeliveryRoutes } from './routes/delivery.js';
import { registerRealtimeRoutes } from './routes/realtime.js';
import { registerCardapioPublicoRoutes } from './routes/cardapio-publico.js';
import { registerEstoqueRoutes } from './routes/estoque.js';
import { seedDatabase } from './db/seed.js';

// Combine schemas
const schema = { ...appSchema, ...authSchema };

// Create application with schema for full database type support
export const app = await createApplication(schema);
app.withStorage();

// Configure Better Auth with minimal settings
// The framework version doesn't expose additionalFields config
// Better Auth will auto-detect the user table columns (role, active)
app.withAuth();

// Export App type for use in route files
export type App = typeof app;

// Add global error handler for debugging - only catch unexpected errors
app.fastify.setErrorHandler((error: any, request, reply) => {
  // Let Fastify handle validation errors (FST_ERR_*) and other framework errors
  if (error.statusCode && error.statusCode < 500) {
    return reply.status(error.statusCode).send({ error: error.message });
  }

  // Log unexpected 5xx errors with full stack trace
  app.logger.error(
    {
      err: error,
      cause: error.cause, // Drizzle wraps the real driver/Postgres error here
      stack: error.stack,
      url: request.url,
      method: request.method,
    },
    'Global error handler'
  );
  console.error('Full error stack:', error.stack);
  if (error.cause) console.error('Underlying cause:', error.cause);

  // Never leak raw SQL, bound params, or driver internals to the client
  reply.status(500).send({ error: 'Erro interno do servidor. Tente novamente em instantes.' });
});

// Run startup SQL migrations - convert role column to TEXT type first
app.logger.info('Running startup SQL migrations');
try {
  // First, ensure role column is TEXT type (safety measure)
  app.logger.info('Converting role column to TEXT type');
  try {
    await (app.db as any).execute(`ALTER TABLE "user" ALTER COLUMN role TYPE text USING role::text;`);
    app.logger.info('Role column converted to TEXT');
  } catch (err) {
    app.logger.debug({ err }, 'Role column conversion failed (may already be TEXT)');
  }

  // Execute column default and constraint statements
  await (app.db as any).execute(`ALTER TABLE "user" ALTER COLUMN role SET DEFAULT 'garcom';`);
  await (app.db as any).execute(`ALTER TABLE "user" ALTER COLUMN active SET DEFAULT true;`);
  await (app.db as any).execute(`ALTER TABLE "user" ALTER COLUMN role DROP NOT NULL;`);
  await (app.db as any).execute(`ALTER TABLE "user" ALTER COLUMN active DROP NOT NULL;`);
  app.logger.info('Startup SQL migrations completed');
} catch (err) {
  app.logger.warn({ err }, 'Startup SQL migrations failed (may already be applied)');
}

// Ensure Better Auth tables exist using raw database connection
app.logger.info('Ensuring Better Auth tables exist');
try {
  const db = app.db as any;

  // Use the underlying database client if available, or fall back to execute
  const createTablesSQL = `
    BEGIN;
    CREATE TABLE IF NOT EXISTS "user" (
      "id" text NOT NULL PRIMARY KEY,
      "name" text NOT NULL,
      "email" text NOT NULL UNIQUE,
      "email_verified" boolean NOT NULL DEFAULT false,
      "image" text,
      "role" text DEFAULT 'garcom',
      "active" boolean DEFAULT true,
      "created_at" timestamp with time zone NOT NULL DEFAULT now(),
      "updated_at" timestamp with time zone NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "session" (
      "id" text NOT NULL PRIMARY KEY,
      "token" text NOT NULL UNIQUE,
      "user_id" text NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "ip_address" text,
      "user_agent" text,
      "created_at" timestamp with time zone NOT NULL DEFAULT now(),
      "updated_at" timestamp with time zone NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "account" (
      "id" text NOT NULL PRIMARY KEY,
      "account_id" text NOT NULL,
      "provider_id" text NOT NULL,
      "user_id" text NOT NULL,
      "access_token" text,
      "refresh_token" text,
      "id_token" text,
      "access_token_expires_at" timestamp with time zone,
      "refresh_token_expires_at" timestamp with time zone,
      "scope" text,
      "password" text,
      "created_at" timestamp with time zone NOT NULL DEFAULT now(),
      "updated_at" timestamp with time zone NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "verification" (
      "id" text NOT NULL PRIMARY KEY,
      "identifier" text NOT NULL,
      "value" text NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "created_at" timestamp with time zone NOT NULL DEFAULT now(),
      "updated_at" timestamp with time zone NOT NULL DEFAULT now()
    );
    ALTER TABLE IF EXISTS "session" ADD CONSTRAINT "session_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
    ALTER TABLE IF EXISTS "account" ADD CONSTRAINT "account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
    COMMIT;
  `;

  // Try to execute the SQL
  try {
    await db.execute(createTablesSQL);
    app.logger.info('Better Auth tables created/verified via transaction');
  } catch (executeErr: any) {
    // If execute fails, try individual statements
    app.logger.debug({ err: executeErr }, 'Transaction approach failed, trying individual statements');
    try {
      await db.execute('CREATE TABLE IF NOT EXISTS "user" ("id" text NOT NULL PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "email_verified" boolean NOT NULL DEFAULT false, "image" text, "role" text DEFAULT \'garcom\', "active" boolean DEFAULT true, "created_at" timestamp with time zone NOT NULL DEFAULT now(), "updated_at" timestamp with time zone NOT NULL DEFAULT now());');
      await db.execute('CREATE TABLE IF NOT EXISTS "session" ("id" text NOT NULL PRIMARY KEY, "token" text NOT NULL UNIQUE, "user_id" text NOT NULL, "expires_at" timestamp with time zone NOT NULL, "ip_address" text, "user_agent" text, "created_at" timestamp with time zone NOT NULL DEFAULT now(), "updated_at" timestamp with time zone NOT NULL DEFAULT now());');
      await db.execute('CREATE TABLE IF NOT EXISTS "account" ("id" text NOT NULL PRIMARY KEY, "account_id" text NOT NULL, "provider_id" text NOT NULL, "user_id" text NOT NULL, "access_token" text, "refresh_token" text, "id_token" text, "access_token_expires_at" timestamp with time zone, "refresh_token_expires_at" timestamp with time zone, "scope" text, "password" text, "created_at" timestamp with time zone NOT NULL DEFAULT now(), "updated_at" timestamp with time zone NOT NULL DEFAULT now());');
      await db.execute('CREATE TABLE IF NOT EXISTS "verification" ("id" text NOT NULL PRIMARY KEY, "identifier" text NOT NULL, "value" text NOT NULL, "expires_at" timestamp with time zone NOT NULL, "created_at" timestamp with time zone NOT NULL DEFAULT now(), "updated_at" timestamp with time zone NOT NULL DEFAULT now());');

      // Also create the restaurante table if needed (referenced by profiles)
      await db.execute('CREATE TABLE IF NOT EXISTS "restaurante" ("id" uuid NOT NULL PRIMARY KEY, "nome" text NOT NULL, "filial" text, "endereco" text, "cnpj" text, "plano" text DEFAULT \'trial\', "assinatura_status" text DEFAULT \'trial\', "assinatura_asaas_id" text, "trial_expira_em" timestamp with time zone, "inscricao_estadual" text, "inscricao_municipal" text, "regime_tributario" text, "cnae_principal" text, "csc_token" text, "csc_id" text, "ambiente_focus" integer DEFAULT 2, "ncm_padrao" text DEFAULT \'21069090\', "cep" text, "logradouro" text, "numero_endereco" text, "complemento" text, "bairro" text, "codigo_municipio_ibge" integer, "uf" text, "telefone" text, "email" text, "created_at" timestamp with time zone NOT NULL DEFAULT now(), "updated_at" timestamp with time zone NOT NULL DEFAULT now());');

      // Create profiles table
      await db.execute('CREATE TABLE IF NOT EXISTS "profiles" ("id" uuid NOT NULL PRIMARY KEY, "user_id" text NOT NULL, "role" text NOT NULL DEFAULT \'garcom\', "name" text, "created_at" timestamp with time zone NOT NULL DEFAULT now(), "restaurante_id" uuid NOT NULL);');

      // Add foreign keys if they don't exist
      try {
        await db.execute('ALTER TABLE IF EXISTS "session" ADD CONSTRAINT "session_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;');
      } catch {}
      try {
        await db.execute('ALTER TABLE IF EXISTS "account" ADD CONSTRAINT "account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;');
      } catch {}
      try {
        await db.execute('ALTER TABLE IF EXISTS "profiles" ADD CONSTRAINT "profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;');
      } catch {}
      try {
        await db.execute('ALTER TABLE IF EXISTS "profiles" ADD CONSTRAINT "profiles_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "restaurante"("id") ON DELETE restrict;');
      } catch {}

      app.logger.info('Better Auth tables created/verified individually');
    } catch (individualErr) {
      app.logger.error({ err: individualErr }, 'Failed to create tables individually');
      throw individualErr;
    }
  }

  app.logger.info('Better Auth tables ensured successfully');
} catch (err) {
  app.logger.error({ err }, 'Failed to ensure Better Auth tables - this may cause authentication to fail');
}

// Ensure the custom-auth session table exists. The Better Auth tables above
// self-heal on every boot via CREATE TABLE IF NOT EXISTS; usuarios_session
// (used by /api/login and /api/me for the custom garcom/cozinheiro auth
// flow) was only ever created by a Drizzle migration, with no equivalent
// safety net here — so it can end up missing in an environment where that
// migration never actually ran. Mirrors the same idempotent-guard pattern.
app.logger.info('Ensuring usuarios_session table exists');
try {
  await (app.db as any).execute(`
    CREATE TABLE IF NOT EXISTS "usuarios_session" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "token" text NOT NULL,
      "user_id" text NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "usuarios_session_token_unique" UNIQUE("token")
    );
  `);
  app.logger.info('usuarios_session table ensured');
} catch (err) {
  app.logger.error({ err }, 'Failed to ensure usuarios_session table');
}

// Ensure a default restaurante exists for authentication
app.logger.info('Ensuring default restaurante exists');
try {
  const existingRestaurantes = await app.db
    .select()
    .from(appSchema.restaurante)
    .limit(1);

  if (!existingRestaurantes || existingRestaurantes.length === 0) {
    app.logger.info('Creating default restaurante');
    await app.db.insert(appSchema.restaurante).values({
      nome: 'Default Restaurant',
    });
    app.logger.info('Default restaurante created');
  } else {
    app.logger.debug('Default restaurante already exists');
  }
} catch (err) {
  app.logger.warn({ err }, 'Failed to ensure default restaurante exists');
}

// Register routes - IMPORTANT: Always use registration functions to avoid circular dependency issues
// Register custom auth routes FIRST so they take priority
registerCustomAuthRoutes(app);
registerAuthRoutes(app);
registerDishRoutes(app);
registerTableRoutes(app);
registerOrderRoutes(app);
registerOrderItemRoutes(app);
registerCategoriasRoutes(app);
registerUsuariosRoutes(app);
registerRelatoriosRoutes(app);
registerUploadRoutes(app);
registerGarconRoutes(app);
registerHistoricoRoutes(app);
registerRestauranteRoutes(app);
registerRestauranteSignupRoutes(app);
registerPagamentoRoutes(app);
registerFiscalRoutes(app);
registerFiscalNfceRoutes(app);
registerAssinaturaRoutes(app);
registerLgpdRoutes(app);
registerDeliveryRoutes(app);
registerRealtimeRoutes(app);
registerCardapioPublicoRoutes(app);
registerEstoqueRoutes(app);

// Seed database on startup (only if not in production and explicitly enabled)
if (process.env.NODE_ENV !== 'production' && process.env.SEED_ENABLED === 'true') {
  await seedDatabase(app);
}

await app.run();
app.logger.info('Application running');