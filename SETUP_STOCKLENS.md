# StockLens Setup (From Scratch)

This setup is for the new stack in this repo:
- Backend: `server/server.js`
- Scanner API module: `server/server-scanner`
- Frontend: `stocklens-new`
- SQLite DB: `shared/data/stock/stocklens_prisma.sqlite`

## 1) Prerequisites

- Node.js 20+ (LTS)
- npm
- Git

Check:

```bash
node -v
npm -v
git --version
```

## 2) Install Dependencies

From repo root:

```bash
cd server
npm install

cd server-scanner
npm install

cd ../../stocklens-new
npm install
```

## 3) Environment Setup

### Scanner backend env

No scanner `.env` setup is required for database configuration now. The scanner database path is hardcoded in `server/server-scanner/prisma/schema.prisma`.

### Frontend env

```bash
cd ../../stocklens-new
cp .env.example .env
```

Set `stocklens-new/.env`:

```env
VITE_API_BASE_URL=http://localhost:3100/new/api
```

## 4) Prisma + Database

Go to scanner folder:

```bash
cd ../server/server-scanner
```

Generate Prisma client:

```bash
npx prisma generate
```

Sync schema to DB:

```bash
npx prisma db push
```

Optional (if you use migrations):

```bash
npx prisma migrate dev --name init
```

## 5) Schema Change Workflow

1. Edit `server/server-scanner/prisma/schema.prisma`
2. Run:
   - `npx prisma migrate dev --name your_change_name` (migration flow)
   - or `npx prisma db push` (direct dev sync)
3. Run `npx prisma generate`
4. Restart backend

## 6) Run App

Use two terminals.

### Terminal 1 (backend)

```bash
cd server
npm run dev
```

Runs on `http://localhost:3100`.

### Optional: Auto-restart backend on crash (1s) + on file change

Use PM2 for crash recovery:

```bash
cd server
npm install
npm run pm2:start
```

This PM2 config also watches backend files and auto-restarts when code/config changes.

Useful PM2 commands:

```bash
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
```

### Terminal 2 (frontend)

```bash
cd stocklens-new
npm run dev
```

Runs on `http://localhost:5175`.

## 7) Health Checks

```bash
curl http://localhost:3100/new/health
curl http://localhost:3100/new/api/meta/setup
```

Expected health:

```json
{"ok":true,"db":"connected"}
```

## 8) SQLite Viewer Path

Use this file:

`shared/data/stock/stocklens_prisma.sqlite`

## 9) Printer Notes

- Printer records are in DB table `printers`.
- Printer IP must be valid IPv4/IPv6 format.
- Invalid values like `1111111` are rejected.
- Default raw printer port is `9100`.
- Receipts are saved in: `shared/data/receipts/stocklens`

## 10) Common Problems

### Print says `fetch failed` or print fails

Check:
- backend is running on `3100`
- `PRINTER_SERVICE_URL=http://localhost:3100`
- printer IP is valid and reachable on network

### Prisma drift warning

Use:

```bash
npx prisma db push
```

If you intentionally want reset:

```bash
npx prisma migrate reset
```

### Frontend calling wrong backend

- ensure `stocklens-new/.env` has `VITE_API_BASE_URL=http://localhost:3100/new/api`
- clear app local storage backend override if set




cd /Users/apple/Documents/project/stocklens-new

npm install -D @capacitor/cli @capacitor/android
npm install

npm run build
# Run this only the first time, when `android/` does not exist yet:
# npx cap add android
npx cap sync android
npx cap open android
