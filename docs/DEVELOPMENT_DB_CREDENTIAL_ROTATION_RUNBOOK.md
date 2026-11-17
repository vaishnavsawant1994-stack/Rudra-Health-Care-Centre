# Development Database Credential Rotation — Local Runbook

Status: **not performed**. This checklist records a safe procedure after a development database credential appeared in local terminal output. It contains no credential values.

## Preconditions

- Schedule a local development-only maintenance window; verify the target is `rudra_health_dev`, never production.
- Identify the affected database role and every local consumer using an approved secret manager or direct local configuration view. Do not paste credential values into terminals, chat, tickets, shell history, screenshots or reports.
- Confirm a current recovery checkpoint and ensure the owner can restore the development database before changing authentication.
- Stop Rudra dev servers, test workers and background jobs that may hold the old connection.

## Rotation steps

1. Generate a unique strong password using an approved local password manager.
2. Change only the development role password using an interactive secure database administration client that suppresses command echo/history. Do not put a literal password in a command argument or SQL file.
3. Update the corresponding local secret store / ignored environment file directly through a protected editor; do not display, copy, or commit it.
4. Start one local connection check, then run a read-only application health check. Verify the app uses the new credential and the old credential fails, without printing either value.
5. Restart local services and rerun safe test checks. If access fails, use the documented local administrator recovery procedure; never restore the old exposed password.
6. Review terminal transcripts and shell history for the prior disclosure; remove retained copies only where permitted by local policy. Record that sanitization was attempted without copying the exposed value.
7. Confirm Git status contains no `.env`, credential, private key, connection string, or debug log file.

## Boundaries

- Do not rotate encryption keys as part of database-password rotation; key rotation requires its own recovery-qualified plan.
- Do not alter production credentials, migrate schemas, or write patient/business data in this process.
- Preserve audit accountability; do not rewrite Git history or erase controlled audit records.
- Record the date, operator, role identifier (not its secret), validation evidence, and any unresolved exposure through the approved internal security channel.
