# Ops Web

This app is currently implemented as a static browser prototype so we can move on the product and UI while the JavaScript runtime tooling is still missing from the environment.

## Files

- `index.html`: dashboard shell and modal forms
- `styles.css`: brand tokens and layout system
- `app.js`: UI rendering, API integration, local fallback logic, and planning actions
- `assets/logo-mark.svg`: Naaval mark

## What it does

- Recreates the `Naaval` control tower direction from the shared mockups
- Uses the green-and-white operational visual language
- Renders a left rail, hero header, KPI strip, orders workspace, drivers workspace, and optimizer workspace
- Lets you create orders and drivers from the UI
- Lets you import orders into the optimizer from CSV
- Lets you run planning and dispatch routes from the UI
- Tries to load live data from `http://localhost:3001`
- Falls back to embedded demo data if the backend is not running

## Open it

You can open `index.html` directly in a browser.

For the easiest end-to-end local setup, run:

```bash
cd "/Users/pierre/Documents/New project"
./start-local.sh
```

Then open:

- `http://127.0.0.1:8787`

## Login and Maps Setup

The ops interface now starts behind a login gate.

- Ops demo login: `pierre@naaval.app`
- Demo password: `demo`
- Google Sign-In is enabled automatically when `ops-config.js` contains a valid Google Client ID
- Real interactive Google Maps are enabled automatically when `ops-config.js` contains a valid Maps Embed API key

Files:

- `ops-config.js`: local runtime config actually loaded by the app
- `ops-config.example.js`: template showing the expected values
- `vercel.json`: static deployment config for a Vercel project rooted on `apps/ops-web`
- `DEPLOY_VERCEL.md`: step-by-step deployment guide for Vercel + Hostinger

Recommended setup:

1. Open `apps/ops-web/ops-config.js`
2. Fill `window.NAAVAL_API_BASE_URL`
3. Fill `window.NAAVAL_GOOGLE_CLIENT_ID`
4. Fill `window.NAAVAL_GOOGLE_MAPS_EMBED_KEY`
5. Keep `window.NAAVAL_MAP_PROVIDER = "google"`
6. Reload the browser

Behavior:

- with `window.NAAVAL_API_BASE_URL`, the UI will try that public API first
- with no Google client ID, the UI shows a demo Google fallback button
- with no Google Maps key, the UI falls back to OpenStreetMap embeds when coordinates exist
- with a Google Maps key, the order detail and optimizer views use real Google Maps embeds

## Deploy On Vercel

The `ops-web` app can be deployed directly as a static Vercel project.

Recommended settings:

- Root Directory: `apps/ops-web`
- Framework Preset: `Other`
- Build Command: empty
- Output Directory: empty

Detailed guide:

- `apps/ops-web/DEPLOY_VERCEL.md`

To run an automated smoke test over the local API:

```bash
cd "/Users/pierre/Documents/New project"
./test-local.sh
```

If the backend is running, the page will try to read:

- `GET /orders`
- `GET /routes`
- `GET /fleet/drivers`
- `GET /fleet/shifts`
- `GET /fleet/hubs`
- `GET /health`

And it can also write:

- `POST /orders`
- `POST /fleet/drivers`
- `POST /planning/optimize`
- `POST /routes/:routeId/dispatch`
- `POST /dev/seed-demo`

## CSV import

In the `Optimizer` view you can:

- download `assets/order-import-template.csv`
- import a CSV file to create a batch of orders

Recommended columns:

- `reference`
- `dropoffLabel`
- `dropoffStreet1`
- `dropoffLat`
- `dropoffLon`

Useful optional columns:

- `merchantId`
- `hubId`
- `kind`
- `pickupLabel`
- `pickupStreet1`
- `pickupLat`
- `pickupLon`
- `serviceDurationSeconds`
- `parcelCount`
- `weightKg`
- `volumeDm3`
- `timeWindowStart`
- `timeWindowEnd`
- `requiredSkills`
- `notes`

## Recommended local mode

If you do not want to install Node yet, use the Python local server:

- `dev_server.py`: serves the frontend and exposes a compatible local API
- `services/core-api/data/db.json`: persistent local data store

This makes the product testable immediately on a Mac with Python 3.

## Next frontend step

When Node and package tooling are available, this prototype should be migrated into a proper Next.js app while keeping:

- the same brand tokens
- the same shell layout
- the same card and chip components
- the same data mapping rules
- the same operational flows
