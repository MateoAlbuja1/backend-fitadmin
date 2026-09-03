const { createApp, asyncHandler, errorHandler, httpError, notFoundHandler, requireAuth, requireRoles } = require('../../../shared/http');
const { env, numberEnv } = require('../../../shared/config');
const { query, transaction, waitForPostgres, asNumber } = require('../../../shared/postgres');
const { formatDate } = require('../../../shared/format');

const serviceName = 'inventory-service';
const app = createApp(serviceName);

function mapSupplement(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description || '',
    stock: row.stock,
    minStock: row.min_stock,
    price: asNumber(row.price),
    photo: row.image_url || '',
    imageUrl: row.image_url || '',
    factsPhoto: row.facts_image_url || '',
    status: row.status,
    visibleEnTienda: row.visible_in_store,
    visibleInStore: row.visible_in_store,
    discount: row.discount || undefined,
    rating: row.rating || undefined,
    imageFit: row.image_fit || 'contain'
  };
}

function mapMachine(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    location: row.location || '',
    nextMaintenance: formatDate(row.maintenance_date),
    maintenanceDate: row.maintenance_date,
    photo: row.image_url || '',
    imageUrl: row.image_url || '',
    observations: row.observations || ''
  };
}

async function listSupplements(where = '', params = []) {
  const result = await query(
    `SELECT * FROM supplements
     ${where}
     ORDER BY category ASC, name ASC`,
    params
  );
  return result.rows.map(mapSupplement);
}

async function getSupplementOrFail(id) {
  const items = await listSupplements('WHERE id = $1', [id]);
  if (!items[0]) {
    throw httpError(404, 'Supplement not found');
  }
  return items[0];
}

async function listMachines(where = '', params = []) {
  const result = await query(
    `SELECT * FROM machines
     ${where}
     ORDER BY
       CASE status
         WHEN 'Fuera de servicio' THEN 0
         WHEN 'Mantenimiento' THEN 1
         ELSE 2
       END,
       name ASC`,
    params
  );
  return result.rows.map(mapMachine);
}

async function getMachineOrFail(id) {
  const items = await listMachines('WHERE id = $1', [id]);
  if (!items[0]) {
    throw httpError(404, 'Machine not found');
  }
  return items[0];
}

function mapStoreOrder(row, items = []) {
  return {
    id: row.id,
    code: row.code,
    customerName: row.customer_name,
    customerEmail: row.customer_email || '',
    customerPhone: row.customer_phone,
    notes: row.notes || '',
    status: row.status,
    channel: row.channel,
    total: asNumber(row.total),
    paymentMethod: row.payment_method || '',
    paypalOrderId: row.paypal_order_id || '',
    paypalCaptureId: row.paypal_capture_id || '',
    paidAt: row.paid_at,
    stockDeductedAt: row.stock_deducted_at,
    paymentId: row.payment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items
  };
}

function mapStoreOrderItem(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    supplementId: row.supplement_id,
    productName: row.product_name,
    category: row.category || '',
    unitPrice: asNumber(row.unit_price),
    quantity: row.quantity,
    lineTotal: asNumber(row.line_total)
  };
}

async function getStoreOrderOrFail(id) {
  const orderResult = await query('SELECT * FROM store_orders WHERE id = $1 OR code = $2 LIMIT 1', [Number(id) || 0, String(id)]);
  const order = orderResult.rows[0];
  if (!order) {
    throw httpError(404, 'Store order not found');
  }
  const items = await query('SELECT * FROM store_order_items WHERE order_id = $1 ORDER BY id ASC', [order.id]);
  return mapStoreOrder(order, items.rows.map(mapStoreOrderItem));
}

function orderCode(id) {
  return `GX-${String(id).padStart(6, '0')}`;
}

