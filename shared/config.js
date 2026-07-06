const dotenv = require('dotenv');

dotenv.config();

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function numberEnv(name, fallback) {
  const value = Number(env(name, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function listEnv(name, fallback = '') {
  return env(name, fallback)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function databaseUrl() {
  return env(
    'DATABASE_URL',
    `postgres://${env('POSTGRES_USER', 'fitadmin')}:${env('POSTGRES_PASSWORD', 'fitadmin')}@${env('POSTGRES_HOST', 'localhost')}:${env('POSTGRES_PORT', '5432')}/${env('POSTGRES_DB', 'fitadmin')}`
  );
}

module.exports = {
  env,
  numberEnv,
  listEnv,
  databaseUrl
};
