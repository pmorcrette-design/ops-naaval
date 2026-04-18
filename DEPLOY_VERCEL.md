# Deploy Ops Web On Vercel

This deploys the `ops-web` frontend only.

If you want live orders, drivers, optimizer runs, and inbox data, you also need a public API URL and must set it in `ops-config.js`.

## 1. Prepare runtime config

Open `ops-config.js` and fill:

```js
window.NAAVAL_API_BASE_URL = "https://api.yourdomain.com";
window.NAAVAL_GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
window.NAAVAL_GOOGLE_MAPS_EMBED_KEY = "YOUR_GOOGLE_MAPS_EMBED_API_KEY";
window.NAAVAL_GOOGLE_ONE_TAP = false;
window.NAAVAL_MAP_PROVIDER = "google";
```

## 2. Import the project in Vercel

Use the Git import flow in Vercel and point the project root to:

```txt
apps/ops-web
```

Recommended Vercel settings:

- Framework Preset: `Other`
- Root Directory: `apps/ops-web`
- Build Command: leave empty
- Output Directory: leave empty
- Install Command: leave empty

## 3. Pick your domain strategy

Recommended setup:

- `ops.yourdomain.com` for the ops app
- `api.yourdomain.com` for the backend later

You can also use the apex domain if you want the ops app on the root domain.

## 4. Add the custom domain in Vercel

In the Vercel project:

1. Open `Settings`
2. Open `Domains`
3. Add your domain, for example `ops.yourdomain.com`

## 5. Add DNS records in Hostinger

If you use a subdomain such as `ops.yourdomain.com`:

- Type: `CNAME`
- Name: `ops`
- Target: use the exact CNAME shown by Vercel in `Settings -> Domains`

If you use the apex domain such as `yourdomain.com`:

- Type: `A`
- Name: `@`
- Target: `76.76.21.21`

## 6. Google auth and Maps

If you use Google Sign-In:

- add the deployed URL in Google Authorized JavaScript Origins
- example: `https://ops.yourdomain.com`

If you use Google Maps:

- restrict the API key to the deployed domain
- example: `https://ops.yourdomain.com/*`

## 7. Important production note

Without a public API behind `window.NAAVAL_API_BASE_URL`, the UI can still open, but live operational actions will not behave like a real production deployment.
