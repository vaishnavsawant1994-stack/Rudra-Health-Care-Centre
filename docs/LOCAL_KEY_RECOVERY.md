# Local encryption-key backup and recovery

This tool backs up only the Rudra data-encryption key material needed to decrypt local records and report documents:

- Report-document active key ID and complete keyring, including historical key IDs.
- Application-field active key ID and complete keyring, including historical key IDs.
- Patient/contact blind-index key.

It does not back up PostgreSQL, report files, Better Auth secrets, scheduler tokens, provider credentials, or the operating system. Keep database and private-file backups coordinated with this key backup; encrypted data without its matching historical keys is not recoverable.

## Create an encrypted local key backup

Use a destination outside the project and keep the passphrase in a separate password manager or secure physical record. The passphrase is entered into a hidden terminal prompt and is never accepted as a command-line argument or environment variable.

```powershell
npm.cmd run keys:backup -- 'E:\RudraBackups\rudra-local-keys-2026-10-31.enc'
```

The file is encrypted with scrypt-derived AES-256-GCM, created with exclusive-create semantics, and never overwrites an existing backup. Copy it to an approved protected backup location after creation. The tool currently operates only when the configured app URL and database are loopback local development/test targets; it refuses production mode.

## Verify or restore

Authenticate a backup and validate its key structure without changing files:

```powershell
npm.cmd run keys:restore -- 'E:\RudraBackups\rudra-local-keys-2026-10-31.enc'
```

To explicitly restore only those five encryption variables into the ignored project `.env.local`, add `--write-env` and type the confirmation phrase shown by the tool:

```powershell
npm.cmd run keys:restore -- 'E:\RudraBackups\rudra-local-keys-2026-10-31.enc' --write-env
```

The passphrase is hidden. Wrong passphrases, tampering, unsupported formats, invalid keyrings, non-loopback environments, and other restore targets fail closed. The restore preserves database URLs and all unrelated `.env.local` settings. Restart Rudra services after a successful restore.

## Qualification status and limits

Synthetic tests cover authenticated encryption/decryption, wrong-passphrase and tamper rejection, historical key preservation, key configuration validation, and an isolated `.env.local` merge fixture. No existing local encryption keys were exported, restored, or rotated during qualification. A populated encrypted PostgreSQL plus report-file backup/restore drill, independent off-device backup verification, Windows ACL review, disaster-recovery timing, and production secret-management qualification remain pending. Continue synthetic-data-only use.

## Operational application-field key rotation

The synthetic qualification command `npm.cmd run db:qualify-operational-backfill` now also tests a populated appointment/sample key rotation in an isolated PostgreSQL schema, including a committed interruption, resume, repeat-run idempotency, decrypted-value parity, and ciphertext-only updates to immutable appointment/custody history. Migration `0088_operational_key_rotation_guard.sql` permits those ciphertext-only history changes only when the migration/test connection sets the transaction-local rotation flag; the application database role has no update grant to use this path.

To rotate the operational payloads in the configured local development database, first provision a fresh random 32-byte key under a new key ID in the protected local key configuration, make that ID active, and retain every existing key ID. Create and verify coordinated database and encryption-key backups before starting the rewrite. Then run `npm.cmd run db:rotate-operational-key` in a terminal and type the exact confirmation phrase displayed by the command. It is restricted to the loopback `rudra_health_dev` database and verifies migration 0089 is applied before prompting. All old key IDs must remain configured until every dependent deployment and backup is verified. This command does not rotate the separate report-document key, patient/family/lead field key domains, the blind-index key, or other operational tables added after the appointment/sample batch. Those rotations and a coordinated populated PostgreSQL plus report-file restore drill remain outstanding; do not remove historical keys.

## Additional synthetic compatibility qualification

A disposable PostgreSQL integration test now stores an encrypted synthetic website-content row alongside a private encrypted synthetic PDF, removes key configuration to verify fail-closed behavior, then restores the key material from the encrypted backup and verifies both artifacts. This demonstrates format/key compatibility across the PostgreSQL and report storage readers; it does not create or restore an actual database/filesystem backup.
