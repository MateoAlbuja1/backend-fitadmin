UPDATE gym_settings
SET value = jsonb_set(
  jsonb_set(value, '{name}', to_jsonb('WX GYM'::text), true),
  '{phone}',
  to_jsonb('0969953775'::text),
  true
)
WHERE key = 'gym';

UPDATE gym_settings
SET value = jsonb_set(value, '{email}', to_jsonb('contacto@wxgym.local'::text), true)
WHERE key = 'gym';

UPDATE membership_plans
SET description = 'Acceso por un dia a WX GYM',
    updated_at = NOW()
WHERE name = 'Diario';

UPDATE users
SET email = REPLACE(email, '@gxgym.local', '@wxgym.local'),
    updated_at = NOW()
WHERE email LIKE '%@gxgym.local';

UPDATE clients
SET email = REPLACE(email, '@gxgym.local', '@wxgym.local'),
    updated_at = NOW()
WHERE email LIKE '%@gxgym.local';
