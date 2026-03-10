# StockLens New

`stocklens-new` is the new mobile-first StockLens app built with Ionic React, Vite, and Capacitor.

It is used for:

- starting and closing stock cycles
- scanning and saving stock entries
- finishing operator-wise stock differences
- reviewing nil, unchecked, verify, and fast-moving products
- printing stock reports
- configuring shop data, phones, printers, and low-stock alerts
- receiving low-stock push notifications on Android

## How The App Is Structured

The working setup has 3 parts:

1. `stocklens-new`
   The Ionic React frontend and Android app.

2. `server`
   The main backend entrypoint. This is the recommended backend to run for `stocklens-new`.
   It exposes:
   - `http://localhost:4000/new/api/*`
   - `http://localhost:4000/new/health`
   - printer routes
   - desktop compatibility routes

3. `server/server-scanner`
   The scanner API module used by `server`.
   You can run it directly for isolated API testing, but then the base URL changes to `http://localhost:3010/api`.

The shared SQLite database is stored at:

`shared/data/stock/stocklens_prisma.sqlite`

## Main Frontend Areas

- `src/pages`
  App screens and route-level pages.

- `src/api`
  API clients for cycles, stock, meta/settings, and common backend calls.

- `src/components`
  Reusable UI and low-stock components.

- `src/config`
  Local-storage config for backend URL, current phone, location, FCM mapping, and settings access.

- `src/services`
  Native integrations such as Firebase Cloud Messaging.

## App Routes

Main flows:

- `/dashboard`
  Opens the stock entry flow.

- `/cycles`
  Start and stop stock cycles.

- `/stock`
  Main stock entry page. Supports scan mode, barcode mode, and name search.

- `/stock/finish`
  Moves unfinished operator rows into finished stock.

- `/stock/nil`
  Shows NIL products for the configured NIL location.

- `/stock/fast-moving`
  Shows fast-moving scanned and unchecked products.

- `/stock/verify`
  Shows mismatched finished rows for verification.

- `/stock/unchecked`
  Shows products not yet scanned.

- `/stock/print`
  Prints stock and verification-related output.

- `/stock/low-stock`
  Low-stock product view by location.

Settings flows:

- `/settings`
  Settings home.

- `/settings/shop-info`
  Shop code, shop name, address, default notification location, NIL location.

- `/settings/shop-locations`
  Create and manage location records such as shop, godown, or other custom areas.

- `/settings/operators`
  Manage operator names used during stock work.

- `/settings/phones`
  Manage phone names and select the current device identity.

- `/settings/fcm`
  Generate and sync this Android device's FCM token.

- `/settings/best-selling`
  Mark best-selling products from the master list.

- `/settings/printers`
  Add and manage network printers.

- `/settings/low-stock-alerts`
  Entry point for thresholds, notification settings, and FCM mapping.

- `/settings/common-config`
  Change backend URL stored in local storage and check backend health.

## Prerequisites

- Node.js 20 or newer
- npm
- Android Studio for Android builds
- an Android device or emulator for native FCM and barcode scanning

Recommended checks:

```bash
node -v
npm -v
```

## Install Dependencies

From repo root:

```bash
cd server
npm install

cd server-scanner
npm install

cd ../../stocklens-new
npm install
```

## Environment Setup

Create frontend env:

```bash
cd stocklens-new
cp .env.example .env
```

For local development with the recommended backend:

```env
VITE_API_BASE_URL=http://localhost:4000/new/api
```

If you run `server/server-scanner` directly instead of `server/server.js`, use:

```env
VITE_API_BASE_URL=http://localhost:3010/api
```

Important:

- the app can override the backend URL from `Settings -> Common Configuration`
- that override is stored in local storage on the device/browser
- if requests go to the wrong backend, reset or update that stored URL

## Database Setup

The Prisma schema is in:

`server/server-scanner/prisma/schema.prisma`

Generate Prisma client and sync the schema:

```bash
cd server/server-scanner
npx prisma generate
npx prisma db push
```

If you intentionally use migrations:

```bash
npx prisma migrate dev --name init
```

## Recommended Local Run

Use 2 terminals.

### Terminal 1: backend

```bash
cd server
npm run dev
```

This runs the main backend on:

- `http://localhost:4000/new/health`
- `http://localhost:4000/new/api/*`

### Terminal 2: frontend

```bash
cd stocklens-new
npm run dev
```

This starts the Vite frontend for browser testing.

## Android App Setup

Build the web assets and sync Capacitor:

```bash
cd stocklens-new
npm run build

# first time only, if android/ does not exist yet
npx cap add android

npx cap sync android
npx cap open android
```

Android details:

- Capacitor app id: `com.stock.app`
- native barcode scanning and push notifications require the Android app, not browser mode

If you are testing on a physical Android phone, `localhost` will not point to your Mac.
Use your Mac's LAN IP in `Settings -> Common Configuration`, for example:

```text
http://192.168.x.x:4000/new/api
```

## Firebase / Push Notification Setup

This is required only for Android push notifications.

### Android app side

1. Create or open a Firebase project.
2. Add Android app package `com.stock.app`.
3. Download `google-services.json`.
4. Place it at:
   `stocklens-new/android/app/google-services.json`
5. Run:

```bash
npx cap sync android
```

### Backend side

The backend uses a Firebase service account JSON, not `google-services.json`.

Supported backend config:

- `FCM_SERVICE_ACCOUNT_PATH`
- `GOOGLE_APPLICATION_CREDENTIALS`
- or a local file at `server/server-scanner/firebase-service-account.json`

For the push test endpoint and service-account setup, see:

