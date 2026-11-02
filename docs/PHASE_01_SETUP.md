# Phase 01 — local setup and implementation status

This application is a fresh implementation. Phase 01 adds PostgreSQL-backed staff identity, organization/centre scope, access checks and audit foundations. Use synthetic identities only until a separate security and operations review authorizes real use.

## Technology choices

- **Drizzle ORM + PostgreSQL** for typed business tables and explicit SQL migrations. The migration runner records checksums, rejects edited applied migrations, and serializes execution with an advisory lock.
- **Better Auth** with the Drizzle adapter for database-backed sessions and the Generic OAuth/OIDC plugin. Sign-up and password authentication are disabled. Discovery must provide verified ID-token metadata. The plugin verifies signature, issuer, audience, expiry and nonce before the configured profile mapper reads signed `sub`, `email`, `email_verified` and `acr` claims. Sign-in then requires a matching pre-provisioned active external identity and exact email match. The MFA `acr` value must be confirmed with the selected identity provider.
- **Linting** uses ESLint 10 with the direct Next core-web-vitals plugin, current React Hooks plugin and TypeScript ESLint config. The old `eslint-config-next` package was removed because its bundled React, import and accessibility plugins declare peer support only through ESLint 9; ESLint 9 is EOL as of the project's current date. The direct Next plugin supports ESLint 10; accessibility checks still rely on semantic markup and browser review.
- Authorization is evaluated in server routes and server-rendered screens. Client visibility is not an authorization boundary.

## Windows / VS Code setup

