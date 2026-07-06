CREATE TABLE IF NOT EXISTS login_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username VARCHAR(80) NOT NULL,
  role VARCHAR(30),
  device TEXT,
  ip VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'Exitoso',
  success BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_history_created_at ON login_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_username ON login_history(username);
