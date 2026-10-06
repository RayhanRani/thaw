# Notes for the research write-up (later)

Saved from the prototype's former "Model" page, so nothing is lost while the app is simplified.

## Where the engine departs from the PRD, and why

1. **Disputes raise a holdback; they do not spend it.** The PRD flow says "a dispute spends part of its holdback", while requirement 1.2 says a holdback rises on a dispute. The engine returns a disputed order to the flat schedule until its window ends; the disputed amount comes from the available balance as today. Spending the holdback drained collateral as disputes spiked before bust-outs.
2. **An account floor on unproven orders.** Requirement 1.3 asks for a Risk-set floor without defining it. Pilot floor: 30% of the last 30 days of orders lacking verified delivery or usage. Without it, per-order release raised net loss in all 12 base and stress worlds (by 0.1 to 1.6 bps of volume) and broke the 0.5 bps margin in 6 of 12. Thaw also never holds more than the flat reserve.
3. **Missing proof holds its slice flat.** The toy model lets every slice decay; the guardrails say missing proof falls back to the flat schedule. The toy model keeps PRD behavior so its numbers reproduce; the pilot model holds a missing delivery slice flat until the carrier confirms delivery.
4. **Refunds release refund cover.** Requirement 1.2 lists a refund as a raise trigger. The engine treats a refund on an order as removing its "credit not processed" risk and shrinking the disputable amount. Refund spikes across an account are better treated as an account-level signal.
5. **"Other" split in two.** The toy's "other 25%" is shown as 20% not as described and 5% credit not processed, both linear, so the toy's numbers are unchanged.

## Requirement status (PRD section numbers)

Built: 1.1, 1.2, 1.3, 1.4 (shadow mode), 2.1, 2.2, 2.4 (Proof API), 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 5.1, 5.2, 5.4, audit log, kill switch.
Partial: 2.3 usage proof (engine and simulation, not the demo merchant), 2.5 trusted integrations (tier defined, no integrations).
Not built: 1.5 closure mode, 5.3 advance notice, 6.1 Connect platform views, 6.2 Sigma tables.

## Simulation results (6 seeds per scenario, `npm run snapshot`)

| Scenario | Setting | Dollar-days cut | Loss vs control | Guardrail (≤ +0.5 bps) |
| --- | --- | --- | --- | --- |
| Base | No floor | 72–75% | +0.11 to +1.64 bps | 4/6 pass, loss higher in 6/6 |
| Base | Pilot floor | 48–51% | +0.00 to +0.07 bps | 6/6 |
| 3× failures | Pilot floor | 48–51% | +0.00 to +0.12 bps | 6/6 |
| Fake proof | Pilot floor | 50–54% | +0.13 to +0.77 bps | 5/6 |
| Fake proof | New merchants flat | 34–40% | +0.03 to +0.44 bps | 6/6 |
