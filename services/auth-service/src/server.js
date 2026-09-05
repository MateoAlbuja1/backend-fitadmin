const bcrypt = require('bcryptjs');
const { createApp, asyncHandler, errorHandler, httpError, notFoundHandler, requireAuth, requireRoles, signToken } = require('../../../shared/http');
const { env, numberEnv } = require('../../../shared/config');
const { query, transaction, waitForPostgres } = require('../../../shared/postgres');

const serviceName = 'auth-service';
const app = createApp(serviceName);

function mapUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    role: row.role,
    clientId: row.client_id,
    active: row.active
  };
}

async function findUser(identifier) {
  const result = await query(
    `SELECT u.*, r.name AS role
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE LOWER(u.username) = LOWER($1) OR LOWER(COALESCE(u.email, '')) = LOWER($1)
     LIMIT 1`,
    [identifier]
  );
  return result.rows[0] || null;
}

async function ensureAdminUser() {
  const username = env('ADMIN_USERNAME', 'admin');
  const password = env('ADMIN_PASSWORD', 'admin');
  const email = env('ADMIN_EMAIL', 'admin@wxgym.local');
  const existing = await findUser(username);

  if (existing) {
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const roleResult = await query('SELECT id FROM roles WHERE name = $1', ['ADMIN']);
  if (!roleResult.rows[0]) {
    throw new Error('ADMIN role does not exist. Check PostgreSQL migrations.');
  }

  await query(
    `INSERT INTO users (username, email, password_hash, full_name, role_id, active)
     VALUES ($1, $2, $3, $4, $5, TRUE)`,
    [username, email, passwordHash, 'Mateo Admin', roleResult.rows[0].id]
  );
  console.log(`[${serviceName}] default admin user created`);
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'local';
}

function clientDevice(req) {
  return String(req.headers['user-agent'] || 'Navegador web').slice(0, 240);
}

async function recordLoginAttempt(req, row, identifier, success) {
  try {
    await query(
      `INSERT INTO login_history (user_id, username, role, device, ip, status, success)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row?.id || null,
        row?.username || identifier || 'desconocido',
        row?.role || null,
        clientDevice(req),
        clientIp(req),
        success ? 'Exitoso' : 'Fallido',
        success
      ]
    );
  } catch (error) {
    console.warn(`[${serviceName}] login history was not recorded`, error.message);
  }
}

app.get('/health', (req, res) => {
  res.json({ service: serviceName, status: 'ok' });
});

app.post('/auth/register', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const username = String(body.username || body.email || '').trim().toLowerCase();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const fullName = String(body.fullName || body.name || `${body.firstName || ''} ${body.lastName || ''}`).trim();
  const phone = String(body.phone || '').trim();
  const document = String(body.document || body.cedula || '').trim();

  if (!username || !email || !password || !fullName) {
    throw httpError(400, 'username, email, password and fullName are required');
  }
  if (password.length < 6) {
    throw httpError(400, 'Password must have at least 6 characters');
  }

  const existing = await findUser(username);
  if (existing) {
    throw httpError(409, 'User already exists');
  }

  const created = await transaction(async client => {
    const role = await client.query('SELECT id FROM roles WHERE name = $1', ['CLIENTE']);
    const roleId = role.rows[0]?.id;
    if (!roleId) {
      throw httpError(500, 'CLIENTE role does not exist');
    }

    const clientResult = await client.query(
      `INSERT INTO clients (name, document, phone, email, status, joined_at, notes)
       VALUES ($1, $2, $3, $4, 'Activo', CURRENT_DATE, 'Registro desde portal publico')
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         updated_at = NOW()
       RETURNING id`,
      [fullName, document || `REG-${Date.now()}`, phone || null, email]
    );

    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      `INSERT INTO users (username, email, password_hash, full_name, phone, role_id, client_id, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       RETURNING id, username, email, full_name, phone, client_id, active`,
      [username, email, passwordHash, fullName, phone || null, roleId, clientResult.rows[0].id]
    );

    return { ...userResult.rows[0], role: 'CLIENTE' };
  });

  const user = mapUser(created);
  res.status(201).json({
    user,
    token: signToken(user)
  });
}));

app.post('/auth/login', asyncHandler(async (req, res) => {
  const identifier = String(req.body?.username || req.body?.email || '').trim();
  const password = String(req.body?.password || '');

  if (!identifier || !password) {
    throw httpError(400, 'username/email and password are required');
  }

  const row = await findUser(identifier);
  if (!row || !row.active) {
    await recordLoginAttempt(req, row, identifier, false);
    throw httpError(401, 'Invalid credentials');
  }

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    await recordLoginAttempt(req, row, identifier, false);
    throw httpError(401, 'Invalid credentials');
  }

  await query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [row.id]);
  await recordLoginAttempt(req, row, identifier, true);
  const user = mapUser(row);
  res.json({
    user,
    token: signToken(user)
  });
}));

app.get('/auth/login-history', requireAuth, requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, username, role, device, ip, status, success, created_at
     FROM login_history
     ORDER BY created_at DESC
     LIMIT 50`
  );
  res.json(result.rows.map(row => ({
    id: row.id,
    user: row.username,
    role: row.role,
    device: row.device,
    ip: row.ip,
    status: row.status,
    success: row.success,
    createdAt: row.created_at,
    date: row.created_at
  })));
}));

app.get('/auth/users', requireAuth, requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.username, u.email, u.full_name, u.phone, u.client_id, u.active,
            u.last_login_at, u.created_at, r.name AS role
     FROM users u
     JOIN roles r ON r.id = u.role_id
     ORDER BY u.created_at DESC, u.id DESC`
  );

  res.json(result.rows.map(row => ({
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    role: row.role,
    clientId: row.client_id,
    active: row.active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at
  })));
}));

app.get('/auth/profile', requireAuth, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.username, u.email, u.full_name, u.phone, u.client_id, u.active, r.name AS role,
            c.document, c.address, c.birth_date, c.status AS client_status
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN clients c ON c.id = u.client_id
     WHERE u.id = $1`,
    [Number(req.user.sub)]
  );
  if (!result.rows[0]) {
    throw httpError(404, 'User not found');
  }
  const user = mapUser(result.rows[0]);
  res.json({
    user,
    client: result.rows[0].client_id ? {
      id: result.rows[0].client_id,
      document: result.rows[0].document,
      address: result.rows[0].address,
      birthDate: result.rows[0].birth_date,
      status: result.rows[0].client_status
    } : null
  });
}));

app.post('/auth/change-password', requireAuth, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');

  if (!currentPassword || !newPassword) {
    throw httpError(400, 'currentPassword and newPassword are required');
  }
  if (newPassword.length < 5) {
    throw httpError(400, 'New password must have at least 5 characters');
  }

  const result = await query('SELECT id, password_hash FROM users WHERE id = $1 AND active = TRUE', [Number(req.user.sub)]);
  const user = result.rows[0];
  if (!user) {
    throw httpError(404, 'User not found');
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    throw httpError(401, 'Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, user.id]);

  res.json({ message: 'Password updated successfully' });
}));

app.post('/auth/logout', (req, res) => {
  res.json({ message: 'Session closed' });
});

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  await waitForPostgres();
  await ensureAdminUser();
  const port = numberEnv('PORT', numberEnv('AUTH_SERVICE_PORT', 3001));
  app.listen(port, () => console.log(`[${serviceName}] listening on port ${port}`));
}

start().catch(error => {
  console.error(`[${serviceName}] failed to start`, error);
  process.exit(1);
});
