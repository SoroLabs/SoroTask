const fs = require('fs');
const path = require('path');

console.log('--- Validating SoroTask Monitoring & Alerting Configuration ---');

const alertsPath = path.join(__dirname, '../prometheus/alerts.yml');
const alertmanagerPath = path.join(__dirname, '../alertmanager/alertmanager.yml');
const prometheusPath = path.join(__dirname, '../prometheus/prometheus.yml');

// 1. Verify alerts.yml
if (!fs.existsSync(alertsPath)) {
  console.error('FAIL: alerts.yml does not exist');
  process.exit(1);
}

const alertsContent = fs.readFileSync(alertsPath, 'utf8');

const expectedAlerts = [
  'IndexerHighLedgerLag',
  'KeeperBalanceLow',
  'KeeperHighFailureRate',
  'ZKProverQueueHighLatency'
];

for (const expected of expectedAlerts) {
  if (!alertsContent.includes(`alert: ${expected}`)) {
    console.error(`FAIL: Missing required alert rule "${expected}" in alerts.yml`);
    process.exit(1);
  }
  console.log(`✓ Verified alert rule: ${expected}`);
}

// 2. Verify alertmanager.yml
if (!fs.existsSync(alertmanagerPath)) {
  console.error('FAIL: alertmanager.yml does not exist');
  process.exit(1);
}

const alertmanagerContent = fs.readFileSync(alertmanagerPath, 'utf8');

if (!alertmanagerContent.includes('pagerduty-oncall')) {
  console.error('FAIL: Missing PagerDuty receiver in alertmanager.yml');
  process.exit(1);
}
if (!alertmanagerContent.includes('telegram-default')) {
  console.error('FAIL: Missing Telegram receiver in alertmanager.yml');
  process.exit(1);
}
console.log('✓ Verified Alertmanager receivers (PagerDuty & Telegram)');

// 3. Verify prometheus.yml
if (!fs.existsSync(prometheusPath)) {
  console.error('FAIL: prometheus.yml does not exist');
  process.exit(1);
}
const prometheusContent = fs.readFileSync(prometheusPath, 'utf8');
if (!prometheusContent.includes('alerts.yml')) {
  console.error('FAIL: prometheus.yml does not link alerts.yml');
  process.exit(1);
}
console.log('✓ Verified prometheus.yml links alerts.yml');

console.log('SUCCESS: All monitoring and alerting rules validated successfully!');
process.exit(0);
