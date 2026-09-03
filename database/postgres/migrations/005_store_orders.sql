CREATE TABLE IF NOT EXISTS store_orders (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  customer_name VARCHAR(160) NOT NULL,
  customer_email VARCHAR(160),
  customer_phone VARCHAR(40) NOT NULL,
  notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'Nuevo',
  channel VARCHAR(40) NOT NULL DEFAULT 'web',
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(40) NOT NULL DEFAULT 'WhatsApp',
  paypal_order_id VARCHAR(120),
  paypal_capture_id VARCHAR(120),
  paid_at TIMESTAMPTZ,
  stock_deducted_at TIMESTAMPTZ,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS stock_deducted_at TIMESTAMPTZ;
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL;
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40) NOT NULL DEFAULT 'WhatsApp';
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS paypal_order_id VARCHAR(120);
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS paypal_capture_id VARCHAR(120);
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS store_order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  supplement_id INTEGER REFERENCES supplements(id) ON DELETE SET NULL,
  product_name VARCHAR(160) NOT NULL,
  category VARCHAR(100),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total NUMERIC(10,2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_orders_status ON store_orders(status);
CREATE INDEX IF NOT EXISTS idx_store_orders_created_at ON store_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_orders_stock_deducted ON store_orders(stock_deducted_at);
CREATE INDEX IF NOT EXISTS idx_store_orders_payment ON store_orders(payment_id);
CREATE INDEX IF NOT EXISTS idx_store_orders_paypal_order ON store_orders(paypal_order_id);
CREATE INDEX IF NOT EXISTS idx_store_order_items_order ON store_order_items(order_id);
