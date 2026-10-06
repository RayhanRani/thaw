# Thaw demo: voiceover cue sheet

Video: `demo/thaw-demo.mp4` (2:48, 1080p, no sound). Start each line at its time.


## Overview

- **0:00** Hi, I’m Rayhan. This is Thaw, a concept I built for the Product Manager role at Stripe: reserves that thaw as trust is proven.

## The problem

- **0:11** Today, Stripe can hold up to 25% of a risky merchant’s sales for 90 to 180 days, even after orders are delivered. It shows: a 1.6 out of 5 Trustpilot rating.

## The solution

- **0:25** Thaw replaces the calendar with proof. One $100 order starts with the same $10 hold.
- **0:32** 3D Secure verifies the buyer: the fraud part comes back.
- **0:38** Delivery is confirmed: the delivery part comes back.
- **0:43** The rest fades as disputes become unlikely.

## Results

- **0:47** I tested this on a year of payments from 300 simulated stores, including ones that fail and ones that cheat: half as much money held, and half of it back by day 7 instead of day 90, without raising losses.

## Merchant View

- **1:05** This is what a merchant sees: $4,587 held instead of $8,654, and every dollar has a reason.
- **1:14** She adds tracking to 234 orders, and $2,597 comes back on the spot.
- **1:23** Across 670,000 simulated orders, a third of the money comes back the day of the sale and half by day 7, while today’s reserve waits until day 90.

## Admin View

- **1:36** Here’s the same store, seen by Stripe’s risk team. If anything looks wrong, Risk moves it back to today’s reserve in one click.
- **1:50** Across 300 stores over a year, Thaw holds about half as much, and the safety switch caught ten of sixteen failing stores, a median of nine days early.
- **2:04** In a normal year, it’s safe in all six simulated years.
- **2:10** Without the safety minimum, losses go over the limit.
- **2:15** Three times more failures: still safe.
- **2:19** The real risk is fake delivery proof.
- **2:24** The fix: new stores start on today’s reserve until they earn trust. Safe again, with 37% less held.

## Close

- **2:34** Next, I’d run this test in shadow mode on Stripe’s real payments. Merchants get money back as fast as they can prove it’s safe, and Stripe keeps every control. Thanks for watching.
