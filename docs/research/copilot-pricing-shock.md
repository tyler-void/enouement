# Research — The Copilot Pricing Shock (the catalyst)

_Last updated: 2026-06-09 (≈9 days after the change took effect)._

## What happened

On **2026-06-01**, GitHub Copilot moved **every plan to usage-based billing**. Instead of
counting "premium requests," each plan now includes a monthly allotment of **GitHub AI
Credits**, with paid plans able to buy more. Credits are consumed based on the **tokens**
each interaction uses, priced at the listed **per-model API rates**.

- **Copilot Pro:** $10/month in AI Credits included.
- **Copilot Pro+:** $39/month in AI Credits included.
- GitHub's framing: align pricing with actual usage for a "sustainable" business.

## The backlash

The change triggered significant developer pushback (Reddit, X, TechCrunch, Hacker News):

- Reported monthly costs jumping **up to 25×** ("$29/mo → ~$750/mo" in one widely-shared case).
- **Agentic sessions consuming $30–40 each**, depending on intensity.
- A **Pro user's $10 credit exhausted in a single working session**.
- TechCrunch headline: *"'What a joke': GitHub Copilot's new token-based billing spurs
  consternation among devs."*

## Why this matters for Eco-MCP

This is the market validation. The pain the project was already targeting (token burn on
agentic coding) just became a billed, visible, 25×-larger line item for every Copilot user
overnight. The same dynamics apply to Cursor, Cline, and direct-API workflows — usage-based
pricing exposes exactly the inefficiencies (raw `grep`/`cat`, noisy logs, premium models on
trivial tasks, tool-schema bloat) that the gateway eliminates.

**Pitch hook:** "Copilot's June 1 pricing change turned token waste into a 25× bill. Eco-MCP
gives that money back."

## Sources

- [GitHub Copilot is moving to usage-based billing — GitHub Blog](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/)
- [Community Discussion #192948](https://github.com/orgs/community/discussions/192948)
- [GitHub Copilot Plans & pricing](https://github.com/features/copilot/plans)
- ['What a joke' — TechCrunch, 2026-05-30](https://techcrunch.com/2026/05/30/what-a-joke-github-copilots-new-token-based-billing-spurs-consternation-among-devs/)
- [New Pricing Shock: bills jumped 25x — Memeburn](https://memeburn.com/github-copilots-new-pricing-shock-some-developers-say-their-ai-coding-bills-jumped-25x-overnight/)
- [Copilot Ends Flat Pricing June 1 — Enterprise DNA](https://enterprisedna.co/resources/news/github-copilot-usage-based-billing-enterprise-2026/)
