-- Down migration: 001_initial_schema
--
-- Reverses 001_initial_schema.sql. Tables are dropped in reverse dependency
-- order so foreign keys never block a drop; CASCADE is deliberately avoided,
-- because a DROP that only succeeds by silently destroying something the
-- migration did not create is exactly the failure this rollback system exists
-- to prevent.
--
-- IF EXISTS throughout: a rollback may run after a partially-applied up
-- migration, where only some objects were created.

DROP INDEX IF EXISTS idx_users_address;

DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS users;
