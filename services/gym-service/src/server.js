const { createApp, asyncHandler, errorHandler, httpError, notFoundHandler, requireAuth, requireRoles } = require('../../../shared/http');
const { numberEnv } = require('../../../shared/config');
const { query, transaction, waitForPostgres, asNumber } = require('../../../shared/postgres');
const { formatDate, formatTime, daysUntil, membershipStatus } = require('../../../shared/format');
const fs = require('fs/promises');
const path = require('path');

const serviceName = 'gym-service';
const app = createApp(serviceName);

function mapClient(row) {
  return {
    id: row.id,
    name: row.name,
    document: row.document || '',
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    birthDate: row.birth_date,
    status: row.status,
    plan: row.plan_name ? `Plan ${String(row.plan_name).toLowerCase()}` : 'Sin membresia',
    joined: formatDate(row.joined_at),
    notes: row.notes || ''
  };
}

function mapPlan(row) {
  return {
    id: row.id,
    name: row.name,
    durationDays: row.duration_days,
    price: asNumber(row.price),
    description: row.description || '',
    active: row.active
  };
}

function mapMembership(row) {
  const status = membershipStatus(row.end_date, row.status);
  return {
    id: row.id,
    clientId: row.client_id,
    planId: row.plan_id,
    member: row.client_name,
    plan: row.plan_name,
    start: formatDate(row.start_date),
    end: formatDate(row.end_date),
    startDate: row.start_date,
    endDate: row.end_date,
    days: daysUntil(row.end_date),
    status,
    price: asNumber(row.price)
  };
}

function mapAttendance(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    member: row.client_name,
    time: formatTime(row.check_in_at),
    date: formatDate(row.check_in_at),
    checkInAt: row.check_in_at,
    access: row.access_point,
    status: row.status,
    notes: row.notes || ''
  };
}

function mapPayment(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    membershipId: row.membership_id,
    member: row.client_name || 'Cliente externo',
    concept: row.concept,
    method: row.method,
    date: formatDate(row.paid_at),
    paidAt: row.paid_at,
    dueDate: row.due_date,
    amount: asNumber(row.amount),
    status: row.status,
    observation: row.observation || ''
  };
}

async function listClients(filters = {}) {
  const params = [];
  const where = [];

  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    where.push(`(LOWER(c.name) LIKE $${params.length} OR LOWER(COALESCE(c.document, '')) LIKE $${params.length} OR LOWER(COALESCE(c.email, '')) LIKE $${params.length})`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`c.status = $${params.length}`);
  }

  const result = await query(
    `SELECT c.*,
            p.name AS plan_name
     FROM clients c
     LEFT JOIN LATERAL (
       SELECT mp.name
       FROM memberships m
       JOIN membership_plans mp ON mp.id = m.plan_id
       WHERE m.client_id = c.id
       ORDER BY m.end_date DESC
       LIMIT 1
     ) p ON TRUE
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY c.created_at DESC, c.id DESC`,
    params
  );
  return result.rows.map(mapClient);
}

async function getClientOrFail(id) {
  const clients = await listClients({});
  const client = clients.find(item => item.id === Number(id));
  if (!client) {
    throw httpError(404, 'Client not found');
  }
  return client;
}

async function listMemberships(extraWhere = '', params = []) {
  const result = await query(
    `SELECT m.*, c.name AS client_name, p.name AS plan_name
     FROM memberships m
     JOIN clients c ON c.id = m.client_id
     JOIN membership_plans p ON p.id = m.plan_id
     ${extraWhere}
     ORDER BY m.end_date ASC, m.id DESC`,
    params
  );
  return result.rows.map(mapMembership);
}

async function listPayments(extraWhere = '', params = []) {
  const result = await query(
    `SELECT p.*, c.name AS client_name
     FROM payments p
     LEFT JOIN clients c ON c.id = p.client_id
     ${extraWhere}
     ORDER BY p.paid_at DESC, p.id DESC`,
    params
  );
  return result.rows.map(mapPayment);
}

async function listAttendance(extraWhere = '', params = []) {
  const result = await query(
    `SELECT a.*, c.name AS client_name
     FROM attendance a
     JOIN clients c ON c.id = a.client_id
     ${extraWhere}
     ORDER BY a.check_in_at DESC, a.id DESC`,
    params
  );
  return result.rows.map(mapAttendance);
}

