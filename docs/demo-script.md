# Thaw demo: voiceover script (2:48)

Matches `demo/thaw-demo.mp4`. The video has no sound. Start each line at its timestamp; *on screen* tells you what the viewer sees at that moment. At a natural pace, every line fits with a little room to spare.

## Overview

**0:00** · *Home page, the order card animating*
> Hi, I'm Rayhan. This is Thaw, a concept I built for the Product Manager role at Stripe: reserves that thaw as trust is proven.

## The problem

**0:11** · *The three problem cards*
> Today, Stripe can hold up to 25% of a risky merchant's sales for 90 to 180 days, even after orders are delivered. It shows: a 1.6 out of 5 Trustpilot rating.

## The solution

**0:25** · *The $100 order stepper*
> Thaw replaces the calendar with proof. One $100 order starts with the same $10 hold.

**0:32** · *Click to "Verified"*
> 3D Secure verifies the buyer: the fraud part comes back.

**0:38** · *Click to "Delivered"*
> Delivery is confirmed: the delivery part comes back.

**0:43** · *Clicks to "1 month" and "3 months"*
> The rest fades as disputes become unlikely.

## Results

**0:47** · *50% less, Day 7*
> I tested this on a year of payments from 300 simulated stores, including ones that fail and ones that cheat: half as much money held, and half of it back by day 7 instead of day 90, without raising losses.

## Merchant View

**1:05** · *Maya's store: $4,587 vs $8,654*
> This is what a merchant sees: $4,587 held instead of $8,654, and every dollar has a reason.

**1:14** · *Click "Add tracking", +$2,597*
> She adds tracking to 234 orders, and $2,597 comes back on the spot.

**1:23** · *The one-sale simulation plays*
> Across 670,000 simulated orders, a third of the money comes back the day of the sale and half by day 7, while today's reserve waits until day 90.

## Admin View

**1:36** · *Same store, safety switch flips to "Today's reserve" and back*
> Here's the same store, seen by Stripe's risk team. If anything looks wrong, Risk moves it back to today's reserve in one click.

**1:50** · *The year across 300 stores replays*
> Across 300 stores over a year, Thaw holds about half as much, and the safety switch caught ten of sixteen failing stores, a median of nine days early.

**2:04** · *Stress test: A normal year*
> In a normal year, it's safe in all six simulated years.

**2:10** · *No safety minimum*
> Without the safety minimum, losses go over the limit.

**2:15** · *Three times more stores fail*
> Three times more failures: still safe.

**2:19** · *Scammers fake delivery proof*
> The real risk is fake delivery proof.

**2:24** · *Scammers, but new stores start on today's reserve*
> The fix: new stores start on today's reserve until they earn trust. Safe again, with 37% less held.

## Close

**2:34** · *Back to the home page*
> Next, I'd run this test in shadow mode on Stripe's real payments. Merchants get money back as fast as they can prove it's safe, and Stripe keeps every control. Thanks for watching.

---

## Recording the voiceover

- **Easiest:** open the video in iMovie (free on your Mac), choose **Record Voiceover**, and read the lines while it plays. QuickTime can't record over a video, so use iMovie or a video editor.
- **Cleanest:** record each line as its own audio clip in QuickTime (**File → New Audio Recording**), then drop each clip at its timestamp in iMovie, CapCut or Descript. Mistakes only cost you one line.
- Use earbuds with a mic, or sit close to your laptop mic in a quiet room with soft furnishings.
- If you change the script or the site, re-record the video with `npm run record -- --url http://localhost:5173` while `npm run dev` is running. It writes a fresh cue sheet with new timestamps to `demo/thaw-demo-cues.md`.
