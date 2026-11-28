# Master Closeout Wave 11 — Connected Frontend Workflow Completion

**Checkpoint:** 16 November 2026  
**Repository:** `F:\Rudra Health Care Centre\rudra-health-os`  
**Git:** `master` at `872eeebfd05adc30edb90490bbe4d3b2369add91`; no commit, push, merge, rebase or deployment performed.

## Outcome

Wave 11 improves recoverability and status accuracy across the public-enquiry-to-reception path and the field-to-branch dispatch path. It does not establish complete user journeys or final screen acceptance. Existing backend contracts, role/centre checks, optimistic concurrency and safety restrictions remain in force.

| Measure | Wave 10 baseline | Wave 11 verified |
|---|---:|---:|
| Canonical screens | 178 | 178; IDs retained |
| Partial / restricted | 151 / 27 | 151 / 27 |
| Complete / finally accepted | 0 / 0 | 0 / 0 |
| Full Vitest | 975 reported | **981 passed across 249 files** |
| Focused workflow/UI/API tests | — | **27 passed across 9 files** |
| ESLint / TypeScript | Reported passed | Passed |
| Production build | Reported passed | Passed; 406 routes generated |

## Screens and changes

### R014 — Lead detail / follow-up

The canonical `/crm/leads/[id]` alias resolves to the protected Lead 360 workflow at `/leads/[id]`. Failed detail reads now clear stale data and provide retry. Optional assignee-load failure does not prevent viewing an otherwise authorized lead. After an action, the UI distinguishes a saved action from a failed refresh; if the outcome is uncertain it clears the stale record so another mutation cannot be blindly submitted. Existing permission and consent gates are unchanged.

### R015 — Calls / enquiries / callbacks and related website-enquiry queue

The canonical `/staff/enquiries` route redirects to `/leads/public-enquiries`, the centre- and permission-gated website enquiry review queue. The reviewed screen matrix also maps R015 to the separate unified communications queue at `/communications`; Wave 11 records both paths explicitly and does not claim telephone handling or external messaging. The queue already supported review, follow-up task creation and conversion under protected APIs; Wave 11 adds stale-response sequencing, clears rows when changing scope/page, prevents competing review/follow-up actions, and shows an empty result for the selected scope. Enquiries remain enquiries until an authorized conversion occurs.

### L005 — Dispatch planning & batches

`/branch/dispatch` now ignores out-of-date responses and invalidates in-flight requests when the view is disposed. A query clears stale specimens, batches, procedures and selection. Packing stays unavailable until specimen, procedure and batch reads succeed. A retry action recovers failed reads. Network-uncertain writes clear selection and advise staff to reload/verify before retrying; conflict responses refresh current server state. The existing `POST /api/samples/dispatch` contract is unchanged.

### L006 — Driver / courier handover

`/branch/handover` remains the protected batch queue and links to `/samples/dispatch/[id]` for batch detail. The detail view now provides retry after load failure, avoids stale asynchronous updates, preserves `expectedVersion` checks and refreshes on version conflict. Messages identify staff-recorded handover separately from external receipt. An uncertain result requires a reload before another action.

## Verification and limits

- Full Vitest: **981/981 across 249 files**.
- Focused Wave 11 selection: **27/27 across 9 files**, including request sequencing, queue/detail retry markup, lead/enquiry component rendering, and existing public-enquiry and dispatch API tests.
- ESLint: passed without warnings on the final run.
- TypeScript: passed.
- Production build: passed; Next generated 406 route entries.
- Inventory generator: regenerated 178 canonical rows and retained Wave 11 frontend/QA evidence and pending acceptance fields.
- Browser/computer-use inventory was checked; the browser access host returned `Browsers: Error: The browser access host is unavailable`. No real browser interaction, visual comparison, responsive-device, keyboard or screen-reader acceptance was performed. Static server-rendered markup tests do not replace these checks.
- The full suite ran before a final text-encoding-only punctuation cleanup in the dispatch component. After that cleanup, the focused 27-test selection, ESLint, TypeScript and production build were rerun and passed; the full suite was not rerun again.
- No new database migration or API contract was added. No persistent database was accessed or changed.
- No external provider was activated. No real patient/staff data was used.

## Screen acceptance and remaining gates

R014, R015, L005 and L006 remain partial. All four retain pending manual desktop/mobile and final Owner/QA acceptance. The screen classifications remain **151 partial, 27 restricted, 0 complete, 0 finally accepted**. The checked components have no browser acceptance evidence, and the test selection does not prove all business actions or permission combinations end-to-end.

Public acknowledgement remains an enquiry acknowledgement; it does not imply a reserved slot, confirmed appointment or payment. Staff-entered field/custody status is not proof of physical collection, carrier acceptance or Metropolis receipt. Approved collection procedures, patient identity/clinical checks, legal pricing/invoice policy, real scanner qualification and external lab verification remain gated as before.

## Next work

1. Establish an approved isolated HTTP/browser harness and execute actual public enquiry, reception, appointment/order and field/branch journeys with synthetic identities and centre-scoped roles.
2. Add interaction-level tests for mutations and failure/retry/concurrency behavior, beyond static markup tests.
3. Reconcile the R015 canonical calls/enquiries grouping with its two current routes and retain explicit limitations in the inventory.
4. Continue broader CRM, appointment, order and field workflows only against their existing server-authorized contracts.
5. Keep visual comparison and Owner/QA sign-off pending until approved reference images and a functioning browser host are available.

## Final preservation

The final restricted preservation copy is `F:\Rudra Health Care Centre\Rudra Health OS Audit\Wave11_Final_Preservation_2026-11-16_R2`. It contains the changed/untracked worktree files and the external four-row screen overlay, with separate `snapshot` and `restore-check` copies. Snapshot and restore-copy SHA-256 checks are recorded in its manifest and verification file. The ACL grants access to the current account, SYSTEM and local Administrators; environment secrets, `.git`, dependencies, build output and private storage are excluded. The earlier R1 snapshot predates the final Unicode text correction and is superseded by R2.

No staged changes, commit, push, deployment, persistent migration, credential rotation, provider activation or production-data access occurred.
