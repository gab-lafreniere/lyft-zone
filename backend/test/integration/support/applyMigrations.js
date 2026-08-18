'use strict';

// Applies every prisma/migrations/*/migration.sql file, in order, directly
// via `pg` (already a direct backend dependency) against the given
// connection string. Deliberately does not shell out to the Prisma CLI: this
// keeps the harness to one dependency-free code path and avoids any
// ambiguity about which DATABASE_URL a `prisma migrate` subprocess would
// pick up (the CLI has its own dotenv loading).

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', '..', 'prisma', 'migrations');

async function applyMigrations(connectionString, options = {}) {
  const migrationDirs = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .filter((dir) => !options.before || dir < options.before);

  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const dir of migrationDirs) {
      const sqlPath = path.join(MIGRATIONS_DIR, dir, 'migration.sql');
      if (!fs.existsSync(sqlPath)) {
        continue;
      }
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

module.exports = { applyMigrations };
