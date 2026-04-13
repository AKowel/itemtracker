# Item Tracker

Standalone Node/Express catalogue and photo-capture app for:

```text
https://cons.axephotography.co.uk
```

It runs as its own app and its own GitHub repo, but shares PocketBase data with the locally run `PI-App` installs so both sides stay in sync.

## What It Does

- logs in with the same PocketBase `users` accounts used by `PI-App`
- reads the shared item catalogue snapshot from PocketBase
- searches by SKU, workbook barcode, alternate barcode, and description
- lets mobile users scan barcodes from the browser
- uploads compressed product reference photos from desktop or mobile
- shows warehouse-aware filters and coverage metrics
- writes back to the same shared PocketBase collections that `PI-App` refreshes from

That means a workflow like this works end to end:

1. an admin imports a workbook on the hosted site
2. users search, scan, and upload photos on the hosted site
3. `PI-App` refreshes
4. the same catalogue, barcodes, and images appear locally

## Current Feature Set

### Catalogue search

- SKU / barcode search box
- three description filter boxes that stack together
- search scoring across SKU, description, workbook barcode, and shared alternate barcodes
- "Only with images" filter
- "Only active in warehouse" filter

Example:

```text
outer + 20 inch + olive
```

### Barcode support

- workbook barcode field support from the imported item file
- alternate barcode support from the daily `BARITEM` snapshot published by `PI-App`
- browser barcode scanner on the hosted site
- local fallback scanner asset served from this app so iPhone/Safari does not depend on an external CDN
- ambiguous barcode matches can still show likely SKUs if one barcode maps to more than one item

### Photo capture

- staged uploads per SKU card
- `Take Photo`
- `Add More`
- `Finalize Upload`
- `Clear`
- client-side image compression before upload
- shared server-side image compression on upload
- image lightbox with previous / next navigation

### Shared warehouse awareness

- `PI-App` publishes the full daily `SMARTDATA.BINLOC` snapshot to PocketBase
- hosted app can mark SKUs that are currently active in the warehouse
- hosted app can filter down to only warehouse-active SKUs

### Shared metrics

- captured SKU count
- coverage vs imported item file
- coverage vs currently active warehouse SKUs
- latest warehouse snapshot date

These metric cards are:

- admin-only
- hidden on mobile to save vertical space

### Admin-only controls

- workbook import
- metrics cards and summary data

## Shared PocketBase Collections

This app currently uses these shared collections:

- `item_catalog_snapshots`
- `item_catalog_images`
- `warehouse_binloc_snapshots`
- `item_catalog_barcode_snapshots`

### What populates them

- `item_catalog_snapshots`
  - imported workbook snapshot
- `item_catalog_images`
  - uploaded product reference images
- `warehouse_binloc_snapshots`
  - daily warehouse activity snapshot published by `PI-App`
- `item_catalog_barcode_snapshots`
  - daily barcode snapshot published by `PI-App`

## PI-App Integration

`PI-App` is the source for the ODBC-fed warehouse and barcode snapshots.

### Daily warehouse snapshot

`PI-App` publishes a daily snapshot of:

```sql
SMARTDATA.BINLOC
```

That snapshot is used by the hosted app to:

- identify active warehouse SKUs
- filter search results to only active warehouse items
- calculate warehouse coverage metrics

### Daily barcode snapshot

`PI-App` also publishes a daily snapshot of:

```sql
SELECT * FROM FANDMKET.BARITEM
```

The important columns are:

- `BIITEM` = SKU
- `BIBARC` = barcode

That snapshot is merged into hosted and local catalogue search so extra box barcodes can help identify an item even when they are not the main workbook barcode.

## Runtime

- Node 20+
- Express
- EJS
- PocketBase
- PM2 for production
- Nginx reverse proxy
- `html5-qrcode` for fallback mobile barcode scanning

## Important Files

