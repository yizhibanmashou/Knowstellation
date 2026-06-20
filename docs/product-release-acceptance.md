# Product Release Acceptance

Generated for the current Formula Atlas product release pass.

## Release Decision

The learner-facing product is releasable with the current concept graph quality gate.

The internal symbol-concept audit is intentionally stricter than the public product gate. Open internal review work does not leak into the learner-facing data: public concept views are generated only from approved, edited, or reviewed concept mappings, and public data is sanitized before release.

## Current Evidence

- Public concept views: 508
- Public concept search entries: 508
- Public concept graph chapters: 35
- Public concept graph release blockers: 0
- Internal symbol-concept entries: 19116
- Internal reviewed entries: 2251
- Internal open review entries: 16963

## Known Release Warnings

- `appendix5` and `appendix6` currently have no public concept views.
- The internal symbol-concept map still has 16865 unreviewed entries and 98 entries marked ambiguous or needs_revision.

These are acceptable for release because unreviewed and needs_revision concepts are excluded from public concept views and search.

## Acceptance Commands

Run the full release check before publishing:

```bash
npm run release:check
```

This command rebuilds concept data, syncs public data, runs the product release audit, runs Node tests, builds the production bundle, runs Playwright E2E tests, and runs Python tests.

For a faster data-only release gate:

```bash
npm run release:audit
```

The release audit must report:

- `release gate: passed`
- `blockers: 0`

Warnings are allowed only when they describe internal review backlog or chapters with no approved public concept views.

## Product Data Boundary

Public data must not contain:

- `review_status`
- `review_flags`
- `reviewed_by`
- `reviewed_at`
- `review_notes`
- `symbol_concepts`
- `symbol_concept_map`
- `review_summary`
- `concept_review_audit.json`
- `concept_merge_candidates.json`
- `*_symbol_concept_map.json`

These fields and files are internal review artifacts only.

## Follow-Up Data Work

The next data-quality pass should prioritize:

1. `needs_revision` entries, especially Chapter 6 concepts demoted during auto-review recheck.
2. High-value formulas with no approved concept view.
3. Appendix 5 and Appendix 6 only after matrix/vector concepts can be named specifically enough for learners.
