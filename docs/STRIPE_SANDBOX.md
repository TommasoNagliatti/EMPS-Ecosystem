# Optional Stripe Sandbox

EMPS works without Stripe using `PAYMENT_PROVIDER=sandbox`. To exercise PaymentSheet and webhooks, create your own Stripe test-mode account and install/authenticate the Stripe CLI locally.

In the ignored backend `.env`, set `PAYMENT_PROVIDER=stripe` and your own test secret. In the ignored App `.env`, set your own publishable test key. The existing launcher starts a local webhook listener and supplies its temporary signing secret to the backend process.

Never use live-mode keys, place credentials in documentation, or commit `.env` files. Stripe test transactions do not move real money.
