# Public integration checkpoint — 2026-09-24

This checkpoint preserves the current monorepo working tree: energy scene and overlays, two-decimal Site presentation, administrative login, scoped administration/search, Stripe authorization before START, final capture and EMPS PDF receipts.

## Validation
- Backend build passed; 46 tests and two consecutive Stripe Sandbox sessions passed during implementation. Before publication, 8 targeted financial/admin tests passed again.
- Site: existing successful build retained; TypeScript and 13 energy tests passed before publication.
- App: TypeScript, 27 tests and web export passed. ESLint has no errors and one existing hook-dependency warning.
- GIE has no changes in this checkpoint; previous service/control validation retained.
- Web PDF generation/download and rendered output checked with synthetic data. Native Share Sheet and visual PaymentSheet still require a compatible physical device/development client.

## Public/private boundary
Local reports include session/payment identifiers and receipts and are excluded together with logs, dumps, backups, .env files, private handoffs and generated artifacts. The SQL schema remains tracked; live database dumps do not. No migration or database cleanup was run for publication.

Pattern-based scanning and comparison against local private values found no Stripe private keys in publication candidates. Generic test fixtures and configuration-variable names are intentional. Gitleaks was not available. Two old example values were reused in local JWT/GIE configuration: public examples now require unique generated values. Existing historical exposure cannot be removed without rewriting history; rotate those local values separately. Local runtime configuration was preserved for the manual test environment.

## Running
Follow ../STARTUP.md from the monorepo root. Run `scripts/start-local.ps1 -NoApp`, then start Expo separately from app/emps-charge using `npx.cmd expo start --lan --clear`. Set the ignored App .env API URL to the computer's current LAN address, retaining other variables.

The retained authorization-smoke.cjs is the current explicit opt-in payment smoke. presentation-smoke.cjs and small-cash-smoke.cjs preserve earlier test procedures and should not be assumed compatible with the newer mandatory admission flow. These scripts are not run during normal startup or unit tests; real smoke execution needs reviewed private configuration and a fresh backup.

Pending edge-case regression: renewing an authorization that expires between reservation and START. Backend rejection is intentional; no new functional changes were made during publication.
