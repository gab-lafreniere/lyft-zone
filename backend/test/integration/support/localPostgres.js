'use strict';

// A throwaway, local-only Postgres cluster for integration tests that need
// genuine database-level behavior (real transactions, real row locking) that
// a mocked `tx` object cannot demonstrate. It is never the shared/live Neon
// database referenced by backend/.env -- this module never reads that file
// and never touches process.env.DATABASE_URL except to report the URL of the
// ephemeral cluster it creates.
//
// Each call to startLocalPostgres() creates a brand-new data directory under
// the OS temp dir, initializes a fresh cluster in it, and starts postgres
// listening only on 127.0.0.1 on an OS-assigned free port. stop() shuts the
// cluster down and deletes the data directory -- nothing persists between
// runs and nothing is reachable outside this machine.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

// macOS Homebrew builds of Postgres 18 fail to start under the default
// locale ("postmaster became multithreaded during startup") unless LC_ALL is
// pinned to a plain locale before initdb/pg_ctl run. Harmless on Linux.
const PG_ENV = { ...process.env, LC_ALL: 'C' };

function commandExists(cmd) {
  const result = spawnSync('which', [cmd]);
  return result.status === 0;
}

function isPostgresToolingAvailable() {
  return ['initdb', 'pg_ctl', 'postgres'].every(commandExists);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startLocalPostgres() {
  if (!isPostgresToolingAvailable()) {
    return null;
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyftzone-pgtest-'));
  const port = await getFreePort();
  const superuser = 'lyftzone_test_su';

  const initResult = spawnSync(
    'initdb',
    ['-D', dataDir, '-U', superuser, '-A', 'trust', '--no-locale', '--encoding=UTF8'],
    { encoding: 'utf8', env: PG_ENV }
  );

  if (initResult.status !== 0) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    throw new Error(`initdb failed:\n${initResult.stderr || initResult.stdout}`);
  }

  const logFile = path.join(dataDir, 'server.log');
  const startResult = spawnSync(
    'pg_ctl',
    ['start', '-D', dataDir, '-w', '-o', `-p ${port} -h 127.0.0.1 -k ${dataDir}`, '-l', logFile],
    { encoding: 'utf8', env: PG_ENV }
  );

  if (startResult.status !== 0) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    fs.rmSync(dataDir, { recursive: true, force: true });
    throw new Error(
      `pg_ctl start failed:\n${startResult.stderr || startResult.stdout}\n${log}`
    );
  }

  const url = `postgresql://${superuser}@127.0.0.1:${port}/postgres?sslmode=disable`;

  return {
    url,
    dataDir,
    port,
    stop() {
      spawnSync('pg_ctl', ['stop', '-D', dataDir, '-m', 'fast', '-w'], { env: PG_ENV });
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

module.exports = { startLocalPostgres, isPostgresToolingAvailable };
