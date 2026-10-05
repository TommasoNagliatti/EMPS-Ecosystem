# Local startup

## Platform V2 consolidated environment (02/10/2026)

Current source: `C:\goodwill_ai\EMPS_GITHUB`. The old Desktop services and isolated previews were stopped by explicit user authorization. MySQL `emps-mysql` was preserved, healthy on 3306.

Run `./START_EMPS_V2.ps1` from this repository in PowerShell 7. It checks MySQL, builds the current backend, identifies only EMPS conflicts, starts Backend 3001, Site 3000, existing GIE 8510 and Expo 8081 with LAN and cache clearing. It discovers the current LAN IP and updates only the ignored local App API URL. The launcher prints the resulting Backend LAN and `exp://<LAN_IP>:8081` addresses. Site opens automatically; processes remain running. Local environment secrets are preserved and never included in the scripts.

Run `./STOP_EMPS_V2.ps1 -InspectOnly` to inspect ownership; `./STOP_EMPS_V2.ps1` stops only the tracked launcher process tree, preserving MySQL. Ownership includes PID, creation time and command identity. State and logs are private under `site/emps-site-main/backend/reports/`.

Site: http://localhost:3000/stations; backend health: http://localhost:3001/auth/health; GIE authenticated API: http://localhost:8510; App web: http://localhost:8081. Stripe listener forwards to `/payments/stripe/webhook` on Backend 3001 when local configuration is available. The webhook signing secret is passed in memory. Do not expose local configuration or logs containing credentials.

Verified on final ports: Site login, Minhas Estações, wizard, station assets/photos/team, RFID, telemetry/readiness; App public station with photo/hours/amenities and reservation screen; backend LAN health; GIE NORMAL integration; Expo LAN manifest. No new payment/reservation was submitted for this operational check. Physical Android/iOS remains pending. Windows PowerShell 5 blocked direct script execution under the existing policy; PowerShell 7 executed successfully without changing security policies. No GIE core/model/MPC changes. A separate LightGBM import probe was blocked by Windows application control; the existing GIE API/NORMAL path started successfully. Do not bypass that protection.

The following preview instructions are historical and apply only when deliberately creating a separate preview; those ports are currently stopped.

## Platform V2 isolated preview (historical: 01/10/2026)

The current V2 preview uses Site `http://127.0.0.1:3100`, Backend `http://127.0.0.1:3101` and Expo web `http://127.0.0.1:8083`. The Desktop presentation on 3000/3001/8510/8081 remains a separate running checkout. Do not run the default all-services launcher over those ports to validate V2.

V2 currently shares the existing MySQL database, not a disposable clone. Keep `CHARGE_RUNTIME_STATION_IDS=19,24` in the preview Backend and keep `GIE_STATION_ID` / `GIE_SERVICE_URL` empty. Use only the synthetic station/account fixtures documented in `docs/implementation-v2/WORK_STATE.md`. Do not reapply migrations, run database cleanup, seed over current data or copy Desktop code over this monorepo.

When restarting an isolated service, first identify only its listening PID and checkout. Backend: build in `site/emps-site-main/backend`, run `dist/main.js` with `PORT=3101`, the station restriction above, `ENABLE_DEMO_PAYMENTS=true`, and CORS for localhost/127.0.0.1 on 3100 and 8083. Preserve the existing preview Stripe test configuration; never print or commit keys. V2 preview does not replace the existing presentation Stripe listener.

Site: set `NEXT_PUBLIC_API_URL=http://localhost:3101` for its process and run `npm run dev -- --port 3100 --hostname 127.0.0.1`. App: set `EXPO_PUBLIC_EMPS_API_URL=http://localhost:3101`, `CI=false` and `NODE_OPTIONS=--dns-result-order=ipv4first` only in its test process, then run `npx expo start --web --port 8083 --localhost`. Do not combine Expo `--offline` with `--localhost`; do not overwrite the presentation App `.env`.

Health: GET `/auth/health` on 3101 must report MySQL OK. Preview Expo is localhost-only; this does not validate a phone over LAN. Native Android/iOS, PaymentSheet, camera, QR and sharing remain pending physical-device validation. Read `docs/GIE_V2_HANDOFF.md` before attempting any GIE V2 activation: the current Python service remains single-station.

## Requirements

- Windows PowerShell 5.1+ or PowerShell 7
- Docker Desktop running
- Node.js with npm
- Python 3.12 (`py -3.12`)

## First installation

```powershell
.\scripts\check-environment.ps1
.\scripts\setup-local.ps1
```

The setup installs npm packages, generates the Prisma client, builds the backend, creates `gie/GIE/.venv`, installs GIE service requirements, and copies `.env.example` to `.env` only when the destination is absent. Each failed installation stops setup. It does not start, reset or delete a database.

Review these local files before startup:

- `site/emps-site-main/backend/.env`
- `site/emps-site-main/frontend/.env` (optional)
- `app/emps-charge/.env`

Use a unique local `JWT_SECRET` and `GIE_SERVICE_TOKEN`. Never commit these files.

## Start everything

```powershell
.\scripts\start-local.ps1
```

This starts the existing `emps-mysql` container without recreating it. Compose is used only if the container does not exist. It then calls `backend/scripts/start-ecosystem.cjs --with-app`. Keep the terminal open. Stop with `Ctrl+C`; MySQL and its volume remain running.

The launcher uses ignored `backend/.env.presentation` when present, otherwise `backend/.env`. Keep local Stripe test keys, station selection and GIE credentials in those private files. In Stripe mode it starts the existing webhook listener automatically; in sandbox mode no Stripe credentials are required. Startup never runs migrations or data cleanup.

After editing backend code, run `npm.cmd run build` inside `site/emps-site-main/backend` before starting. After adding native App packages, install dependencies and rebuild your development client if you use one. Receipts use pdf-lib on all platforms, Expo Sharing on Android/iOS, and PDF download on web. Native sharing and PaymentSheet require validation on a compatible physical device or development build.

To start without Expo:

```powershell
.\scripts\start-local.ps1 -NoApp
```

## Database

On the first creation of the Docker volume, Compose loads `site/emps-site-main/database/EMPS_Database_Completo.sql`. The official file contains schema only. Existing volumes are never reinitialized.

Optional fictitious demo fixture:

```powershell
cd site\emps-site-main\backend
$env:SEED_ALLOW_QA='true'
$env:SEED_PASSWORD='choose-a-local-demo-password'
npm run prisma:seed
```

The fixture is append-only, uses `@emps.invalid` addresses, and prints the generated identifiers. Register a customer through the App or `POST /mobile/v1/auth/register`. Create a normal local administrator with `npm run bootstrap:admin` after defining `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` in the current shell.

## Physical phone

The startup script prints the LAN IPv4. Put it in the ignored App `.env`:

```dotenv
EXPO_PUBLIC_EMPS_API_URL=http://YOUR_LAN_IP:3001
EXPO_PUBLIC_EMPS_DEMO_MODE=false
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

The phone and computer must use the same LAN. Allow Node.js ports 3001 and 8081 through the local firewall if necessary.

## URLs

- Site: http://localhost:3000
- Backend health: http://localhost:3001/auth/health
- GIE health: http://localhost:8510 (authenticated endpoint)
- Expo/Metro: port 8081

## Stop

Prefer `Ctrl+C` in the startup terminal. If it is unavailable, run `.\scripts\stop-local.ps1`. The stop script targets only launcher descendants in this checkout and does not stop MySQL.