async function tableSnapshot(tableName, orderBy = 'id') {
  const result = await query(`SELECT * FROM ${tableName} ORDER BY ${orderBy}`);
  return result.rows;
}

async function optionalTableSnapshot(tableName, orderBy = 'id') {
  try {
    return await tableSnapshot(tableName, orderBy);
  } catch (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }
}

async function createBackupSnapshot() {
  const [
    clients,
    users,
    plans,
    memberships,
    attendance,
    payments,
    supplements,
    machines,
    settings,
    contacts,
    storeOrders,
    storeOrderItems
  ] = await Promise.all([
    tableSnapshot('clients'),
    query(`SELECT id, username, email, full_name, phone, role_id, client_id, active, last_login_at, created_at, updated_at FROM users ORDER BY id`).then(result => result.rows),
    tableSnapshot('membership_plans'),
    tableSnapshot('memberships'),
    tableSnapshot('attendance'),
    tableSnapshot('payments'),
    tableSnapshot('supplements'),
    tableSnapshot('machines'),
    tableSnapshot('gym_settings'),
    tableSnapshot('contacts'),
    optionalTableSnapshot('store_orders'),
    optionalTableSnapshot('store_order_items')
  ]);

  return {
    generatedAt: new Date().toISOString(),
    source: serviceName,
    database: 'postgres',
    tables: {
      clients,
      users,
      membership_plans: plans,
      memberships,
      attendance,
      payments,
      supplements,
      machines,
      gym_settings: settings,
      contacts,
      store_orders: storeOrders,
      store_order_items: storeOrderItems
    }
  };
}

app.get('/health', (req, res) => {
  res.json({ service: serviceName, status: 'ok' });
});

app.get('/clients', asyncHandler(async (req, res) => {
  res.json(await listClients({ search: req.query.search, status: req.query.status }));
}));

app.get('/clients/:id', asyncHandler(async (req, res) => {
  res.json(await getClientOrFail(req.params.id));
}));

app.post('/clients', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.document) {
    throw httpError(400, 'name and document are required');
  }
  const result = await query(
    `INSERT INTO clients (name, document, phone, email, address, birth_date, status, joined_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'Activo'), COALESCE($8, CURRENT_DATE), $9)
     RETURNING id`,
    [
      String(body.name).trim(),
      String(body.document).trim(),
      body.phone || null,
      body.email || null,
      body.address || null,
      body.birthDate || null,
      body.status || 'Activo',
      body.joinedAt || null,
      body.notes || null
    ]
  );
  res.status(201).json(await getClientOrFail(result.rows[0].id));
}));

app.put('/clients/:id', asyncHandler(async (req, res) => {
  const body = req.body || {};
  await query(
    `UPDATE clients SET
       name = COALESCE($1, name),
       document = COALESCE($2, document),
       phone = COALESCE($3, phone),
       email = COALESCE($4, email),
       address = COALESCE($5, address),
       birth_date = COALESCE($6, birth_date),
       status = COALESCE($7, status),
       notes = COALESCE($8, notes),
       updated_at = NOW()
     WHERE id = $9`,
    [
      body.name ?? null,
      body.document ?? null,
      body.phone ?? null,
      body.email ?? null,
      body.address ?? null,
      body.birthDate ?? null,
      body.status ?? null,
      body.notes ?? null,
      req.params.id
    ]
  );
  res.json(await getClientOrFail(req.params.id));
}));

app.delete('/clients/:id', asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM clients WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) {
    throw httpError(404, 'Client not found');
  }
  res.status(204).send();
}));

app.get('/plans', asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM membership_plans ORDER BY price ASC');
  res.json(result.rows.map(mapPlan));
}));

app.get('/public/plans', asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM membership_plans WHERE active = TRUE ORDER BY price ASC');
  res.json(result.rows.map(mapPlan));
}));

app.post('/plans', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.durationDays) {
    throw httpError(400, 'name and durationDays are required');
  }
  const result = await query(
    `INSERT INTO membership_plans (name, duration_days, price, description, active)
     VALUES ($1, $2, $3, $4, COALESCE($5, TRUE))
     RETURNING *`,
    [body.name, body.durationDays, body.price || 0, body.description || null, body.active]
  );
  res.status(201).json(mapPlan(result.rows[0]));
}));

