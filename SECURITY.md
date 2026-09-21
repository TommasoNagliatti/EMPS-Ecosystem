# Security

This is a public development repository. Never commit credentials, private configuration, real user data, database dumps, access tokens, webhook secrets or production keys.

Use ignored `.env` files copied from `.env.example`. Stripe must remain in test mode; the default `PAYMENT_PROVIDER=sandbox` needs no Stripe credentials. If a secret is committed, revoke it immediately, notify the maintainers privately and remove it from repository history before further publication.

Do not report exploitable vulnerabilities in public issues. Contact the project owners privately with reproduction steps, affected component and impact. No production security or uptime guarantee is provided for this prototype.
