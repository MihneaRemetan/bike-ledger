# BikeLedger

[![CI](https://github.com/MihneaRemetan/bike-ledger/actions/workflows/ci.yml/badge.svg)](https://github.com/MihneaRemetan/bike-ledger/actions/workflows/ci.yml)

A maintenance ledger for bicycles. Log your bikes, the parts mounted on them, your rides and your services, and BikeLedger **computes how worn every component is** from the rides done while it was mounted. It warns you before a part reaches its limit, **predicts the date it will**, reminds you of recurring maintenance and keeps track of what it all costs.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/dashboard.png" alt="Dashboard"><br><sub><b>Dashboard</b>: totals, kilometres per month, maintenance due</sub></td>
    <td width="50%"><img src="docs/screenshots/buy-menu.png" alt="Wear alerts with forecast and buy menu"><br><sub><b>Wear alerts</b> with the expected limit date, and a menu to find a replacement</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/bike-components.png" alt="Bike page with parts"><br><sub><b>Bike page</b>: parts with wear, forecast, history, move and replace</sub></td>
    <td><img src="docs/screenshots/maintenance.png" alt="Maintenance schedule"><br><sub><b>Maintenance schedule</b>: rules by distance and time, "Done" restarts the counter</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/map-shops.jpg" alt="Route map with bike shops"><br><sub><b>Map</b>: every imported route, plus bike shops nearby</sub></td>
    <td><img src="docs/screenshots/heatmap.jpg" alt="Heatmap of all rides"><br><sub><b>Heatmap</b>: the more often you rode a street, the brighter it is</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/statistics.png" alt="Statistics"><br><sub><b>Statistics</b>: yearly report, records, cost per km of each part</sub></td>
    <td><img src="docs/screenshots/dashboard-dark.png" alt="Dark mode"><br><sub><b>Dark mode</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/landing.jpg" alt="Landing page"><br><sub><b>Landing page</b></sub></td>
    <td><img src="docs/screenshots/data.png" alt="Data export and import"><br><sub><b>Data</b>: JSON backup, CSV export, import</sub></td>
  </tr>
</table>

## Features

**Wear and parts**
- **Automatic wear**: never stored, computed on every read from the rides on the bike while the part was mounted (see [How it works](#how-it-works)).
- **Replacement date forecast**: at the bike's pace of the last 90 days, "limit expected 15 Oct 2026 (in 13 days)".
- **Part history across bikes**: move a part to another bike on a date; its wear adds up the km from every bike it has been on.
- **Replacement workflow**: a replacement service retires the old part and, optionally, mounts a new one of the same type, in one transaction.
- **Buy a replacement**: a cart button on each part opens searches for it (Google Shopping, Amazon, eBay, eMAG), built from its brand and model, plus a shortcut to bike shops nearby. Plain search links; nothing is sent anywhere until you click.

**Maintenance**
- **Maintenance schedule**: recurring rules per bike ("clean the chain every 300 km", "inspection once a year"), by distance and/or days, with expected due dates. "Done" logs the service and restarts the counter. Due and overdue rules appear on the dashboard. Suggested rules in one click.
- **Services and costs**: cleanings, repairs, adjustments and replacements, with costs; cost per km per bike and per part.

**Rides and maps**
- **GPX / TCX import**: upload a `.gpx`, `.tcx` or gzipped file (for example a Strava "Export GPX"), preview distance, moving time and elevation, then save. Pauses are not counted as riding time.
- **Route map and heatmap**: every imported ride keeps a simplified GPS track, drawn on a map by bike or as a Strava-style heatmap where the streets you rode most often are the brightest. Routes can be shown or hidden, and the heatmap has its own light and dark palettes.
- **Nearby bike shops**: shops and repair workshops around the map area or your location (OpenStreetMap data), with opening hours, website and directions. Drag the search point to look elsewhere.

**Insight and data**
- **Dashboard**: totals, kilometres per month, maintenance due and wear alerts; a first-run checklist for new accounts.
- **Statistics**: yearly report (distance, time, elevation, average speed, costs), per-bike figures, records and the cost per km of each part.
- **Export and import**: everything as JSON (optionally with GPS tracks) or each table as CSV; import a JSON backup into any account.

**Platform**
- JWT authentication; every user only sees their own data (other users' resources answer `404`).
- Dark mode, responsive layout, Swagger UI at `/api/docs`, versioned SQL migrations, over 580 automated tests.

## Stack

React 19 + Vite, MUI, `@mui/x-charts`, Leaflet · Node 22 + Express 4 · PostgreSQL 16 (`pg`, raw SQL, no ORM) · Zod · JWT + bcryptjs · multer · fast-xml-parser · `node:test` + supertest · Vitest + Testing Library · Docker Compose + nginx · GitHub Actions.

## Quick start (Docker)

```bash
docker compose up --build                  # app: http://localhost:8080 · API docs: http://localhost:3000/api/docs
docker compose exec backend npm run seed   # demo data
```

Demo login: `demo@bikeledger.app` / `demo1234`. The demo has two bikes with a year of rides along real roads around Timisoara, parts in every wear state, a part that moved between bikes and maintenance rules in every state.

Optionally copy `.env.example` to `.env` to set `POSTGRES_*` and `JWT_SECRET`; defaults work for local use only.

## Local development (no Docker for the app)

```bash
docker compose up -d db                      # Postgres on 127.0.0.1:5432
cd backend && npm install && npm run dev     # API on :3000 (runs migrations on start)
npm run seed                                 # optional demo data
cd ../frontend && npm install && npm run dev # UI on :5173, proxies /api to :3000
```

## How it works

### Wear

```
wear_km = initial_km + SUM(ride.distance_km)
  for rides on a bike the part was mounted on, on a day inside that mount
    mount.from_date <= ride.date < mount.to_date        (open mounts have no end)
    and ride.date < component.retired_at                (if retired)
```

A part has one mount per bike it has been on (`component_mounts`). The end of a mount and the retirement day are exclusive, so a ride on the day of a swap or a move counts for the new part only. Status: `RETIRED` if retired, `REPLACE` at >= 100%, `WARN` at >= 80%, otherwise `OK`, using the percentage rounded to 0.1%.

### Forecast

```
pace      = km ridden on the part's current bike in the last 90 days / 90
days_left = ceil((max_km - wear_km) / pace)
date      = today + days_left
```

A bike with less than 90 days of history is judged over its own history, but at least 14 days. Rides in the future are ignored. With no recent rides there is no date ("No recent rides to estimate"), and beyond ten years it says the limit is far away. It is an estimate: it assumes the next weeks look like the last ones.

### Maintenance rules

A rule says "do this every N km and/or every N days". Its counters start at the latest service of the rule's type on that bike (on that part, if the rule is about one part) or at the rule's start date. `km since` is the sum of the bike's rides from that day on; `days since` is the calendar gap. The rule is `DUE` from 80% of either limit, `OVERDUE` from 100%, and `PAUSED` when its part is retired. The expected date is the earlier of the day limit and the distance limit at the recent pace.

## Database

```mermaid
erDiagram
  USERS ||--o{ BIKES : owns
  BIKES ||--o{ COMPONENTS : has
  BIKES ||--o{ RIDES : has
  BIKES ||--o{ SERVICES : has
  RIDES |o--o| RIDE_TRACKS : "GPS track"
  COMPONENTS ||--o{ COMPONENT_MOUNTS : "mounted on"
  BIKES ||--o{ COMPONENT_MOUNTS : hosts
  BIKES ||--o{ MAINTENANCE_RULES : has
  COMPONENTS |o--o{ SERVICES : "serviced in"
  USERS { int id PK  string email UK }
  BIKES { int id PK  string name  string type  int year }
  COMPONENTS { int id PK  string type  date installed_at  date retired_at  float initial_km  float max_km  float price }
  RIDES { int id PK  timestamptz date  float distance_km  int duration_min  int elevation_m  string source }
  SERVICES { int id PK  date date  string type  float cost }
  RIDE_TRACKS { int ride_id PK  jsonb points }
  COMPONENT_MOUNTS { int id PK  date from_date  date to_date }
  MAINTENANCE_RULES { int id PK  string title  string service_type  float every_km  int every_days  date start_date }
```

Migrations in `backend/src/db/migrations` are applied automatically on server start (`npm run migrate` to run them manually).

## API

Base `/api`; everything except auth, health and docs needs `Authorization: Bearer <token>`. Full spec: Swagger at `/api/docs`.

| Resource | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Bikes | `GET/POST /bikes`, `GET/PUT/DELETE /bikes/:id` |
| Components | `GET /components/defaults`, `GET/POST /components`, `GET/PUT/DELETE /components/:id` |
| Rides | `GET/POST /rides`, `GET /rides/routes`, `POST /rides/import-gpx`, `GET/PUT/DELETE /rides/:id` |
| Services | `GET/POST /services`, `GET/PUT/DELETE /services/:id` |
| Maintenance | `GET/POST /maintenance/rules`, `GET/PUT/DELETE /maintenance/rules/:id`, `POST /maintenance/rules/:id/complete`, `POST /maintenance/suggested` |
| Part moves | `POST /components/:id/move` |
| Data | `GET /data/export`, `GET /data/export/{bikes,components,rides,services,rules}.csv`, `POST /data/import` |
| Stats | `GET /stats/dashboard`, `GET /stats/overview?year=` |
| Places | `GET /places/bike-shops?lat=&lon=&radiusKm=` |
| System | `GET /health`, `GET /docs` |

## Tests

Both halves have automated tests. Run them before committing.

**Backend** (`node:test` + supertest, on a real PostgreSQL; 213 tests). They create their own users and clean up after themselves.

```bash
docker compose up -d db
cd backend
DATABASE_URL=postgresql://bikeledger:bikeledger@localhost:5432/bikeledger npm test
DATABASE_URL=postgresql://bikeledger:bikeledger@localhost:5432/bikeledger npm run test:coverage   # with a coverage table
```

What they cover: every endpoint (auth, bikes, components, rides, services, maintenance rules, data export/import, stats, places), validation and error codes, per-user data isolation, the wear calculation and its boundaries, the REPLACE transaction and its rollback, GPX/TCX/gzip import and the route map data, bike-shop search (with the OpenStreetMap service mocked), the database layer (migrations, constraints, transactions), configuration, the seed script, and that every route is documented in the OpenAPI spec.

**Frontend** (Vitest + React Testing Library + jsdom; 398 tests). The API is mocked, so no server is needed.

```bash
cd frontend
npm test                # run once
npm run test:watch      # re-run on change
npm run test:coverage   # with a coverage table (HTML report in frontend/coverage)
```

What they cover: formatting and helpers, the API client (tokens, errors, 401 handling), authentication and colour mode, every reusable component (form dialog, wear bar, layout...), every page (landing, login/register, dashboard and the first-run checklist, bikes, bike detail with its maintenance schedule, components with move and history, rides, services, statistics, data export/import, map with routes and nearby bike shops) and the routing/access rules.

## Project structure

```
backend/
  src/routes/      Express routers (auth, bikes, components, rides, services, maintenance, stats, data, places)
  src/lib/         wear, forecast, maintenance, GPX/TCX parsing, CSV, OpenStreetMap client, validation schemas
  src/db/          pool, migrations (001-003), seed and the demo routes
  test/            integration and unit tests
frontend/
  src/pages/       one file per screen
  src/components/  reusable pieces (form dialog, wear bar, maintenance section, buy menu...)
  src/lib/         formatting, constants, shopping links
  src/__tests__/   Vitest + Testing Library tests
docs/screenshots/  images used in this README
.github/workflows/ CI: backend tests, frontend tests and build, Docker build
docker-compose.yml db + backend + frontend (nginx)
```

## Credits and data

- Map data and tiles: [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Nearby shops come from the public Overpass API; the demo routes were generated once with the OpenStreetMap bike router.
- Photos on the landing, login and welcome screens: Axel Brunst, Rille Camera Strap and Ben Guernsey on [Unsplash](https://unsplash.com), and a photo on [Pexels](https://www.pexels.com/photo/bikers-riding-their-road-bikes-12266469/).
- Brand names in the demo data are used only to identify products.
