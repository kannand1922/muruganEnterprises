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

Runs on:

```text
http://localhost:4000
https://localhost:4010
```

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

Runs on:

```text
http://localhost:5175
https://localhost:5176
```

For phone Chrome camera testing, open the HTTPS frontend on LAN:

```text
https://<your-laptop-ip>:5176
```

Notes:
- If `stocklens-new/certs/dev-cert.pem` and `stocklens-new/certs/dev-key.pem` exist, Vite uses them.
- If those files do not exist, it falls back to an auto-generated self-signed cert.
- For mobile Chrome camera access on another device, trusted certs are recommended.
- Frontend HTTP dev uses port `5175`.
- Frontend HTTPS dev uses port `5176`.
- Frontend requests to `/new/api` are proxied to the local backend at `http://localhost:4000` by default. You can override that with `BACKEND_PROXY_TARGET`.

### Optional: HTTPS backend

The backend now supports HTTPS too automatically.

Backend dev port:
- HTTP: `4000`
- HTTPS: `4010`

HTTPS cert behavior:
1. `SERVER_SSL_CERT_FILE` and `SERVER_SSL_KEY_FILE`
2. `stocklens-new/certs/dev-cert.pem` and `stocklens-new/certs/dev-key.pem`
3. `server/certs/dev-cert.pem` and `server/certs/dev-key.pem`
4. if none exist, it auto-generates a self-signed dev certificate

Run backend:

```bash
cd server
npm run dev
```

If certs are found, it will also expose:

```text
https://<your-laptop-ip>:4010
```

Example trusted cert setup with `mkcert` on Mac:

```bash
brew install mkcert
mkcert -install
cd stocklens-new
mkdir -p certs
mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem localhost 127.0.0.1 ::1 <your-laptop-ip>
```

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
