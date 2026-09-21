# GitHub handoff

1. Install Docker Desktop, Node.js/npm and Python 3.12.
2. Clone the repository and run `.\scripts\setup-local.ps1` from its root.
3. Review the generated local `.env` files. Replace placeholder secrets with unique local values.
4. Run `.\scripts\start-local.ps1` and keep the terminal open.
5. Open http://localhost:3000 and verify http://localhost:3001/auth/health.
6. For a phone, replace `YOUR_LAN_IP` in `app/emps-charge/.env`, then restart Expo.

MySQL is created from the safe structure-only SQL on a new Docker volume. The scripts never remove an existing volume. The default payment gateway is local sandbox. Configure Stripe only with your own test credentials.

Work on a feature branch and open a Pull Request. See the root README, STARTUP and CONTRIBUTING files for component tests and repository practices.
