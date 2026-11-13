# Rudra Health OS — 178-screen implementation matrix

This is the reconciliation index for the proposed inventory in `SCREEN_SPEC_178.md`.
The generated row-level evidence is in `SCREEN_IMPLEMENTATION_MATRIX.csv`.

Regenerate the inventory after route/source changes with:

```powershell
node scripts/reconcile-screen-inventory.mjs
```

## Current source reconciliation

- Parsed **178/178** screen IDs from the proposal.
- **59** IDs have an exact page file at the proposed route. This is route evidence only; it does not establish functional completion. The staff-protected `/reports` page is not treated as the public W015 route.
- **119** IDs have no exact page at the proposed URL. **22** have explicit source-validated mappings to grouped or canonical routes; **97** proposed routes still need an explicit screen-to-source/action mapping. The matrix lists candidate module routes, APIs and tests, which must not be mistaken for screen-specific evidence.
- Current evidence-based classifications are **39 partially implemented with page/API/test candidates**, **22 partially implemented with explicit source-validated mappings**, **92 partially implemented with source/action mapping unresolved**, and **25 blocked by an identity-proofing, policy or external dependency**. These total 178 and are the generator's mutually exclusive labels, not a measure of completed functionality.
- No screen is marked fully implemented or “implementation complete, acceptance pending” by this generator. File presence, route manifests, tests in the same module and candidate API matches are not enough evidence to make that claim.

## Reading the CSV

Each row preserves the proposed ID, title, URL, access group, controls and authoritative objects from `SCREEN_SPEC_178.md`. It then records the exact source route if found, possible grouped routes, page imports, candidate API routes, schema symbols imported by those APIs, permission checks and related test files.

The source/API/test associations are deliberately labeled as candidates. They are produced from route/module structure and imports; they do not prove that a candidate endpoint serves a particular screen, that every control works, or that its test covers all listed requirements. The acceptance column remains pending because the consolidated manual desktop/mobile campaign has not been completed.

The implementation classifications are evidence-conservative:

1. **Fully implemented for local development:** none promoted automatically. Requires verified functional requirements and relevant automated evidence.
2. **Partially implemented:** page source exists or related module sources suggest a grouped implementation, but individual behavior is not fully reconciled.
3. **Not started:** the generator does not currently assign this label when a proposed route lacks a file, because a consolidated implementation may exist. Those rows remain “mapping unresolved” until inspected; this avoids treating missing route files as proof of absent functionality.
4. **Blocked:** identity proofing or a real external/business/clinical/legal decision blocks the proposed capability.
5. **Implementation complete, acceptance pending:** none promoted automatically; requires evidence that functionality is complete before acceptance is the only remaining gate.

The user-approved identity-proofing decision is to keep patient portal accounts disabled until a method/provider is approved. This matrix does not enable patient registration, sign-in or medical-data access. W003/W005 now use only the verified public catalogue; W004/W006 no longer fall back to illustrative test/package records. W014's canonical `/track` route redirects to the privacy-safe tracking explanation. W023/W024 and W026 have canonical route files, but their educational and legal content remains unapproved and those screens are still blocked/pending acceptance. W009's canonical checkout path displays an unavailable state without starting payment. These route/source updates do not change the acceptance column.

## Next reconciliation work

Resolve the remaining 97 proposed-route mappings against the actual consolidated pages, then inspect every mapped screen's rendered controls, API mutations, database records, permissions and automated test scope. Update classifications only with that evidence. Reconcile any approved scope changes without deleting the original IDs. The 25 blocked rows still require their named identity, policy or external dependency before those capabilities can be enabled.

## Phase 01 checkpoint

The detailed W001–W026 status, per-screen route and evidence, approval gates, automated verification results, and manual acceptance status are recorded in [`PHASE_01_PUBLIC_ACCEPTANCE.md`](PHASE_01_PUBLIC_ACCEPTANCE.md). At the 13 November 2026 checkpoint, 17 screens have partial implementation evidence, 9 remain restricted by approval dependencies, and 0 are fully accepted screen-by-screen. This does not alter the generator's global mapping categories above. Phase 02 prerequisites are documented in [`PHASE_02_PORTAL_READINESS.md`](PHASE_02_PORTAL_READINESS.md).
