'use strict';

/**
 * Knex configuration for SoroTask indexer PostgreSQL & TimescaleDB database.
 * Supports connection pooling and migration management.
 */

const path = require('path');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  'postgresql://postgres:postgres@localhost:5432/sorotask_indexer';

module.exports = {
  development: {
    client: 'pg',
    connection: DATABASE_URL,
    pool: {
      min: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
      max: parseInt(process.env.DATABASE_WRITE_POOL_MAX || '20', 10),
      idleTimeoutMillis: parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS || '30000', 10),
      acquireTimeoutMillis: parseInt(process.env.DATABASE_CONN_TIMEOUT_MS || '10000', 10),
    },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations',
    },
  },

  test: {
    client: 'pg',
    connection: process.env.TEST_DATABASE_URL || DATABASE_URL,
    pool: {
      min: 1,
      max: 10,
      idleTimeoutMillis: 10000,
    },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations',
    },
  },

  production: {
    client: 'pg',
    connection: DATABASE_URL,
    pool: {
      min: parseInt(process.env.DATABASE_POOL_MIN || '5', 10),
      max: parseInt(process.env.DATABASE_WRITE_POOL_MAX || '50', 10),
      idleTimeoutMillis: parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS || '30000', 10),
      acquireTimeoutMillis: parseInt(process.env.DATABASE_CONN_TIMEOUT_MS || '10000', 10),
    },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations',
    },
  },
};
