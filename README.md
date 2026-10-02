# BikeLedger

A maintenance ledger for bicycles. Add your bikes, the parts mounted on them, your rides and your services; BikeLedger **computes component wear automatically** from the rides logged while each part was mounted, warns you at 80% / 100% of the km limit and tracks maintenance costs.

<!-- Screenshots: docs/screenshots/dashboard.png, bike-detail.png, ... -->

## Features

- **Automatic wear calculation**: never stored, computed on every read (see [Wear formula](#wear-formula)). Adding, editing or deleting a ride updates affected parts immediately.
- **Replacement workflow**: a `REPLACE` service retires the old part and, optionally, mounts a new one of the same type, in a single transaction.
- **GPX import**: upload a `.gpx` file, preview distance / duration / elevation gain, then save as a ride.
- Four entities with full CRUD (bikes, components, rides, services), dashboard with monthly km chart and wear alerts.
- JWT authentication; users only ever see their own data (other users' resources answer `404`).
- Swagger UI at `/api/docs`.

## Stack

React 19 + Vite, MUI, `@mui/x-charts` · Node 22 + Express 4 · PostgreSQL 16 (`pg`, raw SQL) · Zod · JWT + bcryptjs · multer · fast-xml-parser · `node:test` + supertest · Docker Compose + nginx.

## Quick start (Docker)

```bash
docker compose up --build                  # app: http://localhost:8080 · API docs: http://localhost:3000/api/docs
docker compose exec backend npm run seed   # demo data
```

Demo login: `demo@bikeledger.app` / `demo1234`

Optionally copy `.env.example` to `.env` to set `POSTGRES_*` and `JWT_SECRET`; defaults work for local use only.

## Local development (no Docker for the app)

```bash
docker compose up -d db                      # Postgres on 127.0.0.1:5432
cd backend && npm install && npm run dev     # API on :3000 (runs migrations on start)
npm run seed                                 # optional demo data
cd ../frontend && npm install && npm run dev # UI on :5173, proxies /api to :3000
```

## Database

```mermaid
erDiagram
  USERS ||--o{ BIKES : owns
  BIKES ||--o{ COMPONENTS : has
  BIKES ||--o{ RIDES : has
  BIKES ||--o{ SERVICES : has
  COMPONENTS |o--o{ SERVICES : "serviced in"
  USERS { int id PK  string email UK }
  BIKES { int id PK  string name  string type  int year }
  COMPONENTS { int id PK  string type  date installed_at  date retired_at  float initial_km  float max_km  float price }
  RIDES { int id PK  timestamptz date  float distance_km  int duration_min  int elevation_m  string source }
  SERVICES { int id PK  date date  string type  float cost }
```

Migrations in `backend/src/db/migrations` are applied automatically on server start (`npm run migrate` to run them manually).

## API

Base `/api`; everything except auth, health and docs needs `Authorization: Bearer <token>`. Full spec: Swagger at `/api/docs`.

| Resource | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Bikes | `GET/POST /bikes`, `GET/PUT/DELETE /bikes/:id` |
| Components | `GET /components/defaults`, `GET/POST /components`, `GET/PUT/DELETE /components/:id` |
| Rides | `GET/POST /rides`, `POST /rides/import-gpx`, `GET/PUT/DELETE /rides/:id` |
| Services | `GET/POST /services`, `GET/PUT/DELETE /services/:id` |
| Stats | `GET /stats/dashboard` |
| System | `GET /health`, `GET /docs` |

## Wear formula

```
wear_km = initial_km + SUM(ride.distance_km)
  for rides on the same bike where
    ride.date >= component.installed_at
    AND (component.retired_at IS NULL OR ride.date < component.retired_at)
```

Status: `RETIRED` if retired, `REPLACE` at ≥ 100%, `WARN` at ≥ 80%, otherwise `OK`. The retirement comparison is strict, so a ride on the day of a swap counts only for the new part.

## Tests

Tests run against a real PostgreSQL (they create unique users and clean up):

```bash
docker compose up -d db
cd backend && DATABASE_URL=postgresql://bikeledger:bikeledger@localhost:5432/bikeledger npm test
```

## Project structure

```
backend/   Express API (src/routes, src/lib, src/db, test/)
frontend/  React app (src/pages, src/components, src/api, src/lib)
docker-compose.yml  db + backend + frontend (nginx)
```