function normalizeQuantity(value) {
  const quantity = Math.floor(Number(value || 0));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function paypalMode() {
  return env('PAYPAL_MODE', 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
}

function paypalBaseUrl() {
  return paypalMode() === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

function paypalCurrency() {
  return env('PAYPAL_CURRENCY', 'USD').toUpperCase();
}

function paypalClientId() {
  return env('PAYPAL_CLIENT_ID', '');
}

function paypalClientSecret() {
  return env('PAYPAL_CLIENT_SECRET', '');
}

function ensurePaypalConfigured() {
  if (!paypalClientId() || !paypalClientSecret()) {
    throw httpError(503, 'PayPal is not configured');
  }
}

async function paypalAccessToken() {
  ensurePaypalConfigured();
  const credentials = Buffer.from(`${paypalClientId()}:${paypalClientSecret()}`).toString('base64');
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw httpError(502, 'PayPal access token could not be created', payload);
  }
  return payload.access_token;
}

async function createPaypalCheckoutOrder(order) {
  const token = await paypalAccessToken();
  const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `${order.code}-create`
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: order.code,
          invoice_id: order.code,
          custom_id: String(order.id),
          description: `Pedido tienda ${order.code} GX GYM`,
          amount: {
            currency_code: paypalCurrency(),
            value: asNumber(order.total).toFixed(2)
          }
        }
      ]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    throw httpError(502, 'PayPal order could not be created', payload);
  }
  return payload;
}

async function capturePaypalCheckoutOrder(paypalOrderId) {
  const token = await paypalAccessToken();
  const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `${paypalOrderId}-capture`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(502, 'PayPal order could not be captured', payload);
  }
  return payload;
}

function paypalCaptureId(capturePayload) {
  return capturePayload?.purchase_units?.[0]?.payments?.captures?.[0]?.id || '';
}

async function resolveOrderItem(client, item) {
  const supplementId = Number(item.supplementId || item.productId || item.id || 0);
  const productName = String(item.name || item.productName || '').trim();
  const params = [];
  const where = [];

  if (supplementId) {
    params.push(supplementId);
    where.push(`id = $${params.length}`);
  }
  if (productName) {
    params.push(productName.toLowerCase());
    where.push(`LOWER(name) = $${params.length}`);
  }
  if (!where.length) {
    throw httpError(400, 'Each item requires supplementId or name');
  }

  const result = await client.query(
    `SELECT * FROM supplements
     WHERE (${where.join(' OR ')}) AND visible_in_store = TRUE AND status = 'Activo'
     LIMIT 1`,
    params
  );
  const supplement = result.rows[0];
  if (!supplement) {
    throw httpError(404, `Product not found: ${productName || supplementId}`);
  }

  const quantity = normalizeQuantity(item.quantity);
  if (!quantity) {
    throw httpError(400, `Invalid quantity for ${supplement.name}`);
  }
  if (supplement.stock < quantity) {
    throw httpError(409, `Insufficient stock for ${supplement.name}`);
  }

  const unitPrice = asNumber(supplement.price);
  return {
    supplement,
    quantity,
    unitPrice,
    lineTotal: Number((unitPrice * quantity).toFixed(2))
  };
}

const STOCK_DEDUCTING_STATUSES = new Set(['Confirmado', 'Preparado', 'Pagado', 'Entregado']);

async function deductOrderStock(client, items) {
  for (const item of items) {
    if (!item.supplement_id) {
      throw httpError(409, `Cannot adjust stock for ${item.product_name}`);
    }

    const result = await client.query(
      `UPDATE supplements
       SET stock = stock - $1::int, updated_at = NOW()
       WHERE id = $2 AND stock >= $1::int
       RETURNING id`,
      [item.quantity, item.supplement_id]
    );

    if (!result.rows[0]) {
      throw httpError(409, `Insufficient stock for ${item.product_name}`);
    }
  }
}