`server/server-scanner/docs/fcm-push-endpoint.md`

## First-Time App Setup

After the backend is running and the app opens, do the following in order.

1. `Settings -> Common Configuration`
   Confirm the backend URL points to the correct server.

2. `Settings -> Shop Info`
   Fill shop details and set the NIL location.

3. `Settings -> Shop Locations`
   Add the locations you want to track.

4. `Settings -> Operators`
   Add operator names used during stock entry and finish flow.

5. `Settings -> Phones`
   Add phone names and select the current phone.

6. `Settings -> Printers`
   Add thermal printers if printing is needed.

7. `Settings -> Best Selling`
   Mark fast-selling products if you use that flow.

8. `Settings -> Notification`
   Configure low-stock thresholds, notification behavior, and FCM mapping.

## What Each Setting Does

### Shop Info

Stores the main shop record:

- shop code and name
- area/city/state/pincode
- address lines
- NIL location
- default notification location for low-stock alerts

This page affects NIL product flow and the default location used by push notifications.

### Shop Locations

Defines physical or logical stock locations.

Each location can have:

- code
- name
- type
- color
- sort order
- low-stock notifications enabled or disabled

These locations are used across stock entry, low-stock pages, reports, and alert routing.

### Operators

Stores the people doing stock work.

Operators are used in:

- stock entry attribution
- finish unfinished flow
- operator-based difference and print reports

### Phones

Stores device identities such as `Counter Phone`, `Shop Phone`, or `Godown Phone`.

This page is important because:

- the current phone is stored locally on the device
- stock entries can be tagged to a phone
- low-stock push alerts can be turned on or off per phone

### FCM

Used only on Android native builds.

This page:

- generates or re-syncs the FCM token for the current device
- maps that token to the selected phone
- maps that token to one alert location
- lets you copy or clear the cached token

### Best Selling

Lets you select best-selling products from the master list.

This supports fast-moving related views and targeted workflows.

### Notification

This section groups low-stock alert setup into 3 parts:

- `Threshold Rules`
  defines when a product becomes low stock for a location

- `Notification Settings`
  review status, manually run checks, and inspect push history

- `FCM`
  sync this device token and map it to a location

### Printers

Stores printer name, IP address, and port.

Used by stock print pages and backend print endpoints.

### Common Configuration

Stores client-side app config in local storage:

- backend base URL
- connection check result

Use this page when the device should call a different backend than the `.env` default.

## How The Main Stock Flow Works

### 1. Cycle management

- open `Cycles`
- start a cycle
- one active cycle is used by the stock flows
- stop/close is blocked if unfinished or unmatched finished records still exist

### 2. Stock entry

The dashboard opens the stock entry page.

The page supports:

- scan mode using ML Kit barcode scanning
- barcode search mode
- name search mode

When a product is selected and saved:

- it is written to unfinished stock for the active cycle and location
- the current phone can be attached to that record
- progress and scanned summaries update on screen

### 3. Finish unfinished

Operator finish moves unfinished rows into finished stock.

This is used when operator totals or product differences need to be finalized.

### 4. Verification and unchecked

- `Verify` shows mismatched finished products
- `Unchecked` shows products that still need stock confirmation

These views help clean up the cycle before closing it.

### 5. NIL products

This screen depends on the NIL location configured in `Shop Info`.

It shows products that belong to the NIL workflow for that configured location.

### 6. Fast moving

This view focuses on fast-moving products and splits them into:

- scanned
- unchecked

### 7. Printing

Printing uses configured printers and backend print routes.

Used for:

- finishing reports
- verification output
- difference reports

## How Low-Stock Alerts Work

Low-stock alerts depend on:

1. shop locations existing
2. threshold rules being saved for each location
3. phones being configured
4. at least one Android device syncing its FCM token
5. backend Firebase credentials being valid

Typical flow:

1. create locations
2. enable low-stock notifications on required locations
3. set threshold rules
4. set current phone on the device
5. sync FCM token from `Settings -> FCM`
6. use `Notification Settings` to run a check and inspect results

## Settings Access

Settings are protected by a password screen.

The app first tries backend verification. A fallback safety password also exists in the frontend config for emergency use.

If settings unlock is failing:

- confirm the backend URL is correct
- confirm the backend is running
- confirm the configured settings password file is correct

## Useful URLs

Recommended backend:

- `http://localhost:4000/new/health`
- `http://localhost:4000/new/api/app/version`

Direct scanner backend:

- `http://localhost:3010/health`
- `http://localhost:3010/api/app/version`

## Common Problems

### App cannot reach backend

Check:

- backend is running
- the device/browser backend URL is correct
- for a real phone, do not use `localhost`; use your Mac LAN IP

### App is stuck on update required

The backend returns a required build number.

Check:

- app build is current
- backend required-build config is correct

### Barcode scan does not work in browser

Native scanning needs the Android app build.

Use:

```bash
npm run build
npx cap sync android
npx cap open android
```

### Push token does not generate

Check:

- app is running as Android native app
- `google-services.json` is present
- notification permission was granted
- the current phone is selected

### Push send fails

Check:

- backend service-account JSON is valid
- Android token belongs to the same Firebase project
- Firebase Cloud Messaging API is enabled

## Quick Start Summary

```bash
# backend
cd server
npm install
npm run dev

# frontend
cd ../stocklens-new
cp .env.example .env
# set VITE_API_BASE_URL=http://localhost:4000/new/api
npm install
npm run dev
```

For Android:

```bash
cd stocklens-new
npm run build
npx cap add android
npx cap sync android
npx cap open android
```
