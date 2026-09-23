# Simple Stock Fee Calculator

Mobile-friendly calculator for **Moomoo Malaysia** trading fees on Bursa Malaysia (MYR) and US (USD) stocks: trade P/L, break-even price and average cost, with every fee itemised. Installs to your phone's home screen and works offline.

## Layout

| Path | Purpose |
|---|---|
| `site/fees.js` | Fee engine: pure functions and the rate table (`DEFAULTS`, `RATE_NOTES`). **Edit rates here.** |
| `site/app.js` | UI only. No fee logic. |
| `site/index.html`, `site/styles.css` | Markup and styles. No inline scripts or styles. |
| `site/sw.js`, `site/manifest.webmanifest`, `site/icon*` | Offline support and home-screen install. |
| `tests/fees.test.js` | Unit tests for every fee rule, cap and rounding case. |

## Develop

```sh
npm test                           # Node 20+, no dependencies to install
python3 -m http.server -d site     # then open http://localhost:8000
```

When a rate changes (the SEC fee changes about twice a year), update `DEFAULTS` and `RATE_NOTES` in `site/fees.js`, adjust the matching test, and open a PR. CI must pass before merge; the Pages deploy re-runs the tests and refuses to publish if they fail.

## Deploy

Every push to `main` deploys `site/` to GitHub Pages via `.github/workflows/pages.yml`.
One-time setup: **Settings → Pages → Source: GitHub Actions**.

## Security

- **No backend, no accounts, no tracking.** Inputs stay on the device (`localStorage` only).
- **Strict Content-Security-Policy:** scripts and styles only from the site itself; no inline code, `eval` or third-party scripts. The single allowed outbound request is the FX rate from `api.frankfurter.dev`; the response is validated as a number in a sane range and never rendered as HTML.
- **No `innerHTML`:** all output is written with `textContent`, so even a tampered response cannot inject markup.
- **Zero npm dependencies**, so there is no package supply chain.
- **CI hardening:** GitHub Actions pinned to commit SHAs (Dependabot keeps them current), read-only default token, checkout without persisted credentials, Pages write permission scoped to the deploy job only.
- **Service worker** handles same-origin GET requests only, never caches the FX API, and is network-first, so fixes reach users on their next online visit.
- **Installing the app** grants no device permissions. It runs in the browser sandbox with no access to files, contacts, camera or other apps.

Recommended for the repo owner: enable 2FA on GitHub, turn on branch protection for `main` (require PR + passing CI), and enable secret scanning / Dependabot alerts in Settings → Code security.