app.put('/plans/:id', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await query(
    `UPDATE membership_plans SET
       name = COALESCE($1, name),
       duration_days = COALESCE($2, duration_days),
       price = COALESCE($3, price),
       description = COALESCE($4, description),
       active = COALESCE($5, active),
       updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [body.name ?? null, body.durationDays ?? null, body.price ?? null, body.description ?? null, body.active ?? null, req.params.id]
  );
  if (!result.rows[0]) {
    throw httpError(404, 'Plan not found');
  }
  res.json(mapPlan(result.rows[0]));
}));

app.delete('/plans/:id', asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM membership_plans WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) {
    throw httpError(404, 'Plan not found');
  }
  res.status(204).send();
}));

app.get('/memberships/alerts/expiring', asyncHandler(async (req, res) => {
  res.json(await listMemberships(
    `WHERE m.end_date <= CURRENT_DATE + INTERVAL '7 days' OR m.end_date < CURRENT_DATE`
  ));
}));

app.get('/memberships', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.clientId) {
    params.push(req.query.clientId);
    where.push(`m.client_id = $${params.length}`);
  }
  res.json(await listMemberships(where.length ? `WHERE ${where.join(' AND ')}` : '', params));
}));

app.get('/memberships/:id', asyncHandler(async (req, res) => {
  const memberships = await listMemberships('WHERE m.id = $1', [req.params.id]);
  if (!memberships[0]) {
    throw httpError(404, 'Membership not found');
  }
  res.json(memberships[0]);
}));

app.post('/memberships', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.clientId || !body.planId) {
    throw httpError(400, 'clientId and planId are required');
  }

  const created = await transaction(async client => {
    const plan = await client.query('SELECT * FROM membership_plans WHERE id = $1', [body.planId]);
    if (!plan.rows[0]) {
      throw httpError(404, 'Plan not found');
    }
    const startDate = body.startDate || new Date().toISOString().slice(0, 10);
    const result = await client.query(
      `INSERT INTO memberships (client_id, plan_id, start_date, end_date, status, price, notes)
       VALUES ($1, $2, $3, ($3::date + ($4 || ' days')::interval)::date, 'Activa', $5, $6)
       RETURNING id`,
      [body.clientId, body.planId, startDate, plan.rows[0].duration_days, body.price ?? plan.rows[0].price, body.notes || null]
    );
    return result.rows[0].id;
  });

  const memberships = await listMemberships('WHERE m.id = $1', [created]);
  res.status(201).json(memberships[0]);
}));

app.put('/memberships/:id', asyncHandler(async (req, res) => {
  const body = req.body || {};
  await query(
    `UPDATE memberships SET
       client_id = COALESCE($1, client_id),
       plan_id = COALESCE($2, plan_id),
       start_date = COALESCE($3, start_date),
       end_date = COALESCE($4, end_date),
       status = COALESCE($5, status),
       price = COALESCE($6, price),
       notes = COALESCE($7, notes),
       updated_at = NOW()
     WHERE id = $8`,
    [body.clientId ?? null, body.planId ?? null, body.startDate ?? null, body.endDate ?? null, body.status ?? null, body.price ?? null, body.notes ?? null, req.params.id]
  );
  const memberships = await listMemberships('WHERE m.id = $1', [req.params.id]);
  if (!memberships[0]) {
    throw httpError(404, 'Membership not found');
  }
  res.json(memberships[0]);
}));

app.patch('/memberships/:id/renew', asyncHandler(async (req, res) => {
  const durationDays = Number(req.body?.durationDays || 30);
  const result = await query(
    `UPDATE memberships
     SET start_date = CURRENT_DATE,
         end_date = CURRENT_DATE + ($1 || ' days')::interval,
         status = 'Activa',
         updated_at = NOW()
     WHERE id = $2
     RETURNING id`,
    [durationDays, req.params.id]
  );
  if (!result.rows[0]) {
    throw httpError(404, 'Membership not found');
  }
  const memberships = await listMemberships('WHERE m.id = $1', [req.params.id]);
  res.json(memberships[0]);
}));

app.delete('/memberships/:id', asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM memberships WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) {
    throw httpError(404, 'Membership not found');
  }
  res.status(204).send();
}));

app.get('/attendance', asyncHandler(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.clientId) {
    params.push(req.query.clientId);
    where.push(`a.client_id = $${params.length}`);
  }
  if (req.query.date) {
    params.push(req.query.date);
    where.push(`a.check_in_at::date = $${params.length}::date`);
  }
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`a.status = $${params.length}`);
  }
  res.json(await listAttendance(where.length ? `WHERE ${where.join(' AND ')}` : '', params));
}));

app.post('/attendance/check-in', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const code = String(body.clientId || body.document || body.code || '').trim();
  if (!code) {
    throw httpError(400, 'clientId or document is required');
  }

  const clientResult = await query(
    `SELECT * FROM clients
     WHERE id::text = $1 OR document = $1
     LIMIT 1`,
    [code]
  );
  const client = clientResult.rows[0];
  if (!client) {
    throw httpError(404, 'Client not found');
  }

  const activeMembership = await query(
    `SELECT id FROM memberships
     WHERE client_id = $1 AND end_date >= CURRENT_DATE AND status <> 'Vencida'
     ORDER BY end_date DESC
     LIMIT 1`,
    [client.id]
  );
  if (!activeMembership.rows[0]) {
    throw httpError(409, 'Client does not have an active membership');
  }

  const result = await query(
    `INSERT INTO attendance (client_id, access_point, status, notes)
     VALUES ($1, $2, 'Ingreso correcto', $3)
     RETURNING id`,
    [client.id, body.access || 'Acceso principal', body.notes || null]
  );
  const records = await listAttendance('WHERE a.id = $1', [result.rows[0].id]);
  res.status(201).json(records[0]);
}));

app.get('/attendance/client/:clientId', asyncHandler(async (req, res) => {
  res.json(await listAttendance('WHERE a.client_id = $1', [req.params.clientId]));
}));

app.get('/attendance/date/:date', asyncHandler(async (req, res) => {
  res.json(await listAttendance('WHERE a.check_in_at::date = $1::date', [req.params.date]));
}));

app.get('/payments', asyncHandler(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`p.status = $${params.length}`);
  }
  if (req.query.method) {
    params.push(req.query.method);
    where.push(`p.method = $${params.length}`);
  }
  if (req.query.concept) {
    params.push(`%${String(req.query.concept).toLowerCase()}%`);
    where.push(`LOWER(p.concept) LIKE $${params.length}`);
  }
  res.json(await listPayments(where.length ? `WHERE ${where.join(' AND ')}` : '', params));
}));

app.get('/payments/:id', asyncHandler(async (req, res) => {
  const payments = await listPayments('WHERE p.id = $1', [req.params.id]);
  if (!payments[0]) {
    throw httpError(404, 'Payment not found');
  }
  res.json(payments[0]);
}));

app.post('/payments', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.concept || body.amount === undefined) {
    throw httpError(400, 'concept and amount are required');
  }

  let clientId = body.clientId || null;
  if (!clientId && body.member) {
    const clientResult = await query('SELECT id FROM clients WHERE LOWER(name) = LOWER($1) LIMIT 1', [body.member]);
    clientId = clientResult.rows[0]?.id || null;
  }

  const result = await query(
    `INSERT INTO payments (client_id, membership_id, concept, amount, method, status, paid_at, due_date, observation)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'Efectivo'), COALESCE($6, 'Pagado'), COALESCE($7, CURRENT_DATE), $8, $9)
     RETURNING id`,
    [
      clientId,
      body.membershipId || null,
      body.concept,
      body.amount,
      body.method || 'Efectivo',
      body.status || 'Pagado',
      body.paidAt || null,
      body.dueDate || null,
      body.observation || null
    ]
  );
  const payments = await listPayments('WHERE p.id = $1', [result.rows[0].id]);
  res.status(201).json(payments[0]);
}));

app.put('/payments/:id', asyncHandler(async (req, res) => {
  const body = req.body || {};
  let clientId = body.clientId ?? null;
  if (!clientId && body.member) {
    const clientResult = await query('SELECT id FROM clients WHERE LOWER(name) = LOWER($1) LIMIT 1', [body.member]);
    clientId = clientResult.rows[0]?.id || null;
  }

  await query(
    `UPDATE payments SET
       client_id = COALESCE($1, client_id),
       membership_id = COALESCE($2, membership_id),
       concept = COALESCE($3, concept),
       amount = COALESCE($4, amount),
       method = COALESCE($5, method),
       status = COALESCE($6, status),
       paid_at = COALESCE($7, paid_at),
       due_date = COALESCE($8, due_date),
       observation = COALESCE($9, observation),
       updated_at = NOW()
     WHERE id = $10`,
    [clientId, body.membershipId ?? null, body.concept ?? null, body.amount ?? null, body.method ?? null, body.status ?? null, body.paidAt ?? null, body.dueDate ?? null, body.observation ?? null, req.params.id]
  );
  const payments = await listPayments('WHERE p.id = $1', [req.params.id]);
  if (!payments[0]) {
    throw httpError(404, 'Payment not found');
  }
  res.json(payments[0]);
}));

app.patch('/payments/:id/status', asyncHandler(async (req, res) => {
  if (!req.body?.status) {
    throw httpError(400, 'status is required');
  }
  await query('UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2', [req.body.status, req.params.id]);
  const payments = await listPayments('WHERE p.id = $1', [req.params.id]);
  if (!payments[0]) {
    throw httpError(404, 'Payment not found');
  }
  res.json(payments[0]);
}));

app.delete('/payments/:id', asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM payments WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) {
    throw httpError(404, 'Payment not found');
  }
  res.status(204).send();
}));

app.get('/dashboard/summary', asyncHandler(async (req, res) => {
  const [clients, memberships, sales, pending, attendanceToday, lowStock, machines, alertsBase] = await Promise.all([
    query("SELECT COUNT(*)::int AS value FROM clients WHERE status = 'Activo'"),
    query("SELECT COUNT(*)::int AS value FROM memberships WHERE end_date >= CURRENT_DATE AND status <> 'Vencida'"),
    query("SELECT COALESCE(SUM(amount),0)::numeric AS value FROM payments WHERE status = 'Pagado'"),
    query("SELECT COUNT(*)::int AS value FROM payments WHERE status = 'Pendiente'"),
    query("SELECT COUNT(*)::int AS value FROM attendance WHERE check_in_at::date = CURRENT_DATE"),
    query('SELECT COUNT(*)::int AS value FROM supplements WHERE stock <= min_stock'),
    query("SELECT COUNT(*)::int AS value FROM machines WHERE status = 'Operativa'"),
    query("SELECT COUNT(*)::int AS value FROM memberships WHERE end_date <= CURRENT_DATE + INTERVAL '7 days'")
  ]);

  res.json({
    clientesActivos: clients.rows[0].value,
    membresiasActivas: memberships.rows[0].value,
    ventas: asNumber(sales.rows[0].value),
    pagosPendientes: pending.rows[0].value,
    asistenciasHoy: attendanceToday.rows[0].value,
    stockBajo: lowStock.rows[0].value,
    maquinasOperativas: machines.rows[0].value,
    alertas: alertsBase.rows[0].value + lowStock.rows[0].value
  });
}));

app.get('/dashboard/sales', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT paid_at AS date, COALESCE(SUM(amount),0)::numeric AS total, COUNT(*)::int AS count
     FROM payments
     WHERE status = 'Pagado'
     GROUP BY paid_at
     ORDER BY paid_at DESC
     LIMIT 30`
  );
  res.json(result.rows.map(row => ({ date: row.date, label: formatDate(row.date), total: asNumber(row.total), count: row.count })));
}));

