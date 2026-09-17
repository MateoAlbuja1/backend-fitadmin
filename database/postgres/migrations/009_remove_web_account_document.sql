DROP VIEW IF EXISTS clientes_formulario;
DROP VIEW IF EXISTS cuentas_web;
DROP VIEW IF EXISTS cuentas_y_clientes;

DROP INDEX IF EXISTS idx_users_document_unique;
ALTER TABLE users DROP COLUMN IF EXISTS document;

CREATE OR REPLACE VIEW clientes_formulario AS
SELECT
  c.id AS id_cliente,
  c.name AS nombre_completo,
  c.document AS cedula,
  c.phone AS telefono,
  c.email AS correo,
  COALESCE(plan_actual.name, 'Sin membresia') AS plan_inicial_o_actual,
  c.status AS estado,
  c.notes AS notas
FROM clients c
LEFT JOIN LATERAL (
  SELECT p.name
  FROM memberships m
  JOIN membership_plans p ON p.id = m.plan_id
  WHERE m.client_id = c.id
  ORDER BY m.start_date DESC, m.id DESC
  LIMIT 1
) plan_actual ON TRUE
WHERE c.notes IS DISTINCT FROM 'Registro desde portal publico';

CREATE OR REPLACE VIEW cuentas_web AS
SELECT
  u.id AS id_cuenta,
  u.full_name AS nombre_completo,
  u.phone AS telefono,
  u.email AS correo,
  u.username AS usuario,
  u.active AS cuenta_activa,
  u.created_at AS fecha_registro,
  u.last_login_at AS ultimo_ingreso
FROM users u
JOIN roles r ON r.id = u.role_id
WHERE r.name = 'CLIENTE'
ORDER BY u.created_at DESC, u.id DESC;

CREATE OR REPLACE VIEW cuentas_y_clientes AS
SELECT
  u.id AS id_cuenta,
  u.username AS usuario,
  u.email AS correo_login,
  u.full_name AS nombre_cuenta,
  r.name AS rol,
  CASE
    WHEN r.name = 'CLIENTE' THEN 'Cuenta web'
    WHEN r.name = 'RECEPCION' THEN 'Personal recepcion'
    ELSE 'Administracion'
  END AS tipo_cuenta,
  u.active AS cuenta_activa,
  u.client_id AS id_cliente_vinculado,
  c.name AS nombre_cliente_admin,
  c.document AS cedula_cliente_admin,
  c.phone AS telefono_cliente_admin,
  u.created_at AS cuenta_creada_en,
  u.last_login_at AS ultimo_ingreso
FROM users u
JOIN roles r ON r.id = u.role_id
LEFT JOIN clients c ON c.id = u.client_id
ORDER BY u.created_at DESC, u.id DESC;
