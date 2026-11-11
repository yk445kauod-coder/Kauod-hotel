import { Hono } from 'hono';
import type { Env } from '../db.js';
import { requireAuth } from '../auth-middleware.js';

export const directoryRoutes = new Hono<{ Bindings: Env }>();

// Guest directory derived from invoices: the distinct names on ACTIVE
// (non-cancelled) invoices, with how many invoices each name has and the last
// issue date. The standalone rooms / reservations / guests tables are no longer
// exposed — this list is the single source of names and stays in sync with the
// register automatically.
directoryRoutes.get('/api/directory/names', requireAuth(), async (c) => {
  const tenantId = c.get('auth').user.tenantId;
  const rows = await c.get('db').all(
    `SELECT guest_name AS name, COUNT(*) AS invoices, MAX(issued_at) AS last_issued
       FROM invoices
      WHERE tenant_id = ? AND status != 'cancelled' AND TRIM(guest_name) != ''
      GROUP BY guest_name
      ORDER BY name`,
    [tenantId],
  );
  return c.json({ names: rows });
});
