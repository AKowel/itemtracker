# Item Tracker

Standalone Node/Express catalogue app for:

```text
https://cons.axephotography.co.uk
```

It is designed to be its own repo and its own server process, while sharing PocketBase data with the locally run `PI-App` installs.

## What it does

- logs in with the same PocketBase `users` accounts already used by `PI-App`
- reads the shared item catalogue snapshot from PocketBase
- searches by SKU, barcode, or description
- uploads product reference photos from desktop or mobile camera
- writes back to the same PocketBase collections that `PI-App` now reads on refresh

That means:

- import a workbook on the hosted web app
- upload photos on the hosted web app
- refresh local `PI-App`
- see the same catalogue and photos there

## Shared PocketBase collections

This app uses:

- `item_catalog_snapshots`
- `item_catalog_images`

Those are the same shared collections now used by the updated `PI-App`.

## Runtime

- Node 20+
- Express
- EJS
- PocketBase
- PM2 for production
- Nginx reverse proxy

## Main files

- App entry: [server.js](/c:/Users/Axel/Documents/GitHub/itemtracker/server.js)
- Express app: [server/app.js](/c:/Users/Axel/Documents/GitHub/itemtracker/server/app.js)
- Shared catalogue service: [server/itemTrackerService.js](/c:/Users/Axel/Documents/GitHub/itemtracker/server/itemTrackerService.js)
- PocketBase client: [server/pocketbaseClient.js](/c:/Users/Axel/Documents/GitHub/itemtracker/server/pocketbaseClient.js)
- Main styling: [static/css/app.css](/c:/Users/Axel/Documents/GitHub/itemtracker/static/css/app.css)
- Catalogue UI logic: [static/js/catalogue.js](/c:/Users/Axel/Documents/GitHub/itemtracker/static/js/catalogue.js)

## Local setup

1. Install dependencies:

```powershell
npm install
```

2. Create env file:

```powershell
copy .env.example .env
```

3. Fill in:

- `SESSION_SECRET`
- `POCKETBASE_URL`
- `POCKETBASE_ADMIN_EMAIL`
- `POCKETBASE_ADMIN_PASSWORD`
- `APP_BASE_URL`
- optionally `ADMIN_EMAILS`

4. Bootstrap collections:

```powershell
npm run bootstrap
```

5. Start the app:

```powershell
npm start
```

6. Open:

```text
http://127.0.0.1:3100
```

## Production deployment

Expected shape:

- Node app on `127.0.0.1:3100`
- PM2 process name: `itemtracker`
- Nginx reverse proxy for `cons.axephotography.co.uk`
- PocketBase running separately and reachable from the app

Files included:

- PM2 config: [ecosystem.config.cjs](/c:/Users/Axel/Documents/GitHub/itemtracker/ecosystem.config.cjs)
- Nginx example: [deploy/nginx.itemtracker.conf](/c:/Users/Axel/Documents/GitHub/itemtracker/deploy/nginx.itemtracker.conf)
- Update script: [deploy/update-itemtracker.sh](/c:/Users/Axel/Documents/GitHub/itemtracker/deploy/update-itemtracker.sh)

Typical server flow:

```bash
cd /var/www/itemtracker
npm install
node scripts/bootstrap-pocketbase.js
pm2 start ecosystem.config.cjs
```

Later updates:

```bash
cd /var/www/itemtracker
git pull
npm install
pm2 restart itemtracker
```

## Important note

The domain in your earlier message looked like `cons.axepgotography.co.uk`, but your previous domain reference was `cons.axephotography.co.uk`.

This repo is configured for:

```text
cons.axephotography.co.uk
```

If the real DNS host is different, update:

- `.env`
- `deploy/nginx.itemtracker.conf`
