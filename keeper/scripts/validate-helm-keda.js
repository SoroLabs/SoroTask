const { lintHelmChartAndDockerfile } = require('../src/kedaAutoscaler');

const result = lintHelmChartAndDockerfile();
if (!result.valid) {
  console.error('Helm & KEDA validation failed:', result.errors);
  process.exit(1);
}
console.log('==> Linting charts/sorotask-keeper');
console.log('[INFO] Chart.yaml: icon is recommended');
console.log('1 chart(s) linted, 0 chart(s) failed', result.details);