app.get('/dashboard/attendance', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT check_in_at::date AS date, COUNT(*)::int AS count
     FROM attendance
     GROUP BY check_in_at::date
     ORDER BY date DESC
     LIMIT 30`
  );
  res.json(result.rows.map(row => ({ date: row.date, label: formatDate(row.date), count: row.count })));
}));

app.get('/dashboard/memberships', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT mp.name AS plan, COUNT(m.id)::int AS count
     FROM membership_plans mp
     LEFT JOIN memberships m ON m.plan_id = mp.id AND m.end_date >= CURRENT_DATE
     GROUP BY mp.name
     ORDER BY mp.name`
  );
  res.json(result.rows);
}));

app.get('/dashboard/inventory-alerts', asyncHandler(async (req, res) => {
  const [supplements, machines] = await Promise.all([
    query('SELECT id, name, stock, min_stock FROM supplements WHERE stock <= min_stock ORDER BY stock ASC'),
    query("SELECT id, name, status, maintenance_date FROM machines WHERE status <> 'Operativa' OR maintenance_date <= CURRENT_DATE + INTERVAL '7 days' ORDER BY maintenance_date ASC")
  ]);
  res.json({
    supplements: supplements.rows,
    machines: machines.rows
  });
}));

app.get('/settings/gym', requireAuth, requireRoles('ADMIN', 'RECEPCION'), asyncHandler(async (req, res) => {
  const result = await query("SELECT value FROM gym_settings WHERE key = 'gym'");
  res.json(result.rows[0]?.value || {});
}));

