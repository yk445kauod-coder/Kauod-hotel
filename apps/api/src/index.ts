import { Hono } from 'hono';
import type { Env } from './db.js';
import { Db } from './db.js';
import { corsHeaders, securityHeaders } from './http.js';
import { authRoutes } from './routes/auth.js';
import { invoiceRoutes } from './routes/invoices.js';
import { adminRoutes } from './routes/admin.js';
import { directoryRoutes } from './routes/directory.js';
import { reportRoutes } from './routes/reports.js';
import { etaRoutes } from './routes/eta.js';
import { handleError } from './errors.js';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') ?? null;
  for (const [k, v] of Object.entries({ ...securityHeaders(), ...corsHeaders(c.env, origin) })) {
    c.header(k, v);
  }
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true, service: 'kaoud-hotel-api', env: c.env.ENVIRONMENT }));

app.route('/', authRoutes);
app.route('/', invoiceRoutes);
app.route('/', adminRoutes);
app.route('/', directoryRoutes);
app.route('/', reportRoutes);
app.route('/', etaRoutes);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError(handleError);

export { app };
export default app;
