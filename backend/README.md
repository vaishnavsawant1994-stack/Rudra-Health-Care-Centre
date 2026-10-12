# Rudra Health OS R1 backend — foundation slice

This folder starts the PostgreSQL migration sequence using the latest Rudra R1 data contract. Migrations 001–004 establish organization/centres, staff identity mappings and roles, patient/family records, leads, consent history and immutable audit history.

## Important status

- No migration has been applied: no Rudra PostgreSQL instance or credentials were supplied.
- No live authentication, API server, Metropolis connectivity, or patient data exists in this starter.
- `users.auth_subject` is an identity-provider subject. Passwords must not be stored in this database; select and configure an identity provider before enabling sign-in.
- Sensitive contact and external IDs use ciphertext + keyed lookup-hash columns. Encryption and key rotation must be implemented by the service layer using a managed key store before production use.
- Run with a PostgreSQL 15+ migration runner after a repository, runtime, and environment are selected. Use synthetic seed data only.

## Migrations

Apply files in lexical order inside a transaction-capable migration runner. Before production, add the remaining catalogue, appointment/order, collection/sample, report, payment/invoice, communications, task, file, integration, and analytics migrations from the approved R1 contract. Each migration should be reviewed against actual franchise, privacy, accounting, and retention requirements.
