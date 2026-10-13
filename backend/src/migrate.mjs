import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const client = await pool.connect();
  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['rudra-health-os-schema-migrations']);
  const files = (await readdir(directory)).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
  try {
    for (const file of files) {
      const sql = await readFile(join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prior = await client.query('SELECT checksum FROM schema_migrations WHERE version=$1', [file]);
      if (prior.rowCount) {
        if (prior.rows[0].checksum !== checksum) throw new Error(`Applied migration ${file} has changed; add a new migration instead.`);
        console.log(`already applied ${file}`);
        continue;
      }
      const body = sql.replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
      if (body === sql) throw new Error(`${file} must start with BEGIN and end with COMMIT`);
      await client.query('BEGIN');
      await client.query(body);
      await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1,$2)', [file, checksum]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['rudra-health-os-schema-migrations']).catch(() => {});
    client.release();
  }
} finally {
  await pool.end();
}
