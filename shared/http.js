const crypto = require('crypto');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { env, listEnv } = require('./config');

function createApp(serviceName) {
  const app = express();
  const allowedOrigins = listEnv('CORS_ORIGIN', 'http://localhost:4200,http://127.0.0.1:4200');

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true
  }));
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('x-request-id', req.id);
    res.setHeader('x-service', serviceName);
    next();
  });

  return app;
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl
  });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = error.status || 500;
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : error.message,
    details: status >= 500 ? undefined : error.details,
    requestId: req.id
  });
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

function requireAuth(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) {
    next(httpError(401, 'Authentication token is required'));
    return;
  }

  try {
    req.user = jwt.verify(token, env('JWT_SECRET', 'change-me-in-production'));
    next();
  } catch (error) {
    next(httpError(401, 'Invalid or expired token'));
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(httpError(403, 'Insufficient permissions'));
      return;
    }
    next();
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      email: user.email,
      role: user.role,
      clientId: user.clientId || null
    },
    env('JWT_SECRET', 'change-me-in-production'),
    { expiresIn: env('JWT_EXPIRES_IN', '8h') }
  );
}

module.exports = {
  createApp,
  asyncHandler,
  errorHandler,
  httpError,
  notFoundHandler,
  requireAuth,
  requireRoles,
  signToken
};