- App entry: [server.js](./server.js)
- Express app: [server/app.js](./server/app.js)
- Shared catalogue service: [server/itemTrackerService.js](./server/itemTrackerService.js)
- PocketBase client: [server/pocketbaseClient.js](./server/pocketbaseClient.js)
- Main styling: [static/css/app.css](./static/css/app.css)
- Catalogue UI logic: [static/js/catalogue.js](./static/js/catalogue.js)
- Hosted catalogue page: [views/catalogue.ejs](./views/catalogue.ejs)
- PocketBase bootstrap: [scripts/bootstrap-pocketbase.js](./scripts/bootstrap-pocketbase.js)
- Nginx example: [deploy/nginx.itemtracker.conf](./deploy/nginx.itemtracker.conf)
- PM2 config: [ecosystem.config.cjs](./ecosystem.config.cjs)

## Local Setup

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

## Production Deployment

### Expected production shape

- Node app on `127.0.0.1:3100`
- PM2 process name: `itemtracker`
- Nginx reverse proxy for `cons.axephotography.co.uk`
- PocketBase running separately and reachable from the app

### Typical first deploy

```bash
cd /var/www/itemtracker
npm install
node scripts/bootstrap-pocketbase.js
pm2 start ecosystem.config.cjs
```

### Later updates

```bash
cd /var/www/itemtracker
git pull
npm install
pm2 restart itemtracker --update-env
```

### If the server has local changes in `server/app.js`

This happened once during a live hotfix. Safe recovery:

```bash
cd /var/www/itemtracker
git stash push -m "server hotfix" server/app.js
git pull
npm install
pm2 restart itemtracker --update-env
```

## Mobile / Camera Notes

- camera access works best over HTTPS
- `https://cons.axephotography.co.uk` is the correct place to test mobile scanning
- iPhone browsers may not support the native `BarcodeDetector` path
- this app now serves a local `html5-qrcode` fallback asset so scanning does not depend on a third-party CDN
- if scanning still fails after deploy, hard refresh the browser so it loads the latest JS

## Current Behavior Summary

### Hosted site can currently:

- import workbook snapshots
- search with stacked filters
- search by barcode and alternate barcode
- scan barcodes from mobile
- upload multiple staged photos per SKU
- preview images in a lightbox
- filter to image-backed items
- filter to warehouse-active items
- show admin-only coverage metrics

### PI-App currently contributes:

- shared workbook-aware catalogue consumption
- shared image visibility on refresh
- daily warehouse snapshot publishing
- daily barcode snapshot publishing

## Next Likely Additions

These are the most useful next steps from here.

### 1. Missing Photos view

Show warehouse-active SKUs that still have no images. This would turn the site into a live action list for capture work.

### 2. Manual barcode alias admin tool

Keep the daily `BARITEM` feed as the base, but allow admins to add one-off barcode aliases manually when the source system is missing something or late to update.

### 3. Dedicated SKU detail page

Open one SKU into a full detail page with:

- all images
- all known barcodes
- warehouse status
- notes
- upload history

### 4. Capture workflow statuses

Add states such as:

- `Needs photo`
- `Captured`
- `Needs retake`
- `Approved`

### 5. Gap exports

Export CSVs for:

- active warehouse SKUs with no images
- captured SKUs not currently active
- alternate barcodes that map to multiple SKUs

### 6. Coverage by aisle / bay / area

Use warehouse data to show where photo coverage is weakest physically in the warehouse.

### 7. Saved searches / saved queues

Save views like:

- active + no images
- outer + 20 inch
- glass + only with images

### 8. Activity log

Show who imported a workbook, who uploaded images, and when.

### 9. Better barcode result handling

When one scanned barcode maps to multiple SKUs, add a clearer "possible matches" presentation at the top of the results.

### 10. Offline-friendly mobile queue

Allow warehouse users to queue photo uploads temporarily and sync when signal improves.

## Domain Note

This repo is configured for:

```text
cons.axephotography.co.uk
```

If the real DNS host changes, update:

- `.env`
- `deploy/nginx.itemtracker.conf`
- any reverse proxy / Cloudflare config
