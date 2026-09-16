# WX GYM Backend

Backend en arquitectura de microservicios para WX GYM.

## Arquitectura

- `api-gateway`: entrada publica para Angular. Puerto publicado `3000`.
- `auth-service`: registro, login, JWT, bcrypt y perfil. Puerto interno `3001`.
- `gym-service`: clientes, planes, membresias, asistencia, pagos, dashboard, configuracion y endpoints de cliente. Puerto interno `3002`.
- `inventory-service`: suplementos, tienda publica y maquinas. Puerto interno `3003`.
- `report-service`: reportes, alertas y documentos flexibles en MongoDB. Puerto interno `3004`.
- `postgres`: datos relacionales. Puerto interno `5432`.
- `mongo`: reportes, alertas, logs, historial, auditoria y eventos. Puerto interno `27017`.

## Requisitos

- Docker
- Docker Compose

## Configuracion

1. Copia el archivo de ejemplo:

```bash
cp .env.example .env
```

2. Ajusta las variables sensibles antes de usar en produccion.

Variables principales:

- `JWT_SECRET`: llave privada para firmar los tokens de sesion.
- `DATABASE_URL`: conexion a PostgreSQL, donde se guardan usuarios, clientes, membresias, pagos, inventario y pedidos.
- `MONGO_URL`: conexion a MongoDB, usado por reportes, alertas, logs, auditoria y eventos.
- `PAYPAL_CLIENT_ID`: identificador publico de la aplicacion PayPal.
- `PAYPAL_CLIENT_SECRET`: clave privada de la aplicacion PayPal.
- `CORS_ORIGIN`: dominio del frontend autorizado para consumir el backend.

Para produccion se puede partir de:

```bash
cp .env.production.example .env
```

Importante: el archivo `.env` no debe subirse a GitHub porque contiene credenciales reales.

En produccion solo se debe publicar el `api-gateway` o el reverse proxy. PostgreSQL, MongoDB y los microservicios quedan expuestos solo dentro de la red de Docker.

El usuario inicial se crea automaticamente al iniciar `auth-service`:

- Usuario: `admin`
- Contrasena: `admin`
- Rol: `ADMIN`

## Levantar todo

Desde `C:\Users\Mateo\Documents\fitadmin\backend-fitadmin`:

```bash
docker compose up --build
```

El API Gateway queda disponible en:

```text
http://localhost:3000
```

Angular debe consumir ese gateway. El frontend ya apunta a `http://localhost:3000`.

## Migraciones y datos iniciales

PostgreSQL ejecuta automaticamente:

```text
database/postgres/migrations/001_init.sql
```

Ese archivo crea tablas, indices y datos iniciales:

- Roles `ADMIN`, `RECEPCION`, `CLIENTE`
- Planes `Diario`, `Mensual`, `Trimestral`, `Anual`
- Clientes de prueba
- Membresias, asistencias y pagos
- Suplementos visibles para tienda
- Maquinas internas
- Configuracion inicial de WX GYM

MongoDB ejecuta:

```text
database/mongo/init/001_init.js
```

Crea colecciones base:

- `reports`
- `alerts`
- `logs`
- `inventory_history`
- `audit_changes`
- `system_events`

## Probar endpoints

Health del gateway:

```bash
curl http://localhost:3000/health
```

Login:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"admin\"}"
```

Listar clientes:

```bash
curl http://localhost:3000/clients
```

Crear cliente:

```bash
curl -X POST http://localhost:3000/clients \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Cliente Demo\",\"document\":\"1799999999\",\"phone\":\"0999999999\"}"
```

Registrar asistencia:

```bash
curl -X POST http://localhost:3000/attendance/check-in \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"1723456789\"}"
```

Tienda publica:

```bash
curl http://localhost:3000/public/supplements
```

Crear suplemento:

```bash
curl -X POST http://localhost:3000/inventory/supplements \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Creatina Demo\",\"category\":\"Creatinas\",\"price\":30,\"stock\":10,\"minStock\":3,\"description\":\"Producto demo\",\"visibleEnTienda\":true}"
```

Alertas:

```bash
curl http://localhost:3000/alerts
```

Generar reporte:

```bash
curl -X POST http://localhost:3000/reports/generate \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"sales\",\"from\":\"2026-06-01\",\"to\":\"2026-07-31\"}"
```

## Endpoints principales

Autenticacion:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/users` (solo `ADMIN`)
- `GET /auth/profile`
- `POST /auth/logout`

Clientes:

- `GET /clients`
- `GET /clients/:id`
- `POST /clients`
- `PUT /clients/:id`
- `DELETE /clients/:id`

