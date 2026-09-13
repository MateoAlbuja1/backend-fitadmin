UPDATE gym_settings
SET value = jsonb_set(value, '{name}', to_jsonb('GX GYM'::text), true)
WHERE key = 'gym'
  AND value->>'name' = 'WX GYM';

UPDATE gym_settings
SET value = jsonb_set(value, '{email}', to_jsonb('contacto@gxgym.local'::text), true)
WHERE key = 'gym'
  AND value->>'email' = 'contacto@wxgym.local';

UPDATE membership_plans
SET description = REPLACE(description, 'WX GYM', 'GX GYM')
WHERE description ILIKE '%WX GYM%';

UPDATE users
SET email = REPLACE(email, '@wxgym.local', '@gxgym.local'),
    updated_at = NOW()
WHERE email LIKE '%@wxgym.local';

UPDATE clients
SET email = REPLACE(email, '@wxgym.local', '@gxgym.local'),
    updated_at = NOW()
WHERE email LIKE '%@wxgym.local';

UPDATE store_orders
SET code = REGEXP_REPLACE(code, '^WX-', 'GX-'),
    updated_at = NOW()
WHERE code LIKE 'WX-%';
