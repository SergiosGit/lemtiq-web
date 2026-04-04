# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Static marketing website for LEMTIQ LLC (lemtiq.com), an independent iOS software studio. Deployed to Cloudflare Pages.

**Stack:** Pure HTML5 + CSS3. No JavaScript, no build tools, no dependencies.

## Development

No build process required. Edit files directly and open `index.html` in a browser to preview. Changes deploy automatically via Cloudflare Pages on push to the main branch.

The `_redirects` file handles Cloudflare routing (`/index` → `/`). The `CNAME` file maps the custom domain `lemtiq.com`.

## Architecture

Two files contain all the site:

- **`index.html`** — Single-page site with sections: nav, hero, about, products, contact, footer.
- **`css/style.css`** — All styling using CSS custom properties (variables defined at the top).

### Design tokens (css/style.css)

| Variable | Value | Usage |
|---|---|---|
| `--ink` | `#16162a` | Primary text (dark navy) |
| `--accent` | `#4f46e5` | Interactive elements (indigo) |
| `--radius` | `10px` | Border radius |

Mobile breakpoint: `640px`. Max content width: `960px`.

## Content

- Company: LEMTIQ LLC, Wisconsin, est. 2025
- Platform: iOS (primary)
- Current product: SunEyed (solar ROI calculator for iOS)
- Contact: info@lemtiq.com
