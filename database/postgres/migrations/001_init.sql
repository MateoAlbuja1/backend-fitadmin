CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(30) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  document VARCHAR(32) UNIQUE,
  phone VARCHAR(40),
  email VARCHAR(160) UNIQUE,
  address TEXT,
  birth_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'Activo',
  joined_at DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(160) UNIQUE,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(40),
  role_id INTEGER NOT NULL REFERENCES roles(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS membership_plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES membership_plans(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Activa',
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, plan_id, start_date)
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  check_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_point VARCHAR(120) NOT NULL DEFAULT 'Acceso principal',
  status VARCHAR(40) NOT NULL DEFAULT 'Ingreso correcto',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  membership_id INTEGER REFERENCES memberships(id) ON DELETE SET NULL,
  concept VARCHAR(160) NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  method VARCHAR(40) NOT NULL DEFAULT 'Efectivo',
  status VARCHAR(30) NOT NULL DEFAULT 'Pagado',
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  observation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplements (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  category VARCHAR(100) NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  image_url TEXT,
  facts_image_url TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'Activo',
  description TEXT,
  visible_in_store BOOLEAN NOT NULL DEFAULT TRUE,
  discount VARCHAR(80),
  rating VARCHAR(30),
  image_fit VARCHAR(20) NOT NULL DEFAULT 'contain',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS machines (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  type VARCHAR(100) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'Operativa',
  location VARCHAR(120),
  maintenance_date DATE,
  image_url TEXT,
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gym_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(80) NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  type VARCHAR(40) NOT NULL DEFAULT 'contact',
  name VARCHAR(160) NOT NULL,
  email VARCHAR(160),
  phone VARCHAR(40),
  message TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'Nuevo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_memberships_client ON memberships(client_id);
CREATE INDEX IF NOT EXISTS idx_memberships_end_date ON memberships(end_date);
CREATE INDEX IF NOT EXISTS idx_attendance_client ON attendance(client_id);
CREATE INDEX IF NOT EXISTS idx_attendance_check_in ON attendance(check_in_at);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_supplements_store ON supplements(visible_in_store, stock, status);
CREATE INDEX IF NOT EXISTS idx_machines_status ON machines(status);

INSERT INTO roles (name, description) VALUES
  ('ADMIN', 'Acceso completo al sistema'),
  ('RECEPCION', 'Gestion operativa diaria'),
  ('CLIENTE', 'Acceso de cliente')
ON CONFLICT (name) DO NOTHING;

INSERT INTO membership_plans (name, duration_days, price, description) VALUES
  ('Diario', 1, 3.00, 'Acceso por un dia a WX GYM'),
  ('Mensual', 30, 35.00, 'Membresia mensual con acceso completo'),
  ('Trimestral', 90, 85.00, 'Membresia trimestral con precio preferencial'),
  ('Anual', 365, 300.00, 'Membresia anual para clientes constantes')
ON CONFLICT (name) DO UPDATE SET
  duration_days = EXCLUDED.duration_days,
  price = EXCLUDED.price,
  description = EXCLUDED.description,
  active = TRUE,
  updated_at = NOW();

INSERT INTO clients (name, document, phone, email, address, birth_date, status, joined_at, notes) VALUES
  ('Maria Gonzalez', '1723456789', '099 452 1830', 'maria.gonzalez@wxgym.local', 'Quito, Ecuador', '1995-04-14', 'Activo', '2026-06-08', 'Cliente anual'),
  ('Carlos Mendoza', '1718294056', '098 116 4205', 'carlos.mendoza@wxgym.local', 'Quitumbe, Quito', '1991-09-20', 'Activo', '2026-06-04', 'Prefiere pago en efectivo'),
  ('Andrea Perez', '1751839204', '096 730 2241', 'andrea.perez@wxgym.local', 'Quito, Ecuador', '1998-12-02', 'Activo', '2026-05-28', 'Entrena en la tarde'),
  ('Jose Rivera', '1709483621', '099 044 7612', 'jose.rivera@wxgym.local', 'Guamani, Quito', '1988-02-11', 'Inactivo', '2026-04-12', 'Membresia vencida')
ON CONFLICT (document) DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  address = EXCLUDED.address,
  status = EXCLUDED.status,
  updated_at = NOW();

INSERT INTO memberships (client_id, plan_id, start_date, end_date, status, price)
SELECT c.id, p.id, DATE '2026-06-08', DATE '2027-06-08', 'Activa', p.price
FROM clients c, membership_plans p
WHERE c.document = '1723456789' AND p.name = 'Anual'
ON CONFLICT (client_id, plan_id, start_date) DO NOTHING;

INSERT INTO memberships (client_id, plan_id, start_date, end_date, status, price)
SELECT c.id, p.id, DATE '2026-06-04', DATE '2026-07-04', 'Activa', p.price
FROM clients c, membership_plans p
WHERE c.document = '1718294056' AND p.name = 'Mensual'
ON CONFLICT (client_id, plan_id, start_date) DO NOTHING;

INSERT INTO memberships (client_id, plan_id, start_date, end_date, status, price)
SELECT c.id, p.id, DATE '2026-05-28', DATE '2026-08-28', 'Activa', p.price
FROM clients c, membership_plans p
WHERE c.document = '1751839204' AND p.name = 'Trimestral'
ON CONFLICT (client_id, plan_id, start_date) DO NOTHING;

INSERT INTO memberships (client_id, plan_id, start_date, end_date, status, price)
SELECT c.id, p.id, DATE '2026-04-12', DATE '2026-05-12', 'Vencida', p.price
FROM clients c, membership_plans p
WHERE c.document = '1709483621' AND p.name = 'Mensual'
ON CONFLICT (client_id, plan_id, start_date) DO NOTHING;

INSERT INTO attendance (client_id, check_in_at, access_point, status)
SELECT id, NOW() - INTERVAL '2 hours', 'Acceso principal', 'Ingreso correcto' FROM clients WHERE document = '1709483621'
UNION ALL
SELECT id, NOW() - INTERVAL '1 hour 35 minutes', 'Acceso principal', 'Ingreso correcto' FROM clients WHERE document = '1723456789'
UNION ALL
SELECT id, NOW() - INTERVAL '1 hour 12 minutes', 'Acceso principal', 'Ingreso correcto' FROM clients WHERE document = '1751839204'
UNION ALL
SELECT id, NOW() - INTERVAL '48 minutes', 'Acceso principal', 'Ingreso correcto' FROM clients WHERE document = '1718294056';

INSERT INTO payments (client_id, membership_id, concept, amount, method, status, paid_at, observation)
SELECT c.id, m.id, 'Membresia trimestral', 85.00, 'Tarjeta', 'Pagado', DATE '2026-06-18', 'Pago inicial'
FROM clients c LEFT JOIN memberships m ON m.client_id = c.id
WHERE c.document = '1751839204' LIMIT 1;

INSERT INTO payments (client_id, membership_id, concept, amount, method, status, paid_at, observation)
SELECT c.id, m.id, 'Membresia mensual', 35.00, 'Efectivo', 'Pagado', DATE '2026-06-18', 'Pago mensual'
FROM clients c LEFT JOIN memberships m ON m.client_id = c.id
WHERE c.document = '1718294056' LIMIT 1;

INSERT INTO payments (client_id, concept, amount, method, status, paid_at, observation)
SELECT c.id, 'Whey Protein', 45.00, 'Transferencia', 'Pagado', DATE '2026-06-17', 'Venta de suplemento'
FROM clients c WHERE c.document = '1723456789';

INSERT INTO payments (client_id, membership_id, concept, amount, method, status, paid_at, observation)
SELECT c.id, m.id, 'Membresia mensual', 35.00, 'Transferencia', 'Pendiente', DATE '2026-06-16', 'Pendiente de confirmacion'
FROM clients c LEFT JOIN memberships m ON m.client_id = c.id
WHERE c.document = '1709483621' LIMIT 1;

INSERT INTO supplements (name, category, description, stock, min_stock, price, image_url, facts_image_url, discount, rating, visible_in_store, image_fit) VALUES
  ('Dragon Whey Phorm 2 lb', 'Proteinas', 'Proteina whey de chocolate blanco y vainilla para recuperacion muscular.', 14, 4, 48.00, '/assets/img/products/proteins/dragon-whey-phorm.png', '/assets/img/products/proteins/dragon-whey-phorm-facts.png', 'Nuevo', '4.8/5', TRUE, 'contain'),
  ('ON Gold Standard Whey', 'Proteinas', 'Whey premium de rapida mezcla, ideal para despues del entrenamiento.', 9, 4, 55.00, '/assets/img/products/proteins/on-gold-standard-whey.png', '/assets/img/products/proteins/on-gold-standard-facts.png', NULL, '4.9/5', TRUE, 'contain'),
  ('Creatina Dragon Pharma', 'Creatinas', 'Creatina monohidratada de 300 g para fuerza, potencia y rendimiento.', 12, 4, 35.00, '/assets/img/creatine-dragon-pharma.png', '/assets/img/products/creatines/dragon-pharma-facts.png', 'Promo', '4.9/5', TRUE, 'contain'),
  ('BPI Micronized Creatine 1 kg', 'Creatinas', 'Creatina micronizada importada, formato grande para uso prolongado.', 4, 3, 75.00, '/assets/img/products/creatines/bpi-micronized-creatine.png', '/assets/img/products/creatines/bpi-micronized-facts.png', NULL, '4.9/5', TRUE, 'contain'),
  ('Naturelo One Daily Women', 'Vitaminas y minerales', 'Multivitaminico diario para energia, defensas y bienestar femenino.', 10, 4, 32.00, '/assets/img/products/vitamins/naturelo-one-daily-women.png', '/assets/img/products/vitamins/naturelo-one-daily-women-facts.png', 'Nuevo', '4.8/5', TRUE, 'contain'),
  ('Animal Fury Blue Ice', 'Pre-entrenos', 'Pre-entreno de alta intensidad para energia, enfoque y bombeo muscular.', 6, 3, 42.00, '/assets/img/products/preworkouts/animal-fury-blue-ice.png', '/assets/img/products/preworkouts/animal-fury-blue-ice-facts.png', NULL, '4.8/5', TRUE, 'contain'),
  ('Promix Protein Puff Mint', 'Barras y snacks de proteina', 'Caja de 12 barras proteicas mint chocolate, 15 g de proteina por barra.', 12, 4, 38.00, '/assets/img/products/bars-snacks/promix-protein-puff-mint.png', '/assets/img/products/bars-snacks/promix-protein-puff-mint-facts.png', NULL, '4.8/5', TRUE, 'contain')
ON CONFLICT (name) DO UPDATE SET
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  stock = EXCLUDED.stock,
  min_stock = EXCLUDED.min_stock,
  price = EXCLUDED.price,
  image_url = EXCLUDED.image_url,
  facts_image_url = EXCLUDED.facts_image_url,
  discount = EXCLUDED.discount,
  rating = EXCLUDED.rating,
  visible_in_store = EXCLUDED.visible_in_store,
  updated_at = NOW();

INSERT INTO machines (name, type, location, status, maintenance_date, image_url, observations) VALUES
  ('Prensa inclinada', 'Maquina de fuerza', 'Zona inferior', 'Operativa', '2026-07-15', 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1000&q=80', 'Equipo principal para pierna'),
  ('Polea crossover', 'Multiestacion', 'Zona funcional', 'Operativa', '2026-06-28', 'https://images.unsplash.com/photo-1540497077202-7c8a3999166f?auto=format&fit=crop&w=1000&q=80', 'Revisar cables cada semana'),
  ('Caminadora profesional', 'Cardio', 'Zona cardio', 'Mantenimiento', '2026-06-20', 'https://images.unsplash.com/photo-1576678927484-cc907957088c?auto=format&fit=crop&w=1000&q=80', 'Requiere ajuste de banda'),
  ('Bicicleta de spinning', 'Cardio indoor', 'Sala de cycling', 'Operativa', '2026-07-22', 'https://images.unsplash.com/photo-1599058917212-d750089bc07e?auto=format&fit=crop&w=1000&q=80', 'Clase grupal'),
  ('Maquina Smith', 'Fuerza guiada', 'Zona de peso libre', 'Operativa', '2026-08-05', 'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?auto=format&fit=crop&w=1000&q=80', 'Lubricar guias'),
  ('Remo sentado', 'Fuerza selectorizada', 'Zona superior', 'Fuera de servicio', '2026-06-19', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=1000&q=80', 'Cable danado')
ON CONFLICT (name) DO UPDATE SET
  type = EXCLUDED.type,
  location = EXCLUDED.location,
  status = EXCLUDED.status,
  maintenance_date = EXCLUDED.maintenance_date,
  image_url = EXCLUDED.image_url,
  observations = EXCLUDED.observations,
  updated_at = NOW();

INSERT INTO gym_settings (key, value) VALUES
  ('gym', '{
    "name": "WX GYM",
    "sector": "",
    "city": "Quito",
    "address": "Quito, Ecuador",
    "phone": "0969953775",
    "email": "contacto@wxgym.local",
    "openingHours": "Lunes a sabado 05:30 - 22:00",
    "currency": "USD"
  }'::jsonb),
  ('admin', '{
    "name": "Mateo Admin",
    "email": "admin@wxgym.local",
    "role": "ADMIN",
    "backupEnabled": true,
    "alertasCriticas": true
  }'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