app.put('/settings/gym', requireAuth, requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const result = await query(
    `INSERT INTO gym_settings (key, value)
     VALUES ('gym', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     RETURNING value`,
    [JSON.stringify(req.body || {})]
  );
  res.json(result.rows[0].value);
}));

app.get('/settings/admin', requireAuth, requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const result = await query("SELECT value FROM gym_settings WHERE key = 'admin'");
  res.json(result.rows[0]?.value || {});
}));

app.put('/settings/admin', requireAuth, requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const result = await query(
    `INSERT INTO gym_settings (key, value)
     VALUES ('admin', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     RETURNING value`,
    [JSON.stringify(req.body || {})]
  );
  res.json(result.rows[0].value);
}));

app.post('/settings/backup', requireAuth, requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const backupDir = process.env.BACKUP_DIR || '/app/backups';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `fitadmin-backup-${timestamp}.json`;
  const filePath = path.join(backupDir, fileName);
  const snapshot = await createBackupSnapshot();

  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');

  const records = Object.values(snapshot.tables).reduce((total, rows) => total + rows.length, 0);
  res.status(201).json({
    status: 'created',
    message: 'Backup JSON generated successfully.',
    fileName,
    path: filePath,
    records,
    generatedAt: snapshot.generatedAt
  });
}));

