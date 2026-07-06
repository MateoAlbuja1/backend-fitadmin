const { MongoClient, ObjectId } = require('mongodb');
const { createApp, asyncHandler, errorHandler, httpError, notFoundHandler } = require('../../../shared/http');
const { env, numberEnv } = require('../../../shared/config');
const { query, waitForPostgres, asNumber } = require('../../../shared/postgres');
const { formatDate, daysUntil } = require('../../../shared/format');

const serviceName = 'report-service';
const app = createApp(serviceName);

let mongoClient;
let mongoDb;

async function connectMongo() {
  if (mongoDb) {
    return mongoDb;
  }
  mongoClient = new MongoClient(env('MONGO_URL', 'mongodb://localhost:27017/fitadmin_mongo'));
  await mongoClient.connect();
  mongoDb = mongoClient.db(env('MONGO_DATABASE', 'fitadmin_mongo'));
  await ensureCollections(mongoDb);
  return mongoDb;
}

async function ensureCollections(db) {
  const collections = ['reports', 'alerts', 'logs', 'inventory_history', 'audit_changes', 'system_events'];
  const existing = await db.listCollections().toArray();
  const names = new Set(existing.map(item => item.name));
  for (const name of collections) {
    if (!names.has(name)) {
      await db.createCollection(name);
    }
  }
  await db.collection('reports').createIndex({ type: 1, createdAt: -1 });
  await db.collection('alerts').createIndex({ key: 1 }, { unique: true, sparse: true });
  await db.collection('alerts').createIndex({ read: 1, active: 1, createdAt: -1 });
}

function toPublicDocument(document) {
  if (!document) {
    return document;
  }
  return {
    ...document,
    id: document._id.toString(),
    _id: undefined
  };
}

function parseDateFilters(body = {}) {
  return {
    from: body.from || body.startDate || null,
    to: body.to || body.endDate || null
  };
}

