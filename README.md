# pas

Policy Administration System for a South African short-term insurance broker:
motor, home and commercial property, quoted across several insurers.

This first slice is the **product model and rating engine**. Later slices add
quotes and binding, underwriting referrals, documents, endorsements,
cancellations and renewals (see the design doc).

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

The two products in `products/` are **illustrative only**: fictional insurers
and made-up rates, used for tests.

## Commands

```sh
npm ci
npm run typecheck
npm test
```
