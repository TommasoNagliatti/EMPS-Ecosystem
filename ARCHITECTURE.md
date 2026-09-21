# Architecture

EMPS uses one API as the authority for identity, charging sessions, tariffs, frozen billing, payments and realtime state.

```mermaid
sequenceDiagram
  participant App
  participant API as NestJS API
  participant DB as MySQL 8
  participant GIE
  participant Pay as Sandbox/Stripe Test
  App->>API: QR + authenticated session request
  API->>DB: reserve charger and create idempotent session
  API->>GIE: demand and charger availability
  GIE-->>API: demonstrative power allocation
  API->>DB: readings, commands, billing snapshot
  API->>Pay: sandbox capture or PaymentIntent
  Pay-->>API: result/webhook
  API->>DB: idempotent payment update
  API-->>App: receipt + realtime status
```

The Next.js Site uses the same API for administration and operations. MySQL stores the official 20-table model. Prisma maps application models to that schema. Historical sessions without a tariff version or billing snapshot remain legacy records and are not recalculated automatically.

GIE is a separate Python service. Its NORMAL mode feeds the existing runtime with demonstrative telemetry, session demand and weather when available; deterministic fallback keeps the demo reproducible. Presentation and Manual Demo remain available. MPC, load balancing and frozen model artifacts are kept unchanged.

The local sandbox payment gateway is the default. Stripe test mode adds PaymentSheet and webhook processing, but never authorizes live-mode keys. Hardware adapters and production deployment are outside the current boundary.
