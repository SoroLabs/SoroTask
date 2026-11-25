const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite3 = require('sqlite3').verbose();
const { HighAvailabilityManager, ROLES } = require('../src/ha');

function createInMemoryDb() {
  return new sqlite3.Database(':memory:');
}

test('High Availability - node registration and initial heartbeat', async () => {
  const db = createInMemoryDb();
  const ha = new HighAvailabilityManager(db, { nodeId: 'primary-node-1', role: ROLES.PRIMARY });

  await ha.initialize();
  await ha.sendHeartbeat();

  const nodes = await ha.getClusterNodes();
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].node_id, 'primary-node-1');
  assert.equal(nodes[0].role, ROLES.PRIMARY);
  assert.equal(ha.isLeader, true);

  ha.stop();
  db.close();
});

test('High Availability - standby promotes to primary when heartbeat times out', async () => {
  const db = createInMemoryDb();

  const primary = new HighAvailabilityManager(db, {
    nodeId: 'primary-node-1',
    role: ROLES.PRIMARY,
    heartbeatTimeoutMs: 50,
  });
  const standby = new HighAvailabilityManager(db, {
    nodeId: 'standby-node-2',
    role: ROLES.STANDBY,
    heartbeatTimeoutMs: 50,
  });

  await primary.initialize();
  await standby.initialize();

  // Send initial primary heartbeat at old timestamp (100ms ago)
  await primary.runSql(
    `UPDATE cluster_nodes SET last_heartbeat = ? WHERE node_id = ?`,
    [Date.now() - 200, 'primary-node-1']
  );

  let promoted = false;
  standby.on('roleChange', (event) => {
    if (event.newRole === ROLES.PRIMARY) {
      promoted = true;
    }
  });

  await standby.checkFailover();

  assert.equal(standby.role, ROLES.PRIMARY);
  assert.equal(standby.isLeader, true);
  assert.equal(promoted, true);

  primary.stop();
  standby.stop();
  db.close();
});

test('High Availability - standby remains standby when primary heartbeat is healthy', async () => {
  const db = createInMemoryDb();

  const primary = new HighAvailabilityManager(db, {
    nodeId: 'primary-node-1',
    role: ROLES.PRIMARY,
    heartbeatTimeoutMs: 10000,
  });
  const standby = new HighAvailabilityManager(db, {
    nodeId: 'standby-node-2',
    role: ROLES.STANDBY,
    heartbeatTimeoutMs: 10000,
  });

  await primary.initialize();
  await standby.initialize();
  await primary.sendHeartbeat();

  await standby.checkFailover();

  assert.equal(standby.role, ROLES.STANDBY);
  assert.equal(standby.isLeader, false);

  primary.stop();
  standby.stop();
  db.close();
});