async function restoreOrderStock(client, items) {
  for (const item of items) {
    if (!item.supplement_id) continue;
    await client.query(
      `UPDATE supplements
       SET stock = stock + $1::int, updated_at = NOW()
       WHERE id = $2`,
      [item.quantity, item.supplement_id]
    );
  }
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

async function findStoreOrderClientId(client, order) {
  const params = [];
  const where = [];
  const email = String(order.customer_email || '').trim().toLowerCase();
  const phoneDigits = normalizeDigits(order.customer_phone);
  const name = String(order.customer_name || '').trim().toLowerCase();

  if (email) {
    params.push(email);
    where.push(`LOWER(COALESCE(email, '')) = $${params.length}`);
  }
  if (phoneDigits.length >= 7) {
    params.push(phoneDigits);
    where.push(`REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = $${params.length}`);
  }
  if (name) {
    params.push(name);
    where.push(`LOWER(name) = $${params.length}`);
  }
  if (!where.length) {
    return null;
  }

  const result = await client.query(
    `SELECT id FROM clients
     WHERE ${where.join(' OR ')}
     ORDER BY id DESC
     LIMIT 1`,
    params
  );
  return result.rows[0]?.id || null;
}

function buildStorePaymentObservation(order, items) {
  const lines = items.map(item => `${item.quantity} x ${item.product_name} ($${asNumber(item.unit_price).toFixed(2)})`).join('; ');
  const notes = order.notes ? ` Nota: ${order.notes}` : '';
  return `Pedido tienda ${order.code}. Cliente: ${order.customer_name}. Telefono: ${order.customer_phone}. ${lines}.${notes}`;
}

async function createStoreOrder(body, options = {}) {
  const customerName = String(body.customerName || body.name || '').trim();
  const customerPhone = String(body.customerPhone || body.phone || '').trim();
  const customerEmail = String(body.customerEmail || body.email || '').trim();
  const notes = String(body.notes || body.message || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const status = options.status || 'Nuevo';
  const channel = options.channel || body.channel || 'web';
  const paymentMethod = options.paymentMethod || body.paymentMethod || 'WhatsApp';

  if (!customerName || !customerPhone) {
    throw httpError(400, 'customerName and customerPhone are required');
  }
  if (!items.length) {
    throw httpError(400, 'At least one item is required');
  }

  const createdId = await transaction(async client => {
    const resolvedItems = [];
    for (const item of items) {
      resolvedItems.push(await resolveOrderItem(client, item));
    }

    const total = Number(resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
    const tempCode = `TMP-${Date.now()}-${Math.round(Math.random() * 1000000)}`;
    const orderResult = await client.query(
      `INSERT INTO store_orders
         (code, customer_name, customer_email, customer_phone, notes, status, channel, total, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [tempCode, customerName, customerEmail || null, customerPhone, notes || null, status, channel, total, paymentMethod]
    );
    const orderId = orderResult.rows[0].id;
    const code = orderCode(orderId);
    await client.query('UPDATE store_orders SET code = $1 WHERE id = $2', [code, orderId]);

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO store_order_items (order_id, supplement_id, product_name, category, unit_price, quantity, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          orderId,
          item.supplement.id,
          item.supplement.name,
          item.supplement.category,
          item.unitPrice,
          item.quantity,
          item.lineTotal
        ]
      );
    }

    return orderId;
  });

  return getStoreOrderOrFail(createdId);
}

async function settleStoreOrderPayment(client, order, items, method) {
  const clientId = await findStoreOrderClientId(client, order);
  const paymentMethod = String(method || 'Efectivo').trim() || 'Efectivo';
  const concept = `Pedido tienda ${order.code}`;
  const observation = buildStorePaymentObservation(order, items);

  if (order.payment_id) {
    const updateResult = await client.query(
      `UPDATE payments
       SET client_id = COALESCE(client_id, $1),
           concept = $2,
           amount = $3,
           method = $4,
           status = 'Pagado',
           paid_at = CURRENT_DATE,
           observation = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING id`,
      [clientId, concept, order.total, paymentMethod, observation, order.payment_id]
    );
    if (updateResult.rows[0]) {
      return updateResult.rows[0].id;
    }
  }

  const insertResult = await client.query(
    `INSERT INTO payments (client_id, concept, amount, method, status, paid_at, observation)
     VALUES ($1, $2, $3, $4, 'Pagado', CURRENT_DATE, $5)
     RETURNING id`,
    [clientId, concept, order.total, paymentMethod, observation]
  );
  return insertResult.rows[0].id;
}

async function voidStoreOrderPayment(client, paymentId, status) {
  if (!paymentId) {
    return;
  }
  await client.query(
    `UPDATE payments
     SET status = 'Anulado',
         observation = CONCAT(COALESCE(observation, ''), CASE WHEN COALESCE(observation, '') = '' THEN '' ELSE E'\n' END, $1::text),
         updated_at = NOW()
     WHERE id = $2`,
    [`Pago anulado porque el pedido cambio a ${status}.`, paymentId]
  );
}

app.get('/health', (req, res) => {
  res.json({ service: serviceName, status: 'ok' });
});

app.get('/inventory/supplements/store', asyncHandler(async (req, res) => {
  res.json(await listSupplements("WHERE visible_in_store = TRUE AND stock > 0 AND status = 'Activo'"));
}));

app.get('/public/supplements', asyncHandler(async (req, res) => {
  res.json(await listSupplements("WHERE visible_in_store = TRUE AND stock > 0 AND status = 'Activo'"));
}));

app.get('/inventory/supplements', asyncHandler(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.search) {
    params.push(`%${String(req.query.search).toLowerCase()}%`);
    where.push(`(LOWER(name) LIKE $${params.length} OR LOWER(category) LIKE $${params.length})`);
  }
  if (req.query.category) {
    params.push(req.query.category);
    where.push(`category = $${params.length}`);
  }
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`status = $${params.length}`);
  }
  res.json(await listSupplements(where.length ? `WHERE ${where.join(' AND ')}` : '', params));
}));

app.get('/inventory/supplements/:id', asyncHandler(async (req, res) => {
  res.json(await getSupplementOrFail(req.params.id));
}));

app.post('/inventory/supplements', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.category) {
    throw httpError(400, 'name and category are required');
  }
  const result = await query(
    `INSERT INTO supplements
       (name, category, price, stock, min_stock, image_url, facts_image_url, status, description, visible_in_store, discount, rating, image_fit)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'Activo'), $9, COALESCE($10, TRUE), $11, $12, COALESCE($13, 'contain'))
     RETURNING id`,
    [
      body.name,
      body.category,
      body.price || 0,
      body.stock || 0,
      body.minStock ?? body.min_stock ?? 0,
      body.photo || body.imageUrl || null,
      body.factsPhoto || body.factsImageUrl || null,
      body.status || 'Activo',
      body.description || null,
      body.visibleEnTienda ?? body.visibleInStore ?? true,
      body.discount || null,
      body.rating || null,
      body.imageFit || 'contain'
    ]
  );
  res.status(201).json(await getSupplementOrFail(result.rows[0].id));
}));

app.put('/inventory/supplements/:id', asyncHandler(async (req, res) => {
  const body = req.body || {};
  await query(
    `UPDATE supplements SET
       name = COALESCE($1, name),
       category = COALESCE($2, category),
       price = COALESCE($3, price),
       stock = COALESCE($4, stock),
       min_stock = COALESCE($5, min_stock),
       image_url = COALESCE($6, image_url),
       facts_image_url = COALESCE($7, facts_image_url),
       status = COALESCE($8, status),
       description = COALESCE($9, description),
       visible_in_store = COALESCE($10, visible_in_store),
       discount = COALESCE($11, discount),
       rating = COALESCE($12, rating),
       image_fit = COALESCE($13, image_fit),
       updated_at = NOW()
     WHERE id = $14`,
    [
      body.name ?? null,
      body.category ?? null,
      body.price ?? null,
      body.stock ?? null,
      body.minStock ?? body.min_stock ?? null,
      body.photo ?? body.imageUrl ?? null,
      body.factsPhoto ?? body.factsImageUrl ?? null,
      body.status ?? null,
      body.description ?? null,
      body.visibleEnTienda ?? body.visibleInStore ?? null,
      body.discount ?? null,
      body.rating ?? null,
      body.imageFit ?? null,
      req.params.id
    ]
  );
  res.json(await getSupplementOrFail(req.params.id));
}));

app.patch('/inventory/supplements/:id/stock', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (body.stock === undefined && body.delta === undefined) {
    throw httpError(400, 'stock or delta is required');
  }
  if (body.delta !== undefined) {
    await query(
      `UPDATE supplements
       SET stock = GREATEST(0, stock + $1::int), updated_at = NOW()
       WHERE id = $2`,
      [body.delta, req.params.id]
    );
  } else {
    await query(
      `UPDATE supplements
       SET stock = GREATEST(0, $1::int), updated_at = NOW()
       WHERE id = $2`,
      [body.stock, req.params.id]
    );
  }
  res.json(await getSupplementOrFail(req.params.id));
}));

app.delete('/inventory/supplements/:id', asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM supplements WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) {
    throw httpError(404, 'Supplement not found');
  }
  res.status(204).send();
}));

app.get('/public/paypal/config', (req, res) => {
  res.json({
    enabled: Boolean(paypalClientId() && paypalClientSecret()),
    clientId: paypalClientId(),
    currency: paypalCurrency(),
    mode: paypalMode()
  });
});

app.post('/public/store-orders', requireAuth, asyncHandler(async (req, res) => {
  const order = await createStoreOrder(req.body || {}, {
    status: 'Nuevo',
    channel: 'whatsapp',
    paymentMethod: 'WhatsApp'
  });
  res.status(201).json(order);
}));

app.post('/public/paypal/orders', requireAuth, asyncHandler(async (req, res) => {
  const order = await createStoreOrder(req.body || {}, {
    status: 'Pago pendiente',
    channel: 'paypal',
    paymentMethod: 'PayPal'
  });

  try {
    const paypalOrder = await createPaypalCheckoutOrder(order);
    await query(
      'UPDATE store_orders SET paypal_order_id = $1, updated_at = NOW() WHERE id = $2',
      [paypalOrder.id, order.id]
    );
    res.status(201).json({
      paypalOrderId: paypalOrder.id,
      order: await getStoreOrderOrFail(order.id)
    });
  } catch (error) {
    await query('UPDATE store_orders SET status = $1, updated_at = NOW() WHERE id = $2', ['Cancelado', order.id]).catch(() => undefined);
    throw error;
  }
}));

app.post('/public/paypal/orders/:paypalOrderId/capture', requireAuth, asyncHandler(async (req, res) => {
  const paypalOrderId = String(req.params.paypalOrderId || '').trim();
  if (!paypalOrderId) {
    throw httpError(400, 'paypalOrderId is required');
  }

  const captured = await transaction(async client => {
    const orderResult = await client.query(
      'SELECT * FROM store_orders WHERE paypal_order_id = $1 LIMIT 1 FOR UPDATE',
      [paypalOrderId]
    );
    const order = orderResult.rows[0];
    if (!order) {
      throw httpError(404, 'Store order not found for PayPal order');
    }

    const itemsResult = await client.query('SELECT * FROM store_order_items WHERE order_id = $1 ORDER BY id ASC', [order.id]);
    if (order.status === 'Pagado' && order.payment_id) {
      return mapStoreOrder(order, itemsResult.rows.map(mapStoreOrderItem));
    }

    const paypalCapture = await capturePaypalCheckoutOrder(paypalOrderId);
    if (paypalCapture.status !== 'COMPLETED') {
      throw httpError(409, 'PayPal payment was not completed', paypalCapture);
    }

    if (!order.stock_deducted_at) {
      await deductOrderStock(client, itemsResult.rows);
    }

    const paymentId = await settleStoreOrderPayment(client, order, itemsResult.rows, 'PayPal');
    const captureId = paypalCaptureId(paypalCapture);
    const updateResult = await client.query(
      `UPDATE store_orders
       SET status = 'Pagado',
           payment_method = 'PayPal',
           paypal_capture_id = $1,
           paid_at = NOW(),
           stock_deducted_at = COALESCE(stock_deducted_at, NOW()),
           payment_id = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [captureId || null, paymentId, order.id]
    );

    return mapStoreOrder(updateResult.rows[0], itemsResult.rows.map(mapStoreOrderItem));
  });

  res.json(captured);
}));

