# Pricier picks must earn their price

Owner, 23 Oct 2026 (robot vacuums): the "Vidējā klase" pick cost 50 € more than the budget pick and its only listed difference was "par 17 dB skaļāks". A shopper cannot see why paying more makes sense. This applies to every category, because the cause is in the shared ranking and card code.

## Causes

1. **Picks are chosen by price position, not by being better.** `pickThree` takes the best value overall, the best value in the lower third of prices and the best in the upper third. The upper-third pick can have a *lower* quality score than a cheaper pick. A product that costs more and is not better is "dominated" and should not be offered.
2. **The box lists only spec differences, mixed together.** It compares the category's `compare` attributes. But the quality score also counts the Trilio rating, the brand's reliability grade and matches with the shopper's answers, and none of those appear. Gains and downsides were in one line under a neutral heading ("Atšķirības pret …").

## Changes

1. **No dominated picks** (`src/domain/ranking/rank.ts`): a pick is only added when no other pick is both cheaper (or the same price) and at least as good. Each pricier pick therefore has a strictly higher score than every cheaper pick. When no such product exists, fewer picks are shown: two honest options beat three where one makes no sense.
2. **Reasons that match the score** (`src/domain/delta/delta.ts`): besides spec differences, the comparison reports:
   - a higher (or lower) Trilio rating;
   - a more reliable brand for the category (the grade from `data/brands.json`);
   - answers the pricier product matches and the cheaper one does not.
3. **Gains first, trade-offs separately** (`ResultCard`):
   - "Par +50 € vairāk nekā «Budžeta variants»";
   - "Iegūsti: …", listing the gains;
   - "Bet: …", a muted line with the downsides.

   If nothing measurable is better, the card says so instead of listing only downsides.

## Tests

- **Unit:** a dominated candidate is never picked; gains and trade-offs are split; rating, brand and fit reasons appear.
- **E2E, every category:** on each results page, every pricier card has a strictly higher score than every cheaper card, checked through the page's own data attributes. Every card with a comparison box lists at least one gain.
