# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Static marketing website for LEMTIQ LLC (lemtiq.com), an independent iOS software studio. Hosted by Cloudflare Worker `lemtiq-web`, not Pages.

**Stack:** Pure HTML5 + CSS3 for the public site, plus a static JavaScript admin dashboard at `/admin/`. No build tools or dependencies.

## Development

Run `npm ci`, `npm test`, and `npm run deploy:check` for Worker checks. Wrangler invokes `npm run build` to allowlist deployable assets into `dist/`. Changes pushed to main trigger the connected Worker build; obtain production approval before pushing.

The Worker validates Cloudflare Access JWTs for `/admin` and descendants and serves snapshots from private KV binding `DASHBOARD_DATA`, key `dashboard`. Generated `admin/data/` files must never enter the public Git repository or static deployment. Local Python preview can still use those files. KV binding setup is pending; missing data returns 503.

The `_redirects` file handles Cloudflare routing (`/index` → `/`). The `CNAME` file maps the custom domain `lemtiq.com`.

## Architecture

The public site is intentionally small:

- **`index.html`** — Single-page site with sections: nav, hero, about, products, contact, footer.
- **`css/style.css`** — All styling using CSS custom properties (variables defined at the top).

The private/admin preview lives in:

- **`admin/index.html`** — Dashboard shell for `/admin/`.
- **`admin/app.js`** — Static snapshot renderer.
- **`admin/styles.css`** — Dashboard styling.
- **`admin/data/dashboard.json`** — Generated dashboard snapshot, refreshed from `../dashboard/scripts/build_snapshot.mjs` in the Entrepreneur workspace.

### Design tokens (css/style.css)

| Variable | Value | Usage |
|---|---|---|
| `--ink` | `#16162a` | Primary text (dark navy) |
| `--accent` | `#4f46e5` | Interactive elements (indigo) |
| `--radius` | `10px` | Border radius |

Mobile breakpoint: `640px`. Max content width: `960px`.

## Content

- Company: LEMTIQ LLC, Wisconsin, est. 2026
- Platform: iOS (primary)
- Current product: SunEyed (solar ROI calculator for iOS)
- Contact: info@lemtiq.com