app.get('/inventory/store-orders', requireAuth, requireRoles('ADMIN', 'RECEPCION'), asyncHandler(async (req, res) => {
  const params = [];
  const where = [];

  if (req.query.status && req.query.status !== 'Todos') {
    params.push(req.query.status);
    where.push(`status = $${params.length}`);
  }
  if (req.query.search) {
    params.push(`%${String(req.query.search).toLowerCase()}%`);
    where.push(`(LOWER(code) LIKE $${params.length} OR LOWER(customer_name) LIKE $${params.length} OR LOWER(customer_phone) LIKE $${params.length})`);
  }

  const result = await query(
    `SELECT * FROM store_orders
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT 200`,
    params
  );
  res.json(result.rows.map(row => mapStoreOrder(row)));
}));

app.get('/inventory/store-orders/:id', requireAuth, requireRoles('ADMIN', 'RECEPCION'), asyncHandler(async (req, res) => {
  res.json(await getStoreOrderOrFail(req.params.id));
}));

app.patch('/inventory/store-orders/:id/status', requireAuth, requireRoles('ADMIN', 'RECEPCION'), asyncHandler(async (req, res) => {
  const status = String(req.body?.status || '').trim();
  const allowed = new Set(['Nuevo', 'Contactado', 'Confirmado', 'Preparado', 'Pago pendiente', 'Pagado', 'Entregado', 'Cancelado']);
  if (!allowed.has(status)) {
    throw httpError(400, 'Invalid order status');
  }

  const updated = await transaction(async client => {
    const orderResult = await client.query(
      'SELECT * FROM store_orders WHERE id = $1 OR code = $2 LIMIT 1 FOR UPDATE',
      [Number(req.params.id) || 0, String(req.params.id)]
    );
    const order = orderResult.rows[0];
    if (!order) {
      throw httpError(404, 'Store order not found');
    }

    const itemsResult = await client.query('SELECT * FROM store_order_items WHERE order_id = $1 ORDER BY id ASC', [order.id]);
    const shouldDeductStock = STOCK_DEDUCTING_STATUSES.has(status);
    const hasDeductedStock = Boolean(order.stock_deducted_at);

    if (shouldDeductStock && !hasDeductedStock) {
      await deductOrderStock(client, itemsResult.rows);
    }
    if (!shouldDeductStock && hasDeductedStock) {
      await restoreOrderStock(client, itemsResult.rows);
    }

    let paymentId = order.payment_id || null;
    if (status === 'Pagado' || status === 'Entregado') {
      paymentId = await settleStoreOrderPayment(client, order, itemsResult.rows, req.body?.paymentMethod || req.body?.method);
    } else if (paymentId) {
      await voidStoreOrderPayment(client, paymentId, status);
    }

    const updateResult = await client.query(
      `UPDATE store_orders
       SET status = $1::varchar,
           stock_deducted_at = CASE WHEN $2::boolean THEN COALESCE(stock_deducted_at, NOW()) ELSE NULL END,
           payment_id = $4,
           payment_method = CASE WHEN $5::text <> '' THEN $5::varchar ELSE payment_method END,
           paid_at = CASE WHEN $1::text IN ('Pagado', 'Entregado') THEN COALESCE(paid_at, NOW()) ELSE NULL END,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, shouldDeductStock, order.id, paymentId, req.body?.paymentMethod || req.body?.method || '']
    );

    return mapStoreOrder(updateResult.rows[0], itemsResult.rows.map(mapStoreOrderItem));
  });

  res.json(updated);
}));

app.get('/inventory/machines', asyncHandler(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.search) {
    params.push(`%${String(req.query.search).toLowerCase()}%`);
    where.push(`(LOWER(name) LIKE $${params.length} OR LOWER(type) LIKE $${params.length} OR LOWER(COALESCE(location, '')) LIKE $${params.length})`);
  }
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`status = $${params.length}`);
  }
  res.json(await listMachines(where.length ? `WHERE ${where.join(' AND ')}` : '', params));
}));

app.get('/inventory/machines/:id', asyncHandler(async (req, res) => {
  res.json(await getMachineOrFail(req.params.id));
}));

app.post('/inventory/machines', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.type) {
    throw httpError(400, 'name and type are required');
  }
  const result = await query(
    `INSERT INTO machines (name, type, status, location, maintenance_date, image_url, observations)
     VALUES ($1, $2, COALESCE($3, 'Operativa'), $4, $5, $6, $7)
     RETURNING id`,
    [
      body.name,
      body.type,
      body.status || 'Operativa',
      body.location || null,
      body.maintenanceDate || body.nextMaintenance || null,
      body.photo || body.imageUrl || null,
      body.observations || null
    ]
  );
  res.status(201).json(await getMachineOrFail(result.rows[0].id));
}));

app.put('/inventory/machines/:id', asyncHandler(async (req, res) => {
  const body = req.body || {};
  await query(
    `UPDATE machines SET
       name = COALESCE($1, name),
       type = COALESCE($2, type),
       status = COALESCE($3, status),
       location = COALESCE($4, location),
       maintenance_date = COALESCE($5, maintenance_date),
       image_url = COALESCE($6, image_url),
       observations = COALESCE($7, observations),
       updated_at = NOW()
     WHERE id = $8`,
    [
      body.name ?? null,
      body.type ?? null,
      body.status ?? null,
      body.location ?? null,
      body.maintenanceDate ?? body.nextMaintenance ?? null,
      body.photo ?? body.imageUrl ?? null,
      body.observations ?? null,
      req.params.id
    ]
  );
  res.json(await getMachineOrFail(req.params.id));
}));

app.patch('/inventory/machines/:id/status', asyncHandler(async (req, res) => {
  if (!req.body?.status) {
    throw httpError(400, 'status is required');
  }
  await query('UPDATE machines SET status = $1, updated_at = NOW() WHERE id = $2', [req.body.status, req.params.id]);
  res.json(await getMachineOrFail(req.params.id));
}));

app.delete('/inventory/machines/:id', asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM machines WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) {
    throw httpError(404, 'Machine not found');
  }
  res.status(204).send();
}));

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  await waitForPostgres();
  const port = numberEnv('PORT', numberEnv('INVENTORY_SERVICE_PORT', 3003));
  app.listen(port, () => console.log(`[${serviceName}] listening on port ${port}`));
}

start().catch(error => {
  console.error(`[${serviceName}] failed to start`, error);
  process.exit(1);
});
