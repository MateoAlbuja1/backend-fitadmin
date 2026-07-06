const { Pool } = require('pg');
const { databaseUrl } = require('./config');

const pool = new Pool({
  connectionString: databaseUrl(),
  max: Number(process.env.PG_POOL_SIZE || 10)
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

async function transaction(work) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function waitForPostgres(retries = 20) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await query('SELECT 1');
      return;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

function asNumber(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return Number(value);
}

module.exports = {
  pool,
  query,
  getClient,
  transaction,
  waitForPostgres,
  asNumber
};
