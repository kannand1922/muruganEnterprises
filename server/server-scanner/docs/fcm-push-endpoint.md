# FCM Push Endpoint

This server now supports sending test push notifications via Firebase Cloud Messaging.

## Endpoint

- Method: `POST`
- URL: `http://localhost:3010/api/meta/push/send`

## Request Body

```json
{
  "token": "YOUR_DEVICE_FCM_TOKEN",
  "title": "StockLens Test",
  "body": "Push is working",
  "data": {
    "screen": "dashboard",
    "type": "test"
  },
  "dryRun": false
}
```

`token` is required. All other fields are optional.

## Firebase Credential Setup (Server Side)

To send push messages from backend, use a Firebase **service account** JSON (not `google-services.json`).

1. Firebase Console -> Project Settings -> Service Accounts.
2. Generate new private key and download JSON.
3. Set one of these env vars before starting server:

```bash
export FCM_SERVICE_ACCOUNT_PATH="/absolute/path/to/service-account.json"
```

or

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/service-account.json"
```

Then start server:

```bash
npm run dev
```

## Quick Curl Test

```bash
curl -X POST "http://localhost:3010/api/meta/push/send" \
  -H "Content-Type: application/json" \
  -d '{
    "token":"YOUR_DEVICE_FCM_TOKEN",
    "title":"StockLens Test",
    "body":"Hello from server"
  }'
```
