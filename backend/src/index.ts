import { createApplication } from "@specific-dev/framework";
import * as appSchema from './db/schema/schema.js';
import * as authSchema from './db/schema/auth-schema.js';
import { seedTestAdmin } from './config/test-mode.js';
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
import { registerSuperAdminRoutes } from './routes/superadmin.js';
import { seedDatabase } from './db/seed.js';
import { enableSelectRetry } from './db/withRetry.js';

// Combine schemas
const schema = { ...appSchema, ...authSchema };

// Create application with schema for full database type support
export const app = await createApplication(schema);

// Enable automatic retry logic for all SELECT queries on connection errors
// This transparently handles transient connection failures without requiring
// changes to individual query call sites
enableSelectRetry(app.db);

// Seed test admin and restaurante if test mode is enabled
await seedTestAdmin(app);

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

// Ensure a default restaurante exists for authentication
app.logger.info('Checking for default restaurante');
let defaultRestauranteCreated = false;
try {
  const existingRestaurantes = await app.db
    .select()
    .from(appSchema.restaurante)
    .limit(1);

  if (!existingRestaurantes || existingRestaurantes.length === 0) {
    app.logger.info('Creating default restaurante');
    try {
      const inserted = await app.db
        .insert(appSchema.restaurante)
        .values({
          nome: 'Default Restaurant',
        })
        .returning();
      if (inserted && inserted.length > 0) {
        app.logger.info({ restauranteId: inserted[0].id }, 'Default restaurante created');
        defaultRestauranteCreated = true;
      } else {
        app.logger.warn('Default restaurante insert returned no rows');
      }
    } catch (insertErr) {
      app.logger.error({ err: insertErr }, 'Failed to insert default restaurante');
    }
  } else {
    app.logger.debug({ restauranteId: existingRestaurantes[0].id }, 'Default restaurante already exists');
  }
} catch (selectErr) {
  app.logger.error({ err: selectErr }, 'Failed to query restaurante table - migrations may not have run');
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
registerSuperAdminRoutes(app);

// Seed database on startup (only if not in production and explicitly enabled)
if (process.env.NODE_ENV !== 'production' && process.env.SEED_ENABLED === 'true') {
  await seedDatabase(app);
}

await app.run();
app.logger.info('Application running');