function addDateFilter(baseSql, params, column, filters) {
  const where = [];
  if (filters.from) {
    params.push(filters.from);
    where.push(`${column} >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`${column} <= $${params.length}::date`);
  }
  if (!where.length) {
    return baseSql;
  }
  return `${baseSql} ${baseSql.toLowerCase().includes(' where ') ? 'AND' : 'WHERE'} ${where.join(' AND ')}`;
}

async function generateReport(type, filters) {
  if (type === 'sales' || type === 'ventas') {
    const params = [];
    const sql = addDateFilter(
      `SELECT method, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS total
       FROM payments
       WHERE status = 'Pagado'`,
      params,
      'paid_at',
      filters
    );
    const result = await query(`${sql} GROUP BY method ORDER BY total DESC`, params);
    return {
      totals: result.rows.map(row => ({ method: row.method, count: row.count, total: asNumber(row.total) })),
      total: result.rows.reduce((sum, row) => sum + Number(row.total), 0)
    };
  }

  if (type === 'payments' || type === 'pagos') {
    const params = [];
    const sql = addDateFilter(
      `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS total
       FROM payments`,
      params,
      'paid_at',
      filters
    );
    const result = await query(`${sql} GROUP BY status ORDER BY status`, params);
    return {
      byStatus: result.rows.map(row => ({ status: row.status, count: row.count, total: asNumber(row.total) }))
    };
  }

  if (type === 'memberships' || type === 'membresias') {
    const result = await query(
      `SELECT mp.name AS plan,
              CASE
                WHEN m.end_date < CURRENT_DATE THEN 'Vencida'
                WHEN m.end_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'Por vencer'
                ELSE 'Activa'
              END AS status,
              COUNT(m.id)::int AS count
       FROM memberships m
       JOIN membership_plans mp ON mp.id = m.plan_id
       GROUP BY mp.name, status
       ORDER BY mp.name, status`
    );
    return { byPlan: result.rows };
  }

  if (type === 'attendance' || type === 'asistencia') {
    const params = [];
    const sql = addDateFilter(
      `SELECT check_in_at::date AS date, COUNT(*)::int AS count
       FROM attendance`,
      params,
      'check_in_at::date',
      filters
    );
    const result = await query(`${sql} GROUP BY check_in_at::date ORDER BY date DESC`, params);
    return {
      byDate: result.rows.map(row => ({ date: row.date, label: formatDate(row.date), count: row.count })),
      total: result.rows.reduce((sum, row) => sum + Number(row.count), 0)
    };
  }

  if (type === 'stock' || type === 'inventory' || type === 'inventario') {
    const [supplements, machines] = await Promise.all([
      query('SELECT id, name, category, stock, min_stock, price FROM supplements ORDER BY stock ASC'),
      query('SELECT id, name, type, status, maintenance_date FROM machines ORDER BY status ASC')
    ]);
    return {
      lowStock: supplements.rows.filter(item => item.stock <= item.min_stock),
      supplements: supplements.rows.map(item => ({ ...item, price: asNumber(item.price) })),
      machines: machines.rows
    };
  }

  const paidParams = [];
  const paidSql = addDateFilter(
    "SELECT COALESCE(SUM(amount),0)::numeric AS total FROM payments WHERE status = 'Pagado'",
    paidParams,
    'paid_at',
    filters
  );
  const attendanceParams = [];
  const attendanceSql = addDateFilter(
    'SELECT COUNT(*)::int AS count FROM attendance',
    attendanceParams,
    'check_in_at::date',
    filters
  );

  const [clients, paid, attendance, lowStock] = await Promise.all([
    query("SELECT COUNT(*)::int AS count FROM clients WHERE status = 'Activo'"),
    query(paidSql, paidParams),
    query(attendanceSql, attendanceParams),
    query('SELECT COUNT(*)::int AS count FROM supplements WHERE stock <= min_stock')
  ]);
  return {
    activeClients: clients.rows[0].count,
    paidTotal: asNumber(paid.rows[0].total),
    attendanceTotal: attendance.rows[0].count,
    lowStock: lowStock.rows[0].count
  };
}

async function refreshAutomaticAlerts() {
  const db = await connectMongo();
  const alerts = db.collection('alerts');
  const activeKeys = [];

  const memberships = await query(
    `SELECT m.id, c.name AS client_name, mp.name AS plan_name, m.end_date
     FROM memberships m
     JOIN clients c ON c.id = m.client_id
     JOIN membership_plans mp ON mp.id = m.plan_id
     WHERE m.end_date <= CURRENT_DATE + INTERVAL '7 days'
     ORDER BY m.end_date ASC`
  );

  for (const row of memberships.rows) {
    const expired = new Date(row.end_date) < new Date(new Date().toISOString().slice(0, 10));
    const key = `membership-${row.id}`;
    activeKeys.push(key);
    await alerts.updateOne(
      { key },
      {
        $set: {
          key,
          type: expired ? 'danger' : 'warning',
          category: 'membership',
          title: expired ? `Membresia vencida - ${row.client_name}` : `Membresia por vencer - ${row.client_name}`,
          detail: expired ? `Vencio el ${formatDate(row.end_date)}` : `${daysUntil(row.end_date)} dias restantes - vence el ${formatDate(row.end_date)}`,
          route: '/membresias',
          sourceId: row.id,
          active: true,
          updatedAt: new Date()
        },
        $setOnInsert: { read: false, createdAt: new Date() }
      },
      { upsert: true }
    );
  }

  const supplements = await query('SELECT id, name, stock, min_stock FROM supplements WHERE stock <= min_stock ORDER BY stock ASC');
  for (const row of supplements.rows) {
    const key = `supplement-${row.id}`;
    activeKeys.push(key);
    await alerts.updateOne(
      { key },
      {
        $set: {
          key,
          type: 'stock',
          category: 'inventory',
          title: `Stock bajo - ${row.name}`,
          detail: `${row.stock} unidades - minimo ${row.min_stock}`,
          route: '/inventario/suplementos',
          sourceId: row.id,
          active: true,
          updatedAt: new Date()
        },
        $setOnInsert: { read: false, createdAt: new Date() }
      },
      { upsert: true }
    );
  }

  const machines = await query(
    `SELECT id, name, status, maintenance_date
     FROM machines
     WHERE status <> 'Operativa' OR maintenance_date <= CURRENT_DATE + INTERVAL '7 days'
     ORDER BY maintenance_date ASC`
  );
  for (const row of machines.rows) {
    const key = `machine-${row.id}`;
    activeKeys.push(key);
    await alerts.updateOne(
      { key },
      {
        $set: {
          key,
          type: row.status === 'Fuera de servicio' ? 'danger' : 'warning',
          category: 'machine',
          title: `Maquina requiere atencion - ${row.name}`,
          detail: `${row.status} - mantenimiento ${formatDate(row.maintenance_date)}`,
          route: '/inventario/maquinas',
          sourceId: row.id,
          active: true,
          updatedAt: new Date()
        },
        $setOnInsert: { read: false, createdAt: new Date() }
      },
      { upsert: true }
    );
  }

  await alerts.updateMany(
    { key: { $nin: activeKeys }, category: { $in: ['membership', 'inventory', 'machine'] } },
    { $set: { active: false, resolvedAt: new Date(), updatedAt: new Date() } }
  );
}

app.get('/health', (req, res) => {
  res.json({ service: serviceName, status: 'ok' });
});

app.get('/reports', asyncHandler(async (req, res) => {
  const db = await connectMongo();
  const queryFilter = {};
  if (req.query.type) {
    queryFilter.type = req.query.type;
  }
  const reports = await db.collection('reports').find(queryFilter).sort({ createdAt: -1 }).limit(100).toArray();
  res.json(reports.map(toPublicDocument));
}));

app.post('/reports/generate', asyncHandler(async (req, res) => {
  const db = await connectMongo();
  const type = String(req.body?.type || 'summary').toLowerCase();
  const filters = parseDateFilters(req.body);
  const data = await generateReport(type, filters);
  const document = {
    type,
    filters,
    data,
    createdAt: new Date(),
    generatedBy: req.body?.generatedBy || 'system'
  };
  const result = await db.collection('reports').insertOne(document);
  res.status(201).json(toPublicDocument({ _id: result.insertedId, ...document }));
}));

app.get('/reports/:id', asyncHandler(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    throw httpError(400, 'Invalid report id');
  }
  const db = await connectMongo();
  const report = await db.collection('reports').findOne({ _id: new ObjectId(req.params.id) });
  if (!report) {
    throw httpError(404, 'Report not found');
  }
  res.json(toPublicDocument(report));
}));

app.delete('/reports/:id', asyncHandler(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    throw httpError(400, 'Invalid report id');
  }
  const db = await connectMongo();
  const result = await db.collection('reports').deleteOne({ _id: new ObjectId(req.params.id) });
  if (!result.deletedCount) {
    throw httpError(404, 'Report not found');
  }
  res.status(204).send();
}));

app.get('/alerts', asyncHandler(async (req, res) => {
  await refreshAutomaticAlerts();
  const db = await connectMongo();
  const filter = {};
  if (req.query.active !== 'false') {
    filter.active = { $ne: false };
  }
  if (req.query.read !== undefined) {
    filter.read = req.query.read === 'true';
  }
  const alerts = await db.collection('alerts').find(filter).sort({ read: 1, createdAt: -1 }).limit(200).toArray();
  res.json(alerts.map(toPublicDocument));
}));

app.post('/alerts', asyncHandler(async (req, res) => {
  const db = await connectMongo();
  const body = req.body || {};
  if (!body.title) {
    throw httpError(400, 'title is required');
  }
  const document = {
    key: body.key || `manual-${Date.now()}`,
    type: body.type || 'warning',
    category: body.category || 'manual',
    title: body.title,
    detail: body.detail || '',
    route: body.route || '/dashboard',
    read: false,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  await db.collection('alerts').updateOne({ key: document.key }, { $set: document }, { upsert: true });
  const created = await db.collection('alerts').findOne({ key: document.key });
  res.status(201).json(toPublicDocument(created));
}));

app.patch('/alerts/:id/read', asyncHandler(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    throw httpError(400, 'Invalid alert id');
  }
  const db = await connectMongo();
  const result = await db.collection('alerts').findOneAndUpdate(
    { _id: new ObjectId(req.params.id) },
    { $set: { read: true, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!result) {
    throw httpError(404, 'Alert not found');
  }
  res.json(toPublicDocument(result));
}));

app.delete('/alerts/:id', asyncHandler(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    throw httpError(400, 'Invalid alert id');
  }
  const db = await connectMongo();
  const result = await db.collection('alerts').deleteOne({ _id: new ObjectId(req.params.id) });
  if (!result.deletedCount) {
    throw httpError(404, 'Alert not found');
  }
  res.status(204).send();
}));

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  await waitForPostgres();
  await connectMongo();
  await refreshAutomaticAlerts();
  const port = numberEnv('PORT', numberEnv('REPORT_SERVICE_PORT', 3004));
  app.listen(port, () => console.log(`[${serviceName}] listening on port ${port}`));
}

start().catch(error => {
  console.error(`[${serviceName}] failed to start`, error);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await mongoClient?.close();
  process.exit(0);
});
