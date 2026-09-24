# Local startup

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