1. Install Node.js 24 LTS. If PostgreSQL is missing, download the PostgreSQL 17 Windows installer from the [official PostgreSQL Windows downloads page](https://www.postgresql.org/download/windows/). Select the server and command-line tools; start the PostgreSQL service after setup. This project does not install system-level software for you.
2. PostgreSQL is installed at `C:\PostgreSQL\17`. The owner selected a fresh reinstall with a password entered privately in the installer. Do not run `scripts/bootstrap-local-postgres.ps1`; it is disabled after security review. After reinstall, authenticate in SQL Shell, run `ALTER SYSTEM SET listen_addresses = 'localhost';`, exit SQL Shell, restart `postgresql-x64-17` through Windows Services, then reconnect and confirm `SHOW listen_addresses;` returns `localhost`.
3. In SQL Shell (`psql`) authenticated as the local database administrator, run `\i 'F:/Rudra Health Care Centre/rudra-health-os/scripts/provision-local-postgres.sql'`. Then set passwords interactively with `\password rudra_dev_migrator`, `\password rudra_dev_app`, and `\password rudra_test_runner`. Do not paste or store the passwords in SQL files, shell history, or chat.
4. Create ignored `.env.local` with `DATABASE_URL` for `rudra_dev_app`, `DATABASE_MIGRATION_URL` for `rudra_dev_migrator`, and `DATABASE_TEST_URL` for the isolated `rudra_test_runner`. Use `127.0.0.1` and the exact database names. Keep the file restricted to your Windows account. Leave OIDC unset until the approved test provider is configured.
5. Configure an approved OIDC test tenant and confidential client. Register `http://localhost:3000/api/auth/callback/rudra-oidc` as the callback URL. Set issuer, discovery URL, client ID/secret, and the exact MFA assurance claim in `.env.local`.
6. Set a random `BETTER_AUTH_SECRET` with at least 32 characters. A local example can be generated with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
7. Run `npm ci`, `npm.cmd run db:migrate`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test`, then `npm.cmd run dev`.
8. Bootstrap the owner only against a new empty development database. Temporarily set `RUDRA_BOOTSTRAP_ENABLED=1` and a random `RUDRA_OWNER_BOOTSTRAP_TOKEN` (at least 32 characters), then run `npm.cmd run owner:bootstrap` in an interactive VS Code terminal. The token prompt is hidden. Supply the owner's immutable OIDC subject from the identity provider. Afterwards turn bootstrap off and remove the token from `.env.local`.

The provisioning file has a preflight collision check, stops on the first psql error, contains no password literals, revokes default `PUBLIC` database/schema access, gives the development app role DML and sequence privileges only, and keeps the test runner confined to the disposable test database. It is a plan only; it has not been executed. If it reports an error, stop and inspect partial state before attempting cleanup or rerun. Do not replay it if a named role/database already exists.

Use `npm run db:integration` only when `DATABASE_TEST_URL` points to a disposable database whose name contains `test`. It applies migrations twice, checks tenant constraints, duplicate assignments and audit immutability, then rolls back synthetic records.

## Implemented screens and operations

| Screen | Status |
| --- | --- |
| `/staff` sign-in | OIDC button is enabled only when all database and identity configuration is valid; no local credentials or sign-up |
| `/staff/workspace` | Protected shell, server permission required; shared admin shell provides server-backed sign-out |
| `/owner` | Protected dashboard shell with live organization read |
| `/owner/settings` | Protected organization detail read; organization update API validates and audits changes |
| `/owner/centres` | Protected centre listing and creation; centre scope filters reads; centre edit/suspend remains pending |
| `/owner/staff` | Protected live directory and staff provisioning linked to admin-supplied OIDC issuer/subject; no local credentials |
| `/owner/staff/[id]` | Protected profile/email/provider/assignment view; display-name and account status changes; suspension/revocation deletes sessions |
| `/owner/roles` | Protected role and full permission catalog; only Owner can edit grants; super-admin role is immutable and centre roles cannot receive organization permissions |
| `/owner/assignments` | Protected current/past assignment list, create and revoke; centre scope enforced and grant escalation rejected; owner role assignment is immutable |
| `/owner/sessions` | Protected listing and server-side revocation of unexpired sessions; revocation and user sign-out are audited |
| `/owner/audit` | Protected recent events listing; hash verification CLI is available |
| `/owner/system` | Protected live DB and configuration readiness; secret values are never returned |

Every protected page checks the current database session and permission server-side. API responses distinguish missing configuration, unauthenticated, forbidden and unavailable states.

## Schema and operational limits

Migration `0001_phase01_foundation.sql` creates organization, centre, staff, role, permission, centre-scoped assignment, external identity, application configuration and append-only hash-chained audit tables, plus Better Auth session/account tables. Cross-organization assignments are rejected by composite foreign keys. Audit event updates and deletes are rejected by a database trigger.

The Generic OAuth plugin verifies ID tokens before invoking the app's `getUserInfo`; the app reads `acr` from that verified token rather than assuming the UserInfo endpoint returns it. The installed Better Auth 1.7.14 package source was inspected to confirm this order. A real provider's discovery metadata, claims, MFA `acr`, callback, login, logout and session flow still require a configured test tenant. Production secrets, backup/restore, monitoring and independent security review are not configured. Do not enter real patient data.

## Qualification results (2026-10-28)

| Check | Result |
| --- | --- |
| Fresh dependency install (`npm ci`) | Passed; 265 packages installed (266 audited); 0 vulnerabilities. One earlier retry hit a transient Windows `EBUSY`, then a normal install restored the tree and the final clean install passed. |
| Lockfile tree (`npm ls --package-lock-only --depth=0`) | Passed |
| ESLint 10 + Next / React Hooks / TypeScript plugins | Passed; direct plugin dependencies resolve without ESLint peer overrides |
| Lint / TypeScript / unit tests | Passed; 16 unit tests |
| Production build | Passed; all public, admin, staff and API routes compiled after the final changes |
| PostgreSQL migration, replay, constraints and audit integration | Skipped: PostgreSQL service and database URLs unavailable |
| OIDC login/callback/MFA/session integration | Skipped: approved OIDC test tenant and PostgreSQL unavailable |
| Browser authorization/desktop/mobile visual tests | Blocked: saved browser permission denies `http://localhost:3000`; no authenticated test identity is configured |

### Phase 01B code-only rerun before PostgreSQL installation (2026-10-28)

The workspace was rechecked. `psql`, `pg_ctl`, `postgres` and Docker are not available; there is no PostgreSQL Windows service, `.env.local`, database URL, or OIDC issuer/client configuration. No system software was installed and no credentials were created or displayed.

| Command/check | Result |
| --- | --- |
| `npm.cmd run lint` | Passed (exit 0) |
| `npm.cmd run typecheck` | Passed (exit 0) |
| `npm.cmd test` | Passed: 7 test files, 16 tests |
| `npm.cmd run build` | Passed; public pages, owner/staff pages and admin/auth API routes compiled |
| `npm.cmd audit` | Passed: 0 vulnerabilities |
| `npm.cmd ls --package-lock-only --depth=0` | Passed; installed dependency tree matches the lockfile |
| `node scripts/migrate.mjs` | Not run against a database: `DATABASE_URL` is missing; runner made no changes (exit 1) |
| `node scripts/db-integration-check.mjs` | Not run: `DATABASE_TEST_URL` is missing; runner made no changes (exit 1) |
| `node scripts/verify-audit.mjs` | Not run: `DATABASE_URL` is missing (exit 1) |
| `node scripts/bootstrap-owner.mjs` | Safely rejected: owner bootstrap is disabled (exit 1); no database writes |
| OIDC login, MFA, callback, logout, expiry and revocation | Skipped: no approved test provider, credentials, or database |
| Authenticated browser, desktop/mobile and cross-centre scenarios | Blocked by the saved browser permission for `http://localhost:3000`; it was not retried or worked around |

### Manual browser acceptance checklist

After PostgreSQL and an approved test OIDC tenant are configured, the project owner can run `npm.cmd run dev`, use a synthetic pre-provisioned owner and staff identity, and verify the following in a permitted browser at desktop and mobile widths:

1. Open `/owner`, `/owner/staff`, `/owner/roles`, `/owner/assignments`, `/owner/sessions` and `/owner/audit` in a private signed-out window. Confirm no protected records or actions are returned and sign-in/setup-required states are clear.
2. Sign in as the synthetic owner using the configured OIDC provider with MFA. Confirm callback validation, exact issuer/subject binding, verified email, required MFA `acr`, secure session cookie, and owner-only access.
3. Provision a synthetic staff member using the provider's immutable issuer and subject. Confirm duplicate and invalid input errors; update profile and status; suspend/revoke and confirm sessions stop working.
4. Assign a least-privilege role with one centre scope. Confirm the permitted action works, a second-centre record/action is denied server-side, and grant escalation is rejected. Revoke the role and confirm access is removed.
5. Verify session listing/revocation and audit events; attempt audit alteration only in the disposable test database and confirm the database rejects it and chain verification detects tampering.
6. Repeat the primary screens and forms at narrow mobile width. Capture any layout, loading, empty, validation, permission-denied, and setup-required issues.

These browser steps are a checklist, not completed verification. Do not use real patient information.

### Acceptance decision

Phase 01 remains **not qualified**. Mandatory PostgreSQL migration/replay/constraint/audit/owner-bootstrap tests, real OIDC and MFA flows, and permitted authenticated browser verification are outstanding. Do not start Phase 02 until these gates are completed and the results are recorded. The official Windows installer instructions above are the supported setup path.

### PostgreSQL installation follow-up (2026-10-28)

The PostgreSQL 17.11 x64 EDB installer was downloaded from the official PostgreSQL Windows download flow and its Authenticode signature validated (`EnterpriseDB Corporation`, status `Valid`). PostgreSQL was installed at `C:\PostgreSQL\17`; `postgresql-x64-17` is running, `psql --version` reports 17.11, and `pg_isready` reports `127.0.0.1:5432` accepting connections.

The installer-generated superuser password was ephemeral and was not retained in the project or displayed. The subsequent elevated database bootstrap operation was rejected by the execution approval policy before it ran. No Rudra roles/databases or `.env.local` were created. The retained `scripts/bootstrap-local-postgres.ps1` has since been reviewed and disabled; do not run it.

| Gate | Current result |
| --- | --- |
| PostgreSQL 17.11 install and service health | Passed |
| `scripts/bootstrap-local-postgres.ps1` review | Rejected for security and naming/privilege gaps; disabled and not run |
| Separate dev/test roles and databases | Pending approved authenticated recovery and revised role design |
| Clean migration, replay, constraints, audit and owner bootstrap | Pending database bootstrap |
| OIDC login/MFA/session flows | Pending approved test tenant and database |
| Authenticated browser and desktop/mobile workflows | Blocked by saved localhost browser permission; no workaround used |

Phase 01 remains **not qualified**. The code-only checks above still pass, but the PostgreSQL integration and OIDC/browser gates remain unverified.

### Latest local setup qualification (2026-10-28)

The project now includes `npm.cmd run setup:local-db`. It is an interactive, non-echo setup utility that accepts the three existing role passwords in the VS Code terminal, verifies each expected local role/database and its privilege level, then writes encoded connection URLs and a generated Better Auth secret to `.env.local`. It preserves unrelated existing environment values, protects the file with a Windows ACL, and never prints passwords or credential URLs. It does not create databases, alter roles/passwords, or run migrations. Owner bootstrap is written disabled. Standalone execution uses the project env loader.

The utility first checks PostgreSQL's effective configured listener. Current direct inspection found the service `postgresql-x64-17` running and `127.0.0.1:5432` accepting connections, but `C:\Program Files\PostgreSQL\17\data\postgresql.conf` still contains `listen_addresses = '*'`. `.env.local` and `.env` are absent. Thus no role passwords were requested, no credentials were written, and no database operation was attempted. The earlier statement that Rudra databases and role passwords were provisioned is not independently confirmed by this workspace; the first authenticated role checks remain pending.

Before running the setup utility, use authenticated SQL Shell as `postgres` to set `ALTER SYSTEM SET listen_addresses = 'localhost';`, restart the PostgreSQL service through Windows Services, reconnect, and verify `SHOW listen_addresses;` returns `localhost`. This administrative change has not been performed by the agent. Then run `npm.cmd run setup:local-db` in an interactive VS Code terminal and enter each saved role password privately. If the role/database check fails, stop and inspect provisioning; do not recreate/reset anything.

| Check | Result |
| --- | --- |
| PostgreSQL service and localhost readiness | Passed: service running; `pg_isready` reports `127.0.0.1:5432` accepting connections |
| Effective PostgreSQL listener configuration | Failed requirement: configured as `*`; private local setup correctly refuses to request passwords or write env settings |
| Local database env setup utility | Implemented and linted; not run to completion because localhost-only binding is not yet configured and no private role passwords are available to the process |
| Lint | Passed |
| TypeScript | Passed |
| Unit tests | Passed: 9 files, 22 tests |
| Production build | Passed before the final small setup-utility hardening edit; rerun required after that edit |
| Dependency audit | Passed: 0 vulnerabilities |
| Lockfile consistency | Passed: `npm ls --package-lock-only --depth=0` |
| PostgreSQL migrations, integration, audit and owner bootstrap | Skipped: `.env.local` absent; no authenticated Rudra role connection verified |
| OIDC/MFA and authenticated desktop/mobile browser acceptance | Pending approved test-provider configuration; browser permission remains restricted |

Phase 01 remains **not qualified**. The next action is the one authenticated PostgreSQL listener change and service restart described above, followed by private local entry of the three role passwords. Do not begin Phase 02 until database, OIDC/MFA and browser gates are actually verified.

## Fast-track local password + TOTP update — 2026-10-28

The current local development design uses Better Auth with PostgreSQL-backed email/password accounts and its TOTP two-factor plugin. Keycloak and external OIDC are optional future integrations and are not needed to run the local application. The unused direct `jose` dependency was removed; the optional external-identity schema remains as a future integration seam. Public sign-up stays disabled.

### Implemented

- Added the Better Auth `twoFactor` table and `user.twoFactorEnabled` migration. Enrollment uses TOTP, encrypted single-use recovery codes, a password check before enrollment, code verification before MFA becomes enabled, and a lockout after five failed attempts.
- Added owner/staff sign-in, MFA challenge and first-time authenticator setup routes. Privileged pages and APIs check the persisted MFA-enabled state on the server for every access. Sessions are database-backed, limited to eight hours, and removed when a staff account is suspended or deactivated.
- Owner provisioning is a one-time interactive command limited to the empty local `rudra_health_dev` database. It requires the exact confirmation phrase, asks for the owner password without terminal echo, checks the whole Rudra database is empty under an advisory transaction lock, and records the creation in the audit chain. It has not been run; no owner or organization was created.
- Authorized staff provisioning now creates a credential account plus an `INVITED` staff record. The administrator must provide the initial password to the staff member privately. Staff must enroll TOTP before protected operations; their administrator must activate them before normal access.
- Updated profile/directory status to show TOTP enrollment. Added suspense boundaries needed for dynamic protected routes in the production build.
- `.env.example` now documents the local database and Better Auth settings without credentials. Actual local values remain only in the ignored `.env.local` file.

### Verification actually run

| Check | Result |
| --- | --- |
| ESLint | Passed |
| TypeScript | Passed |
| Unit tests | 9 files, 21 tests passed |
| PostgreSQL migration | Passed; 1 migration applied, 2 total |
| PostgreSQL integration and migration replay | Passed; 2 migrations replayed; synthetic credential hash verification, MFA-off-before-enrollment, session/staff persistence, organization/centre constraints, duplicate assignment, and audit protections checked |
| Audit chain | Passed; valid empty chain, 0 persistent events |
| Production build | Passed; 31 routes generated |
| Dependency audit | Passed; 0 vulnerabilities reported |
| Lockfile dependency listing | Passed; direct dependency tree resolved, no Keycloak dependency; unused direct `jose` removed |

The database integration run used synthetic data in a transaction that was rolled back. It did not create a real Rudra owner, staff accounts, or patient records. Password/MFA source configuration and password hashing were checked; no browser-based password login, TOTP challenge, recovery-code, logout, or session-revocation journey has yet been exercised.

### Remaining local acceptance

1. In the project terminal, run `npm.cmd run owner:bootstrap`. The command is deliberately interactive. Confirm the one-time action, enter the organization/centre and owner display name/email, then enter and confirm the owner password only at the hidden local prompts. Never put the password in chat, a source file, a screenshot, or a report. This writes the first owner record only to the local development database.
2. Start the app with `npm.cmd run dev`, sign in at `/staff`, scan the TOTP setup secret into an authenticator app, verify the six-digit code, and store the one-time recovery codes privately. Then sign out and sign in again to verify the second-factor challenge. The `/owner/sign-in` route redirects to the shared `/staff` sign-in.
3. Verify owner dashboard, staff provisioning/status, role assignment/revocation, centre boundaries, sessions, audit activity, denied access, and desktop/mobile layouts in an authorized browser. No local browser session was launched by this agent because the saved localhost browser permission has previously rejected access. No HTTP or alternate-browser workaround was used.
4. Verify the email address ownership and account recovery policy before using real staff accounts. No outbound email provider or password-reset delivery has been configured; initial passwords and recovery codes need a private handoff. The current sign-in permits a provisioned email/password account without email verification, so this local workflow is not a production identity proof.

### Decision

The password + TOTP implementation, database migration/integration checks, and engineering checks are complete for local development. Phase 01 is **not yet fully accepted**: the one-time first-owner bootstrap, live login/TOTP/recovery/session workflows, and authorized browser checks remain pending. Do not treat the production build or unit tests as proof of those interactive flows. External OIDC and Keycloak are not blockers for local development. Production security qualification remains pending, and Phase 02 should wait until the owner has completed local MFA enrollment and the remaining protected browser workflows are accepted.

## First owner sign-in database error — 2026-10-28

After the owner bootstrap, the browser sign-in attempts returned HTTP 503. Safe server diagnostics captured PostgreSQL SQLSTATE `23502`; the failing table/column was `rateLimit.id`. The owner account itself is structurally valid: it is active, linked to a `credential` provider account, has the expected Better Auth scrypt hash format, and carries one active `owner_super_admin` assignment. The stored owner hash was not logged or tested against a password.

Root cause: Better Auth's PostgreSQL adapter advertises native UUID support. With `advanced.database.generateId: "uuid"`, it expects database-generated UUID IDs, but Rudra's Better Auth tables use `text` primary keys and the `rateLimit.id` column has no default. Database-backed rate limiting therefore attempted to insert a row without its required `id`, and the auth handler returned 503.

Fix: switched Better Auth to an application-side UUID-string ID generator, compatible with the existing text ID columns. Added a unit regression assertion for UUID generation. Verification after the fix: ESLint and TypeScript passed, 9 unit-test files / 22 tests passed, the PostgreSQL integration suite passed with migration replay, and the production build passed with all 31 routes. No schema change, password reset, owner recreation, or MFA bypass was used. The actual owner login and TOTP enrollment still need a browser retry after this fix; they are not marked passed.

## Local TOTP QR setup update — 2026-10-28

The owner completed password sign-in successfully after the auth ID-generation fix. The server also returned HTTP 200 for `two-factor/enable`; the TOTP code has not yet been verified, so MFA is still pending.

The enrollment screen now validates Better Auth's `otpauth://totp` URI and Base32 secret, then renders a QR SVG locally in the browser using `qrcode.react`. The QR URI is not sent to any QR service. Manual Base32 entry remains available only as a collapsed fallback. The screen explains that restarting an unverified enrollment replaces its pending secret and backup codes; it also requires saving the latest one-time recovery codes. Better Auth remains configured not to enable MFA until the authenticator code verifies.

QR follow-up checks: ESLint passed; TypeScript passed; 10 test files / 24 tests passed, including valid/invalid TOTP URI parsing; production build passed with all 31 routes. The user must refresh `/staff/security-setup` and begin setup again if the previous unverified secret was not accepted, then scan the newly displayed QR and verify a current six-digit code. Do not reuse old pending setup codes.

## Owner MFA enforcement investigation — 2026-10-28

The owner’s database state was checked without reading TOTP secrets, recovery codes, or session tokens: `user.twoFactorEnabled=true`, the owner’s `twoFactor.verified=true`, and 0 unexpired trusted-device verification records. The app’s TOTP and backup-code forms both pass `trustDevice:false`. The local browser observation that the dashboard appeared without an MFA prompt could not be independently reproduced by the agent because localhost browser permission remains unavailable.

The security gap was that protected access checked only the owner-level MFA-enabled flag. A still-valid session from before MFA enrollment would also satisfy that check. The authorization decision now requires all three conditions: MFA is enabled for the user, the stored TOTP enrollment is verified, and that exact session has an `mfaVerifiedAt` timestamp written only after Better Auth returns success from TOTP or recovery-code verification. Older sessions have no proof and fail closed. The sign-in UI routes a Better Auth `twoFactorRedirect` to `/staff/two-factor`; if the server claims MFA enabled but fails to issue a challenge, the UI signs out and blocks continuation.

Trusted-device bypass is disabled locally: `trustDeviceMaxAge` is zero, auth requests have any stale `trust_device` cookie stripped before Better Auth processes them, and both verification forms explicitly send `trustDevice:false`. Database inspection found no active trusted-device records. No recovery code was read or consumed.

Migration `0003_mfa_session_proof.sql` adds nullable `session.mfaVerifiedAt`. It was applied and replay verified. PostgreSQL integration now checks synthetic per-session proof persistence, and unit coverage checks that an enabled flag alone, an unverified TOTP record, or a session without proof is denied; it checks challenge routing and trust-cookie removal. Verification after the fix: ESLint passed, TypeScript passed, 11 unit-test files / 29 tests passed, PostgreSQL integration passed with 3 migrations replayed, audit chain verified with 1 event, and production build passed with 31 routes.

During the schema change, the dev server was left running while the new session-proof column was not yet present. Better Auth’s default internal error log included a session credential as a database parameter in the local terminal output. The two active owner sessions were immediately deleted (revoked count: 2). Better Auth logging is now redacted. Owner password, TOTP secret, and recovery codes were not read or changed. Current DB check: owner MFA enabled and verified; 0 active trusted-device records; 0 active owner sessions.

Live valid/invalid TOTP challenges, recovery-code use, sign-out, second fresh login, new-browser behavior, and unauthorized browser/API attempts have not been rerun after the fix. The browser tool remains unavailable under its saved localhost restriction, so these remain manual acceptance checks. The next test is at `http://localhost:3000/staff`: sign in, confirm the app shows `/staff/two-factor` rather than the dashboard, enter the current authenticator code, and confirm only then that the Owner Dashboard opens. Sign out and repeat once; a fresh challenge must appear again. Phase 01 is not yet security-qualified until that actual challenge is observed.

### PostgreSQL connection and integration qualification (2026-10-28)

The owner ran `npm.cmd run setup:local-db` from the project directory and reported successful verification of `rudra_dev_migrator` and `rudra_dev_app` on `rudra_health_dev`, `rudra_test_runner` on `rudra_health_test`, localhost-only binding, and protected `.env.local` creation. No credential values were received or displayed. The workspace then used those local settings for database checks.

| Check | Actual result |
| --- | --- |
| Authenticated local role/database connections and least-privilege checks | Passed for all three configured roles; no connection strings or passwords logged |
| Development migration | Passed: applied 1 migration |
| Development migration replay | Passed: applied 0 new migrations; 1 migration checksum verified |
| Test database migration and replay | Passed as part of integration run: 1 migration; replay applied 0 new migrations |
| PostgreSQL integration checks | Passed against `rudra_health_test`; synthetic staff and session rows persisted within a transaction; cross-organization and cross-centre assignments rejected; duplicate assignment rejected; audit actor tenant mismatch rejected; correctly computed synthetic audit hash verified; audit update/delete blocked; transaction rolled back |
| Persistent audit-chain verification | Passed: 0 committed audit events in the development database, so the persistent chain is currently empty |
| Owner bootstrap | Not performed. `npm.cmd run owner:bootstrap` failed closed because bootstrap remains disabled; no owner or organization rows were created |
| Lint / TypeScript / unit tests | Passed: lint and typecheck exit 0; 9 test files, 22 tests passed |
| Production build with `.env.local` present | Passed after placing `/staff` runtime database/session checks inside a Suspense boundary; route now builds with streamed runtime state |
| Dependency audit / lockfile | Passed: 0 reported vulnerabilities; lockfile dependency tree consistent |
| OIDC login, callback, MFA, logout and session revocation through an identity provider | Not verified: no approved test provider is configured |
| Authenticated browser and desktop/mobile workflow checks | Not verified: saved browser permission restricts localhost; no workaround used |

The earlier setup-status paragraphs above describe the pre-connection state. PostgreSQL and migrations are now locally qualified, but Phase 01 as a whole remains **not qualified** until an approved OIDC provider and MFA policy are configured and the permitted authenticated browser acceptance is completed. Owner bootstrap also remains intentionally unperformed until an approved OIDC identity is available. No real patient data was used, and Phase 02 has not started.

### Phase 01 final authentication and browser qualification (2026-10-28)

The installed Better Auth Generic OAuth implementation was inspected at the installed package version. Its provider uses OIDC discovery and JWKS-backed ID-token verification; the verifier checks signature, issuer, audience, `sub`, `exp`, `iat`, and the expected nonce. The authorization-code exchange receives the stored PKCE verifier, and the callback resolves and validates OAuth state. Rudra's provider config requires ID-token verification, PKCE, and disabled sign-up; it reads `acr`, `email_verified`, `email`, and `sub` from the verified signed ID token, then admits only an active pre-provisioned issuer/subject/provider mapping with exact email match and required `acr`. These are source/configuration findings, not an end-to-end provider login result. Existing unit tests cover the app's MFA/verified-email/provisioning checks; they do not replace a live OIDC callback test.

Keycloak is the selected local test-provider candidate: it provides real OIDC, TOTP OTP policy, and ACR-to-Level-of-Authentication mapping, and avoids creating an external cloud identity tenant. The machine already has Java 21, which Keycloak lists as supported. Docker and Podman were not found. The official Keycloak 26.8.1 Windows ZIP distribution is linked from the official downloads page, but direct retrieval by this agent was denied as a restricted URL. No alternative download route was used, and no provider software or credentials were installed. Keycloak `start-dev` is for development only and must stay loopback-only; it is not a production identity service. The user must obtain the official distribution or make the approved provider installation available locally before setup can continue. The selected provider's OTP-required flow and ACR claim must be verified together; a static/hardcoded `acr` claim is not sufficient evidence of MFA.

The owner bootstrap command remains safely disabled. Do not run it yet: it requires approved OIDC configuration, a fresh database, an explicit owner identity and a one-time token. The owner identity must come from the genuine provider and must be explicitly approved. No owner, organization, or centre has been created in the development database. Owner browser login and staff administration workflows therefore remain untested.

The user explicitly approved localhost browser testing in this conversation. The browser security tool nevertheless rejected selection of the existing `http://localhost:3000` tab: a saved user permission setting denies page observation and the tool explicitly prohibits achieving the same result through another browser surface, HTTP client, raw CDP, or indirect execution. No browser, HTTP, or alternate-surface retry was made after that rejection. Desktop/mobile visual checks and authenticated/unauthenticated browser workflow tests remain unverified. The user must change the saved browser permission using the platform's supported settings or perform the manual checklist above.

| Final Phase 01 gate | Result |
| --- | --- |
| PostgreSQL connections, migration/replay, schema and synthetic integration tests | Passed as documented in the preceding qualification section |
| Authentication configuration and installed-library source review | Passed as code/configuration inspection only |
| Live OIDC issuer/audience/signature/expiry/nonce/state/PKCE callback tests | Pending: local provider distribution not available and no provider configured |
| Real MFA/ACR enforcement, verified-email login, unauthorized identity rejection | Pending live provider test |
| First owner bootstrap | Not performed; identity not configured/approved and bootstrap remains disabled |
| Session login/logout/revocation through a real provider | Pending live provider test |
| Authenticated owner/staff workflows and desktop/mobile browser tests | Blocked by saved browser permission, notwithstanding the user's explicit approval |
| Phase 01 acceptance | **Not qualified**; keep Phase 02 on hold |

Official provider references reviewed: [Keycloak downloads](https://www.keycloak.org/downloads), [supported Java versions](https://www.keycloak.org/server/supported-configurations), [development container mode](https://www.keycloak.org/server/containers), [ACR-to-LoA and OTP authentication](https://www.keycloak.org/docs/latest/server_admin/), and [ACR token mapper](https://www.keycloak.org/admin-api/protocol-mappers). These docs establish candidate capabilities only; they do not verify a Rudra provider instance.

### Bootstrap script security review (2026-10-28)

The bootstrap script was reviewed read-only and **not executed**. Its syntax is valid, but it fails security and acceptance review:

- It prepends `host all all 127.0.0.1/32 trust`, which bypasses passwords for every database role reachable through IPv4 loopback for the interval. Local processes are not limited to the bootstrap process.
- A `finally` block normally writes back the original `pg_hba.conf`, but cannot restore it after forced termination, power loss, or process/runtime failure. It does not compare the restored file to a saved checksum or verify the active authentication method after restart.
- It changes the existing cluster's `postgres` database password and restarts the service without first proving the cluster is empty or disposable. Its collision check covers only two Rudra role names and two database names; unrelated databases are not protected from the restart or admin-password change.
- It creates `rudra_health_os` and `rudra_health_os_test`, which do not match the requested `rudra_health_dev` and `rudra_health_test` names.
- The two login roles own their databases and are then used as application/test credentials. This does not separate runtime access from migration/DDL privileges.
- Secrets are generated at runtime and are not explicitly printed. The SQL payload is piped to `psql`, while `PGPASSWORD` is inherited through process environment; local process inspection can expose environment values. `.env.local` is ACL-restricted by the script, and the project `.gitignore` ignores `.env*` except `.env.example`.

An unconditional guard now disables the script. The current `pg_hba.conf` uses `scram-sha-256` for local socket, IPv4, and IPv6 records. The current `postgresql.conf` sets `listen_addresses='*'`, so the server binds all interfaces even though the inspected HBA file contains only local-address records; localhost-only listening should be configured and verified before database use.

PostgreSQL documents that the first matching HBA rule controls authentication and that `trust` lets any connecting client log in as any database role without a password ([HBA documentation](https://www.postgresql.org/docs/17/auth-pg-hba-conf.html)). SCRAM-SHA-256 is the preferred password method ([password authentication](https://www.postgresql.org/docs/17/auth-password.html)). With the administrator password unavailable, recovery requires a Windows administrator to perform a tightly controlled local recovery action to regain/replace the `postgres` database password, followed by restoring SCRAM rules and verifying localhost-only listening. No recovery, HBA, service, role, or database changes were attempted. The required Windows administrator action must be performed through the machine's approved process; the prior elevated command was rejected by execution review and will not be retried through another mechanism.

Current PostgreSQL state: service running, port 5432 accepting local connections; no Rudra databases, roles, or `.env.local` exist. The project now distinguishes `DATABASE_URL` runtime access from `DATABASE_MIGRATION_URL` migration access. Database names and credentials remain pending; do not start migrations until authenticated administration is restored, the roles are created, and the app grants are applied.

The owner selected replacement of the fresh PostgreSQL cluster and will set a new `postgres` password in the installer. This avoids temporary `trust` authentication. Use EDB's Windows Uninstall/Change workflow to remove the current install, then reinstall PostgreSQL 17.11 from the [official PostgreSQL Windows downloads page](https://www.postgresql.org/download/windows/). Choose the server and command-line tools. The EDB Windows guide notes that the installer password is used for both the database superuser and the PostgreSQL Windows service account; keep it private. After reinstall, confirm local HBA entries still use SCRAM and configure `listen_addresses='localhost'` before creating Rudra databases. The agent has not attempted this reinstall or any other elevated action.

### Post-review qualification rerun (2026-10-28)

| Check | Result |
| --- | --- |
| PostgreSQL service / local readiness | Passed: `postgresql-x64-17` running; `pg_isready` accepts `127.0.0.1:5432`; client reports 17.11 |
| Authenticated database access | Not verified: noninteractive `psql -w` returned `no password supplied`; no `.pgpass`, `.env.local`, or process database URLs exist. No password was requested or displayed |
| PostgreSQL authentication review | Read-only: current `pg_hba.conf` uses SCRAM for local socket, IPv4 loopback and IPv6 loopback; `listen_addresses='*'` needs localhost-only hardening |
| `.gitignore` environment-file rule | Passed: `.env*` ignored except `.env.example`; no `.env.local` exists |
| Bootstrap script safety review | Failed acceptance: unsafe trust window, cluster/admin password change, restart impact, mismatched DB names, app roles own databases; script disabled and not run |
| Lint / TypeScript / unit tests | Passed: lint exit 0, typecheck exit 0, 7 test files and 16 tests passed |
| Production build | Passed; public, owner, staff, API and auth routes compiled |
| Dependency audit / lockfile | Passed: 0 reported vulnerabilities; lockfile tree consistent |
| Migration command | Skipped; exit 1 because `DATABASE_MIGRATION_URL` is absent; no connection or changes |
| DB integration command | Skipped; exit 1 because `DATABASE_TEST_URL` is absent; no connection or changes |
| Audit chain verification | Skipped; exit 1 because `DATABASE_URL` is absent; no connection |
| Owner bootstrap | Skipped; exit 1 because bootstrap is disabled and env/token is absent; no database writes |
| OIDC / browser qualification | Still pending approved test provider and permitted authenticated browser access |

### Standalone script environment and current setup check (2026-10-28)

The owner-provided setup text refers to an attachment path that was not available in the workspace; the instructions in the message were used. PostgreSQL remains 17.11, with the service running and `pg_isready` accepting local connections. A noninteractive authenticated `psql -w` check returned `no password supplied`; this check did not prompt or expose a password. No `.pgpass`, `.env.local`, `.env`, or process database URLs are present, so authenticated access and database provisioning are not confirmed.

Standalone scripts previously passed `.env.local` paths relative to the current directory. `scripts/load-project-env.mjs` now resolves `.env.local` and `.env` relative to the project root derived from its module location, with process environment values taking precedence. The migration, integration, audit-verification, and owner-bootstrap scripts all use this helper. A synthetic test verifies file precedence and process-environment precedence. The four scripts were invoked from `C:\Windows\Temp`: they resolved both env file paths in the project and failed closed with no database changes because the files/configuration are absent.

| Check | Result |
| --- | --- |
| Environment-loader test | Passed; 8 test files, 17 tests total |
| Lint / TypeScript / build | Passed |
| Dependency audit / lockfile | Passed; 0 reported vulnerabilities; lockfile tree consistent |
| Authenticated PostgreSQL access | Pending; `psql -w` exit 2 because no password source is configured |
| Development/test DB migration and integration | Skipped; no `DATABASE_MIGRATION_URL` or `DATABASE_TEST_URL`; no database changes |
| Audit verification / owner bootstrap | Skipped; no `DATABASE_URL`; owner bootstrap remains disabled |
| OIDC/MFA and browser qualification | Pending approved provider configuration and permitted authenticated browser access |

The reviewed `scripts/bootstrap-local-postgres.ps1` remains disabled. The owner selected a fresh PostgreSQL cluster replacement and will enter the new password in the installer. Do not proceed with migrations until the owner confirms authenticated access, configures localhost-only listening, runs the reviewed provisioning SQL, and creates the ignored local connection settings.

### Current qualification decision (2026-10-28; supersedes older pending setup notes above)

The owner subsequently completed `npm.cmd run setup:local-db`; all three local role/database connections and localhost-only binding were verified. The development migration and replay, test database migration/replay, synthetic PostgreSQL integration checks, persistent audit verifier (empty chain), lint, TypeScript, 22 unit tests, production build, dependency audit (0 vulnerabilities), and lockfile-tree check passed. The test integration uses a transaction and rolls all synthetic rows back. See “PostgreSQL connection and integration qualification” above for details.

Final OIDC/MFA and browser qualification is still pending. Better Auth 1.7.14 source inspection confirms OIDC discovery/JWKS token verification, issuer/audience/expiry/subject checks, nonce comparison, authorization-code state and PKCE verifier handling. Rudra's code requires the configured signed `acr`, `email_verified`, active pre-provisioned issuer+subject mapping and matching email. This is source/configuration review only; there has been no live provider or callback test. Keycloak 26.8.1 is the recommended local test provider because it supports OIDC, TOTP and ACR-to-LoA mapping; Java 21 is installed, but Docker/Podman are absent and the agent could not retrieve the official ZIP because the linked asset is restricted by the tool. No provider was installed or configured, no account was created, and no owner bootstrap was attempted.

The user explicitly approved local browser checks, but the browser tool denied localhost observation due to its saved permission setting and explicitly forbade alternate browser/HTTP/indirect workarounds. The denial is authoritative; no further browser attempt was made. Desktop/mobile screens, real owner/staff workflows, login/logout/session revocation, actual MFA enforcement and unauthorized browser access remain unverified. Phase 01 remains **not qualified** and Phase 02 remains on hold. To continue, the owner must make the official Keycloak ZIP available locally (or configure an approved OIDC test provider) and update the saved browser setting to permit localhost, or perform the manual browser checklist. Owner name, verified organization email and provider-issued immutable subject must be explicitly approved before bootstrap; no credentials should be sent in chat.

Follow-up permission result: after the first localhost denial, the owner said they would allow localhost in saved settings. No subsequent localhost browser retry has been made, so that setting change is unconfirmed. The owner later explicitly approved the Keycloak download, but the browser security tool still denied network egress to `https://www.keycloak.org` because its saved permission/managed policy did not grant the origin. The tool prohibits alternate browser, HTTP-client, raw-CDP, or indirect retrieval attempts; none were made. Continue after the saved browser/network permission is updated through supported settings, or after the owner supplies the official ZIP locally.

### Phase 01 MFA closeout (2026-10-28; supersedes earlier MFA-pending statements)

The implementation was reviewed in the current project. Protected server access requires all three conditions: Better Auth reports two-factor enabled, the stored TOTP enrollment is verified, and the exact current database session has `mfaVerifiedAt`. Password-only and pending-MFA sessions fail this policy. Sign-in routes `twoFactorRedirect` to the verification screen and blocks continuation when the account has MFA enabled but the provider did not issue a challenge. The TOTP and backup-code endpoints write the per-session proof only after Better Auth returns success; if persistence fails, Rudra deletes the session and returns an error. Trusted-device lifetime is zero, trusted-device cookies are stripped before auth handling, and the UI requests verification without trusting the device.

The owner reports that a real password login required Google Authenticator, accepted the current six-digit code, reached Staff Workspace and Owner Dashboard, and a later fresh login required MFA again. The local development server output also showed successful sign-in, TOTP verification, workspace and Owner API requests. This was a user-performed browser workflow; desktop/mobile visual presentation and direct unauthorized API attempts were not independently exercised in this closeout.

As a precaution for an earlier development log exposure, the then-active Owner sessions were revoked before the reported fresh-login verification. Authentication error logging now redacts internal details. A project-file scan found no standalone `.log` or `.txt` files outside generated dependencies/build output; this does not inspect Windows-wide terminal history or external log collectors. The subsequent successful fresh login created a new session, as expected.

| Final closeout check | Result |
| --- | --- |
| Unit suite, including current/wrong/expired synthetic TOTP codes | Passed: 12 test files, 31 tests |
| Lint | Passed, exit 0 |
| TypeScript check | Passed, exit 0 |
| PostgreSQL integration | Passed against the isolated test DB; 3 migrations replayed; synthetic session MFA proof persisted and deletion/revocation confirmed; org/centre constraints and audit update/delete denial passed; all test rows rolled back |
| Development migration replay | Passed: 0 new migrations; 3 total |
| Persistent audit verification | Passed: 1 event verified |
| Production build | Passed; 31 routes generated/compiled |
| Dependency audit | Passed: 0 vulnerabilities reported |
| Lockfile dependency tree | Passed: `npm ls --package-lock-only --depth=0` exit 0 |
| MFA policy and permission unit coverage | Passed: unenrolled, unverified enrollment, missing session proof, valid session proof, trusted-cookie stripping, no-trust-device policy, challenge routing, delegated role restrictions and centre boundaries |
| Real owner password + Google Authenticator fresh-login flow | Passed as owner-reported manual acceptance; app logs corroborated successful auth/TOTP route requests |
| Invalid/expired code against the real owner's enrollment | Not attempted; synthetic OTP tests cover correct, incorrect and expired code behavior without touching owner secrets |
| Session revocation against the owner's live browser session | Not attempted; isolated synthetic database session deletion/revocation passed. The app issues database-backed sessions and sign-out removes the Better Auth session |
| Unauthorized API workflow and desktop/mobile visual review | Pending separate browser acceptance; no access-control or browser permission restriction was bypassed |
| OIDC/Keycloak integration | Not applicable to this selected local Better Auth email/password + TOTP setup; external OIDC remains optional and unverified |

**Decision:** Phase 01 is qualified for continued local development with synthetic data. The automated engineering and database checks passed, and the owner reports successful fresh-login MFA behavior. This is not production security qualification: live negative API/session-revocation browser checks and desktop/mobile visual review remain pending, and no real patient data or production deployment is approved by this result. Keep real patient data out of the system until those operational/security reviews are completed.

### Phase 02 preparation only (not implemented)

Recommended first implementation sequence, reusing the current PostgreSQL schema, authenticated server access, audit trail and centre-scoped permissions:

1. Define patient and family data model, patient identifier generation, duplicate detection and organization/centre access rules.
2. Build patient registration with validated demographics, contact details, addresses, consent capture and auditable edits.
3. Add family links and a Patient 360° profile with a chronological, access-controlled activity timeline.
4. Add CRM leads and appointment records with explicit lifecycle states and centre assignment.
5. Add staff workflows and permissions, then verify CRUD authorization, duplicate handling, cross-centre isolation, audit events and responsive screens using synthetic records.

No Phase 02 code or real patient data has been added as part of this closeout.
