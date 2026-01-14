# Feature: Catalyst Performance Copy Markdown Buttons

## Status: COMPLETE

**Date:** 2026-01-08
**Goal:** Add copy-as-markdown buttons for key metrics and holdings on the catalyst performance page.

## Scope
- Add a key metrics copy button on `/catalyst/performance`.
- Add a holdings table copy button in the positions section.
- Generate markdown for metrics summary and holdings table data.

## Progress
- Added markdown copy helpers and buttons in the performance page component.
- Key metrics and holdings table markdown generation wired to clipboard.

## Next Steps
- Optional: Verify UI on `/catalyst/performance` and confirm clipboard output.

## References
- `src/components/catalyst/CatalystPerformancePage.tsx`
