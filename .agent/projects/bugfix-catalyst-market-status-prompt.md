# Bugfix - Include Market Status in Catalyst Prompt

**Status**: ✅ Done
**Date**: 2026-01-08
**Goal**: Include market open/closed status in the Catalyst Gemini user prompt.

## Changes
- Added market status line using `getMarketStatusMessage()`.

## Files
- `src/lib/catalyst/catalyst-gemini.ts`
