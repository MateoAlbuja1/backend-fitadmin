CREATE OR REPLACE VIEW clientes_formulario AS
SELECT
  c.id AS id_cliente,
  c.name AS nombre_completo,
  c.document AS cedula,
  c.phone AS telefono,
  c.email AS correo,
  c.address AS direccion,
  c.birth_date AS fecha_nacimiento,
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
) plan_actual ON TRUE;

CREATE OR REPLACE VIEW cuentas_y_clientes AS
SELECT
  u.id AS id_cuenta,
  u.username AS usuario,
  u.email AS correo_login,
  u.full_name AS nombre_cuenta,
  r.name AS rol,
  u.active AS cuenta_activa,
  u.client_id AS id_cliente_vinculado,
  c.name AS nombre_cliente,
  c.document AS cedula_cliente,
  c.phone AS telefono_cliente,
  u.created_at AS cuenta_creada_en,
  u.last_login_at AS ultimo_ingreso
FROM users u
JOIN roles r ON r.id = u.role_id
LEFT JOIN clients c ON c.id = u.client_id;