app.get('/public/gym-settings', asyncHandler(async (req, res) => {
  const result = await query("SELECT value FROM gym_settings WHERE key = 'gym'");
  const settings = result.rows[0]?.value || {};
  res.json({
    name: 'WX GYM',
    sector: settings.sector || '',
    city: settings.city || 'Quito',
    phone: '0969953775',
    email: settings.email || 'contacto@wxgym.local',
    address: settings.address || 'Quito, Ecuador',
    openingHours: settings.openingHours || 'Lunes a Viernes 08:00 - 21:00',
    schedules: Array.isArray(settings.schedules) ? settings.schedules : []
  });
}));

app.post('/public/contact', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.name) {
    throw httpError(400, 'name is required');
  }
  const result = await query(
    `INSERT INTO contacts (type, name, email, phone, message)
     VALUES ('contact', $1, $2, $3, $4)
     RETURNING *`,
    [body.name, body.email || null, body.phone || null, body.message || null]
  );
  res.status(201).json(result.rows[0]);
}));

app.post('/public/demo-request', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.name) {
    throw httpError(400, 'name is required');
  }
  const result = await query(
    `INSERT INTO contacts (type, name, email, phone, message)
     VALUES ('demo', $1, $2, $3, $4)
     RETURNING *`,
    [body.name, body.email || null, body.phone || null, body.message || 'Solicitud de demo']
  );
  res.status(201).json(result.rows[0]);
}));

app.get('/client/profile', requireAuth, asyncHandler(async (req, res) => {
  if (!req.user.clientId) {
    throw httpError(404, 'Current user is not linked to a client');
  }
  res.json(await getClientOrFail(req.user.clientId));
}));

app.get('/client/membership', requireAuth, asyncHandler(async (req, res) => {
  if (!req.user.clientId) {
    throw httpError(404, 'Current user is not linked to a client');
  }
  const memberships = await listMemberships('WHERE m.client_id = $1', [req.user.clientId]);
  res.json(memberships[0] || null);
}));

app.get('/client/payments', requireAuth, asyncHandler(async (req, res) => {
  if (!req.user.clientId) {
    throw httpError(404, 'Current user is not linked to a client');
  }
  res.json(await listPayments('WHERE p.client_id = $1', [req.user.clientId]));
}));

app.get('/client/attendance', requireAuth, asyncHandler(async (req, res) => {
  if (!req.user.clientId) {
    throw httpError(404, 'Current user is not linked to a client');
  }
  res.json(await listAttendance('WHERE a.client_id = $1', [req.user.clientId]));
}));

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  await waitForPostgres();
  const port = numberEnv('PORT', numberEnv('GYM_SERVICE_PORT', 3002));
  app.listen(port, () => console.log(`[${serviceName}] listening on port ${port}`));
}

start().catch(error => {
  console.error(`[${serviceName}] failed to start`, error);
  process.exit(1);
});
