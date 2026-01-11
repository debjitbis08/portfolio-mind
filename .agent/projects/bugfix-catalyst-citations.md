# Bugfix - Catalyst Citations Mismatch

**Status**: 🟡 In Progress
**Date**: 2026-01-08
**Goal**: Fix incorrect citation links shown on catalyst cards by ensuring updated catalyst text uses matching source metadata.

## Context
- UI shows catalyst citations pointing to unrelated sources (mismatch between inline [n] and source list).
- Likely caused by updates to `predictedImpact`/`shortTermThesis` without updating `sourceCitations`.

## Plan
- Inspect catalyst discovery/update pipeline for citation persistence.
- Ensure `sourceCitations` (and related article ids where relevant) are updated whenever impact/thesis is updated.
- Keep citations aligned with the numbered news list used in the LLM prompt.

## Files
- `src/lib/catalyst/discovery.ts`
- `src/components/catalyst/CatalystPage.tsx`
- `src/pages/api/catalyst/potentials.ts`

## Progress
- [x] Reviewed UI rendering and API for citations.
- [x] Identified missing updates to `sourceCitations` during catalyst updates.
- [x] Implement fix in discovery update paths.
- [x] Added full-article and PDF content enrichment in catalyst discovery pipeline.
- [ ] Verify against UI behavior.

## Notes
- Avoid touching private data in `/transactions` or `.env`.
- Content enrichment now attempts HTML readability extraction and Gemini-backed PDF text extraction before discovery prompts.
