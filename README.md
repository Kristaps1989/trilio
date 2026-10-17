# Trilio — AI-guided appliance buying (handoff package)

Trilio helps people in the Baltics pick the right household appliance. Instead of a filter-heavy price-comparison page, a short Typeform-style questionnaire asks only what matters for that product type, then shows the **three best options** across partner shops, with prices, stock, delivery dates and an honest explanation of what each extra euro buys.

Business model:
- **Referral/affiliate commission** from partner shops.
- **"Cenu radars"** (price radar) subscription, **€1/month**, which notifies users when the price of a tracked product (or a comparable model) drops.

This folder is the handoff from the design phase (done in Claude Design) to development in Claude Code.

## What's inside

| Path | What it is |
|---|---|
| `CLAUDE.md` | Instructions for Claude Code: stack, conventions, non-negotiable product rules. **Read first.** |
| `docs/PRODUCT_SPEC.md` | Full functional spec: every flow and rule decided during design. |
| `docs/DATA_MODEL.md` | Proposed database schema and data sources. |
| `docs/BRAND.md` | Logo, colours, typography, UI tokens. |
| `docs/ROADMAP.md` | Suggested build phases and open questions. |
| `data/categories.json` | 8 category groups → 30+ subcategories with their questions, answer options, hard/soft filter flags, card reasons and comparison-table labels. Exported from the prototype. |
| `data/sample-products.json` | ~250 **sample** products with offers (fake prices) for seeding and tests. |
| `design/prototype/*.dc.html` | The clickable prototype screens (Claude Design format, not standalone HTML). Use them as a visual reference; the live version is linked below. |
| `reference/prototype-logic.js` | The prototype's JavaScript: scoring, filtering, tiers, deltas, energy cost and compare table. Reference for business logic only. **Do not copy it as production code.** |

Live prototype (Claude Design canvas): https://claude.ai/artifact/2bHvWmZsHEULjZPTGYwXLw

## Getting started in Claude Code

1. Create a new Git repository and copy this folder into it.
2. Open it in Claude Code and start with:
   > Read CLAUDE.md and docs/, then propose the project scaffold for Phase 1 from docs/ROADMAP.md. Ask me before choosing anything not decided there.
3. Work phase by phase. Phase 1 has no accounts or payments: only the questionnaire, results and affiliate links.
