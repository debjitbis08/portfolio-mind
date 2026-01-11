# Tier 2 Analysis Depth Review

## Status: IN PROGRESS

**Date:** 2026-01-08
**Goal:** Assess why Tier 2 per-stock analysis feels shallow and propose concrete enhancements.

## Context
- User feedback: Tier 2 analysis for individual symbols is not deep enough.
- Focus areas: data inputs (news depth), prompt structure, model choice, synthesis steps.

## Initial Findings
- Tier 2 uses `getStockNews()` headlines + summary only; no full article content is passed.
- Prompt emphasizes long-term framing but does not require explicit evidence extraction or contradiction checks.
- No explicit primary-source section (exchange filings/press releases) in Tier 2 input.
- Single-pass LLM output; no intermediate "research" step.

## Implemented Enhancements (In Progress)
- News tool now returns readable article content excerpts for Tier 2 prompts.
- Tier 2 prompt now includes a mandatory evidence checklist (facts/opinions/contradictions/missing data).
- Added explicit downgrade of broker/analyst opinion notes in prompt.
- Added BSE corporate announcements fetch and content extraction for Tier 2 evidence.
- Tier 2 now refreshes technical indicators if cached data is older than 5 minutes before analysis.
- Added company knowledge base (user research) and Reddit sentiment sections to Tier 2 prompt.
- News tool now resolves company name from holdings, watchlist, or BSE mapping before searching.
- Added manual concall text input in earnings UI and API support for text-based processing.
- Tier 2 deep analysis now warns about missing/stale financials, concalls, and technicals and requires user confirmation before proceeding.

## Next Steps
- Validate new Tier 2 prompt output shape (evidence_checklist included in JSON).
- Monitor runtime costs and latency for filings/news content extraction.
