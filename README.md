# pas

Policy Administration System for a South African short-term insurance broker:
motor, home and commercial property, quoted across several insurers.

Built so far: the **product model and rating engine**, **quote, referral
and bind**, and **PostgreSQL storage**. Later slices add documents, endorsements, cancellations and
renewals (see the design doc).

## How rating works

- A **product** is one insurer's version of one line, valid from a date
  (`products/*.json`). It holds rate tables, ordered calculation steps per
  coverage, VAT settings and the broker commission cap. New rates mean a new
  product version; old versions stay so in-force policies re-rate on their
  original rates.
- `rate(product, request)` is a pure function that returns the monthly premium
  per coverage in cents, a worksheet of every step, the VAT split and the
  broker commission (SASRIA excluded from commission).
- `compareInsurers(catalog, line, date, request)` prices one risk with every
  insurer offering that line, cheapest first, and explains any insurer that
  could not price it.

## How a quote becomes a policy

1. `createQuote` prices the risk with every insurer and runs each insurer's
   underwriting rules (from its product file). Each option is bindable,
   needs referral, declined, or unpriceable. Quotes are valid for 30 days.
2. A referred option goes to the insurer's underwriters with `referOption`.
   `decideReferral` records approve or decline, with a note, and only from an
   underwriter whose authority grade covers every rule that fired.
3. `bindQuote` lets the broker who owns the quote bind a bindable option. It
   issues a policy with term 1, version 1 and a new-business transaction.

These are pure functions over plain objects.

## Storage

PostgreSQL. `db/migrations/*.sql` holds the schema; `migrate(db)` applies any
not yet recorded in `schema_migrations`. `QuoteService` wraps the quote steps
above with storage:

- Every broker call is scoped to that broker's own clients, quotes and policies.
- Binding runs in one transaction: the quote is locked, a policy number is
  taken from a sequence (`POL-0000001`), and the policy and its new-business
  transaction are written together. A database rule allows one policy per quote.
- Each quote carries a revision number, so two people changing the same quote
  at once cannot overwrite each other.

In production, pass `fromPool(new pg.Pool(...))` as the database. Tests use
PGlite, an in-memory Postgres, so they need no database server.

The two products in `products/` are **illustrative only**: fictional insurers
and made-up rates, used for tests.

## Commands

```sh
npm ci
npm run typecheck
npm test
```