Membresias:

- `GET /plans`
- `GET /public/plans`
- `GET /memberships`
- `GET /memberships/:id`
- `POST /memberships`
- `PUT /memberships/:id`
- `DELETE /memberships/:id`
- `PATCH /memberships/:id/renew`
- `GET /memberships/alerts/expiring`

Asistencia:

- `GET /attendance`
- `POST /attendance/check-in`
- `GET /attendance/client/:clientId`
- `GET /attendance/date/:date`

Pagos:

- `GET /payments`
- `GET /payments/:id`
- `POST /payments`
- `PUT /payments/:id`
- `DELETE /payments/:id`
- `PATCH /payments/:id/status`

Inventario:

- `GET /inventory/supplements`
- `GET /inventory/supplements/:id`
- `GET /inventory/supplements/store`
- `GET /public/supplements`
- `POST /inventory/supplements`
- `PUT /inventory/supplements/:id`
- `DELETE /inventory/supplements/:id`
- `PATCH /inventory/supplements/:id/stock`
- `GET /inventory/machines`
- `GET /inventory/machines/:id`
- `POST /inventory/machines`
- `PUT /inventory/machines/:id`
- `DELETE /inventory/machines/:id`
- `PATCH /inventory/machines/:id/status`

Reportes y alertas:

- `GET /reports`
- `POST /reports/generate`
- `GET /reports/:id`
- `DELETE /reports/:id`
- `GET /alerts`
- `POST /alerts`
- `PATCH /alerts/:id/read`
- `DELETE /alerts/:id`

Dashboard:

- `GET /dashboard/summary`
- `GET /dashboard/sales`
- `GET /dashboard/attendance`
- `GET /dashboard/memberships`
- `GET /dashboard/inventory-alerts`

Configuracion:

- `GET /settings/gym`
- `PUT /settings/gym`
- `GET /settings/admin`
- `PUT /settings/admin`
- `POST /settings/backup`

Cliente:

- `GET /client/profile`
- `GET /client/membership`
- `GET /client/payments`
- `GET /client/attendance`

## Conexion con Angular

El frontend en `fit-admin` ya tiene:

- `provideHttpClient(withFetch())`
- Login real contra `POST /auth/login`
- Registro real contra `POST /auth/register`
- Carga inicial de clientes, membresias, asistencia, pagos, suplementos, maquinas y alertas desde el gateway
- Escritura real para clientes, asistencia, pagos, suplementos, maquinas y renovacion de membresias

Para probarlo:

1. Levanta el backend con `docker compose up --build`.
2. Levanta Angular desde `C:\Users\Mateo\Documents\fitadmin\fit-admin`:

```bash
npm run start
```

3. Entra al frontend y usa `admin / admin`.

## Despliegue en servidor

El despliegue productivo esperado usa dos repos clonados como carpetas hermanas:

```text
~/fitadmin/backend-fitadmin
~/fitadmin/fit-admin
```

En un servidor Ubuntu con Docker instalado:

```bash
mkdir -p ~/fitadmin
cd ~/fitadmin
git clone https://github.com/MateoAlbuja1/backend-fitadmin.git
git clone https://github.com/MateoAlbuja1/fit-admin.git
```

Configura variables reales:

```bash
cd ~/fitadmin/backend-fitadmin
cp .env.production.example .env
nano .env
```

Variables obligatorias antes de levantar:

- `FRONTEND_DOMAIN`: dominio del frontend, por ejemplo `fitadmin.duckdns.org`.
- `API_DOMAIN`: dominio del API, por ejemplo `fitadmin-api.duckdns.org`.
- `FITADMIN_API_URL`: URL completa del API, por ejemplo `https://fitadmin-api.duckdns.org`.
- `CORS_ORIGIN`: origen autorizado del frontend, por ejemplo `https://fitadmin.duckdns.org`.
- `JWT_SECRET`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, `MONGO_INITDB_ROOT_PASSWORD`: secretos fuertes y unicos.
- `DATABASE_URL` y `MONGO_URL`: deben usar las mismas contrasenas definidas arriba.

Levanta todo con HTTPS automatico mediante Caddy:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Verifica estado:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f caddy
```

En produccion Caddy publica solo `80` y `443`. El frontend, gateway, microservicios, PostgreSQL y MongoDB quedan internos en Docker.

Para actualizar despues de hacer cambios:

```bash
cd ~/fitadmin/fit-admin && git pull
cd ~/fitadmin/backend-fitadmin && git pull
docker compose -f docker-compose.prod.yml up -d --build --force-recreate
```
