const { createApp, asyncHandler, errorHandler, notFoundHandler } = require('../../../shared/http');
const { env, numberEnv } = require('../../../shared/config');

const serviceName = 'api-gateway';
const app = createApp(serviceName);

const targets = {
  auth: env('AUTH_SERVICE_URL', 'http://localhost:3001'),
  gym: env('GYM_SERVICE_URL', 'http://localhost:3002'),
  inventory: env('INVENTORY_SERVICE_URL', 'http://localhost:3003'),
  reports: env('REPORT_SERVICE_URL', 'http://localhost:3004')
};

function resolveTarget(path) {
  if (path.startsWith('/auth')) {
    return targets.auth;
  }
  if (path.startsWith('/inventory') || path.startsWith('/public/supplements') || path.startsWith('/public/store-orders')) {
    return targets.inventory;
  }
  if (path.startsWith('/reports') || path.startsWith('/alerts')) {
    return targets.reports;
  }
  return targets.gym;
}

function sanitizeHeaders(headers) {
  const forwarded = {};
  const blocked = new Set([
    'host',
    'content-length',
    'connection',
    'transfer-encoding',
    'keep-alive',
    'upgrade',
    'expect',
    'te',
    'trailer',
    'proxy-authorization',
    'proxy-authenticate'
  ]);

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (blocked.has(lower)) {
      continue;
    }
    forwarded[key] = value;
  }
  return forwarded;
}

app.get('/health', (req, res) => {
  res.json({
    service: serviceName,
    status: 'ok',
    targets
  });
});

app.use(asyncHandler(async (req, res) => {
  const upstreamPath = req.originalUrl.replace(/^\/api(?=\/)/, '');
  const target = resolveTarget(upstreamPath);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const headers = sanitizeHeaders(req.headers);
  const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase());

  if (hasBody && req.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  try {
    const response = await fetch(`${target}${upstreamPath}`, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body || {}) : undefined,
      signal: controller.signal
    });

    const contentType = response.headers.get('content-type') || 'application/json';
    const text = await response.text();
    res.status(response.status);
    res.type(contentType);
    res.send(text);
  } finally {
    clearTimeout(timeout);
  }
}));

app.use(notFoundHandler);
app.use(errorHandler);

const port = numberEnv('PORT', numberEnv('API_GATEWAY_PORT', 3000));
app.listen(port, () => {
  console.log(`[${serviceName}] listening on port ${port}`);
});
