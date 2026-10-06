# Thaw

**Reserves priced by evidence, not by the calendar.** A working prototype of the *Stripe Thaw* PRD (Oct 4, 2026): per-order holdbacks that shrink as proof of authentication, delivery and usage arrives, a merchant-facing Thaw Meter, Thaw Advance, a fair appeals process, and the shadow-mode backtest the PRD asks for.

> Independent concept prototype by Rayhan Rani, built from public sources. Not affiliated with or endorsed by Stripe, and it uses no Stripe data. Every merchant, order and outcome is synthetic. Numbers marked illustrative are arithmetic on stated assumptions.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 47 tests: the PRD's numbers, engine invariants, backtest harness
npm run backtest     # shadow backtest scorecard in the terminal (flags: --scenario adversarial --seed 3 --floor 0.3 --new-flat on)
npm run snapshot     # re-run 6 seeds per scenario and refresh src/app/data/snapshot.json
npm run build        # static site in dist/
```

## What's in the app

Three pages, built for a short demo to a non-technical audience.

| Page | What it shows | The interactive part |
| --- | --- | --- |
| **Overview** (`#/`) | The problem, the solution and the results, with an animated $100 order thawing step by step in the hero | **Step through one $100 order** and watch each proof release its part of the hold |
| **Merchant View** (`#/merchant`) | Three questions Maya would ask: how much is held and why, when she gets it, and (from the backtest) what happens to one $1,000 sale day by day | **Add tracking**; take a **Thaw Advance**; play or drag the **one-sale simulation** |
| **Admin View** (`#/admin`) | The same store with its safety switch; the backtest's year across 300 stores; a stress test | **Safety switch**; play the **year simulation**; **pick a stress test** (normal, no safety minimum, 3× failures, fake proof, new stores on today's reserve) |

A small **Demo** bar on the merchant and admin pages jumps a week ahead or resets everything (reloading the page also resets).

The more detailed screens built earlier (order drill-down, appeals desk, decision log, the live shadow-mode simulator, the business-case calculator) are still in `src/app/merchant` and `src/app/admin` but are not linked from the demo; they are material for the written research paper.

## What the prototype found

The PRD's toy model promised a 78% cut in dollar-days held. The engine reproduces that exactly (`holdback.test.ts`). The shadow backtest adds what the toy model leaves out: merchants fail, and disputes keep arriving after they are gone. Over six synthetic worlds per scenario (300 merchants, a year of payments, about 670k payments each):

| Scenario | Thaw setting | Dollar-days cut | Net loss vs control | Guardrail (≤ +0.5 bps) |
| --- | --- | --- | --- | --- |
| Base | Per-order release only, no floor | 72–75% | +0.11 to +1.64 bps | worse in 6/6 |
| Base | **Pilot: unproven-order floor** | **48–51%** | +0.00 to +0.07 bps | **6/6 pass** |
| 3× merchant failures | Pilot | 48–51% | +0.00 to +0.12 bps | 6/6 pass |
| Fake proof (empty parcels, real tracking) | Pilot | 50–54% | +0.13 to +0.77 bps | 5/6 pass |
| Fake proof | Pilot, new merchants kept flat | 34–40% | +0.03 to +0.44 bps | 6/6 pass |

Median days to release: 7–11 under Thaw, against 90 under the flat reserve.

Building it changed the design in four places (details in `docs/notes-for-paper.md`):

1. **Reserves insure against merchant failure, not disputes.** A live merchant pays its own disputes. Stripe loses money only on disputes that arrive after a merchant is gone, beyond what is held at that moment.
2. **Per-order release alone fails the guardrail.** It releases collateral on delivered orders that a failing merchant's undelivered orders were relying on.
3. **Hold against what is unproven.** A floor of 30% of the last 30 days of orders without verified fulfillment proof restores loss parity, and it grows by itself when a merchant stops shipping.
4. **A dispute should raise a holdback, not spend it.** The PRD's flow spent the holdback on the dispute; that drained collateral exactly when disputes spike before a bust-out. The engine raises the order back to the flat schedule instead (PRD 1.2 already says holdbacks rise on disputes).

Fake but carrier-verified proof is the binding risk. Keeping new merchants on the flat schedule, already step 2 of the PRD's calibration plan, closes it at a smaller cut.

`docs/notes-for-paper.md` lists every departure from the PRD and which requirements (P0/P1/P2) are built.

## Architecture

```
src/engine/            Pure TypeScript, no UI or I/O. The product's core; everything else uses it.
  types.ts             Payments, proof events, adverse events, reserve policy, reason codes
  model.ts             H_i(t) = A_i · r · Σ_k w_k · m_k(e) · S_k(t); PRD toy model and pilot model
  holdback.ts          priceHoldback: per-order holdback on any day, with reasons (the reference implementation)
  proof.ts             Trust tiers, carrier verification, idempotent Proof API
  account.ts           Account snapshot, floors and caps, release calendar, speed-up list
  explain.ts           Audit timeline per order (reason, inputs, model version) and webhook events
  advance.ts           Thaw Advance: offer, fee from the loss model, repayment netting
  appeals.ts           Deadlines in business days, written decisions, human review threshold
  economics.ts         Sizing table and advance economics from the PRD
  fastpath.ts          Allocation-free holdback paths for the backtest (tested equal to holdback.ts to the cent)
  simulate.ts          Synthetic world: merchants, payments, proof, disputes, insolvencies, bust-outs
  backtest.ts          Shadow mode: control vs treatment on identical events, kill-switch signals, metrics, cuts
src/app/               React UI (Vite, Tailwind), dependency-free SVG charts
  landing/             Overview page
  merchant/            Merchant view (MerchantHome is the demo screen)
  admin/               Admin view (AdminHome is the demo screen)
  shell/               Navigation, demo bar, theme
scripts/               CLI backtest and the snapshot generator
```

### Running the backtest on real data

`runBacktest` consumes, per merchant, a list of `OrderState` (payment, proof events with the day they became known, disputes with arrival day and lost amount) plus a failure date if the merchant closed. Replace `generateOrders` in `simulate.ts` with a loader for those four tables. The ledger, kill-switch signals, metrics, frontier and pre-registered cuts stay unchanged.

## Limits

- Every rate, curve and failure pattern is a placeholder. The synthetic world assumes that evidence lowers dispute risk; real data has to show it.
- Network and bank-sponsor minimums, float income, operating cost, support tickets and merchant sentiment are outside the simulation. The Economics page treats float as an explicit input because only Finance knows it.
- Not built yet: closure mode (1.5), advance notice before adverse changes (5.3), Connect platform views (6.1), Sigma tables (6.2). Usage proof (2.3) runs in the engine and the backtest but not in the demo merchant.
- Charts follow a colorblind-validated palette; the light-mode contrast warning on two series is handled by labels and table views.
