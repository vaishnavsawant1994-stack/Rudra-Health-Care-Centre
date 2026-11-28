# Historical Gitleaks finding disposition — 24 November 2026

## Scope

Reviewed the nine `generic-api-key` matches reported by the full-history Gitleaks job for PR #11 at commit `6f6a31e565e0005eb2012bdbdc8282e5de7826c9`. The workflow SARIF artifact identifies all nine source locations at historical commit `4efa93ea5792f52dda6209d91124aa7543d2719f`.

## Finding-by-finding review

| # | Historical source location | Finding context | Disposition |
|---|---|---|---|
| 1 | `src/app/api/doctors/[id]/route.test.ts:19` | Loopback PATCH test; static UUID-format `idempotency-key` fixture and synthetic centre identifier | Test-only idempotency token; not an API credential |
| 2 | `src/app/api/doctors/route.test.ts:24` | Loopback POST test; static UUID-format `idempotency-key` fixture and synthetic record fields | Test-only idempotency token; not an API credential |
| 3 | `src/app/api/business-relationships/[id]/route.test.ts:19` | Loopback PATCH test; static UUID-format `idempotency-key` fixture and explicitly synthetic relationship data | Test-only idempotency token; not an API credential |
| 4 | `src/app/api/business-relationships/route.test.ts:24` | Loopback POST test; static UUID-format `idempotency-key` fixture and synthetic relationship data | Test-only idempotency token; not an API credential |
| 5 | `src/app/api/metropolis/status/route.test.ts:20` | Loopback status API test; static UUID-format `idempotency-key` fixture and explicitly synthetic external references | Test-only idempotency token; not a provider credential |
| 6 | `src/app/api/communications/governance/route.test.ts:9` | Shared policy-test body; static UUID-format `idempotencyKey` fixture and synthetic policy data | Test-only idempotency token; not a messaging-provider credential |
| 7 | `src/app/api/metropolis/references/route.test.ts:19` | Loopback validation test; static UUID-format `idempotency-key` fixture | Test-only idempotency token; not a provider credential |
| 8 | `src/app/api/metropolis/references/route.test.ts:28` | Loopback authorization test; static UUID-format `idempotency-key` fixture and explicitly synthetic external references | Test-only idempotency token; not a provider credential |
| 9 | `src/server/communication-governance-policy.test.ts:5` | Static UUID-format idempotency fixture used by policy unit tests | Test-only idempotency token; not a communications credential |

## Decision and remaining control

For each finding, the source is a test file and the matched value is used as an idempotency key, not as an authentication secret. The surrounding request and data are synthetic and local-test-only. No evidence in these nine locations indicates a live credential or reusable provider key. The values themselves are intentionally omitted from this report.

The owner’s final completion directive authorizes a narrow disposition for these reviewed fixtures. `.gitleaksignore` now contains exactly the nine full-history fingerprints listed by the scanner (commit, file, rule and line); it has no path-wide or rule-wide exclusions. This keeps detection active for new values, new commits, other lines and all other rules. CI must confirm the current Gitleaks action honors these fingerprints before the exception is considered effective. If a future scan reports a different fingerprint, it remains blocking until separately reviewed. The underlying values are intentionally omitted from this report.

## Picomatch advisory status recheck — 26 November 2026

GitHub Advisory Database now marks GHSA-fc5q-39xc-vjpf / CVE-2026-112366 **withdrawn on 18 November 2026**, stating that it was withdrawn because it is not a security issue. The earlier project notes describing this advisory as an active unresolved vulnerability are superseded by that source status. See the [current advisory record](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).

Against the current unchanged dependency lockfile, `npm explain picomatch` shows the installed picomatch copies only beneath the development dependency chain (ESLint tooling, TypeScript ESLint, Vite and Vitest). `npm audit` and `npm audit --omit=dev` both returned zero vulnerabilities on 26 November 2026. No override or finding suppression was added. This does not resolve the separate full-history Gitleaks check or constitute a fresh CI/build review.
