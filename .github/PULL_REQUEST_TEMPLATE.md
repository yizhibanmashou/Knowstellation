## Summary

<!-- What changed, and why? -->

## Verification

<!-- List tests, audits, builds, or manual checks. Say why if skipped. -->

- [ ] `npm run test:node`
- [ ] `npm run test:python`
- [ ] `npm run build`
- [ ] `npm run test:e2e` when browser behavior changed
- [ ] `npm run audit:graph` when graph data changed

## Data and Security

- [ ] Runtime data in `public/data/` is in sync when generated data changed
- [ ] No secrets, local caches, private source material, or provider keys are included
- [ ] LLM keys remain server-side and are not exposed through `VITE_*`

## UI Notes

<!-- For visible changes, list routes, viewport sizes, and screenshots/video if useful. -->
