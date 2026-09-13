INSERT INTO gym_settings (key, value) VALUES
  ('gym', '{
    "name": "GX GYM",
    "sector": "",
    "city": "Quito",
    "address": "Quito, Ecuador",
    "phone": "0969953775",
    "email": "contacto@gxgym.local",
    "openingHours": "Lunes a Sabado 06:00 - 22:00",
    "currency": "USD",
    "schedules": [
      { "dia": "Lunes", "apertura": "06:00", "cierre": "22:00", "activo": true },
      { "dia": "Martes", "apertura": "06:00", "cierre": "22:00", "activo": true },
      { "dia": "Miercoles", "apertura": "06:00", "cierre": "22:00", "activo": true },
      { "dia": "Jueves", "apertura": "06:00", "cierre": "22:00", "activo": true },
      { "dia": "Viernes", "apertura": "06:00", "cierre": "22:00", "activo": true },
      { "dia": "Sabado", "apertura": "08:00", "cierre": "16:00", "activo": true },
      { "dia": "Domingo", "apertura": "08:00", "cierre": "13:00", "activo": false }
    ]
  }'::jsonb),
  ('admin', '{
    "name": "Mateo Admin",
    "role": "Administrador",
    "username": "admin",
    "email": "admin@gxgym.local",
    "backupEnabled": true,
    "alertasCriticas": true,
    "security": {
      "twoFactor": false,
      "sessionLock": true,
      "automaticBackups": true,
      "criticalAlerts": true
    }
  }'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  value = gym_settings.value || EXCLUDED.value,
  updated_at = NOW();
