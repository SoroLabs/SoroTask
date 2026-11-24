#!/usr/bin/env node
'use strict';

/**
 * Blue/Green canary rollout CLI used by .github/workflows/deploy.yml.
 *
 *   node scripts/blue-green-deploy.js --stable blue --candidate green
 *   node scripts/blue-green-deploy.js --stable blue --candidate green --simulate [--fault-rate 0.02]
 *
 * Live mode environment:
 *   ALB_LISTENER_ARN        listener whose weighted forward action is shifted
 *   BLUE_TARGET_GROUP_ARN   target group for the blue color
 *   GREEN_TARGET_GROUP_ARN  target group for the green color
 *   PROMETHEUS_URL          Prometheus base URL reachable from the runner
 *   AWS_REGION              optional, passed to the AWS CLI
 *   CANARY_STEPS            optional, e.g. "10,50,100"
 *   CANARY_STEP_HOLD_MS     optional, default 60000
 *
 * Exit codes: 0 promoted, 2 rolled back (old color still live), 1 error.
 */

const fs = require('fs');
const { CanaryController } = require('../src/deploy/canaryController');
const {
  AwsAlbWeightedRouter,
  PrometheusTelemetry,
  SimulatedFleet,
  createVirtualClock,
} = require('../src/deploy/providers');

function parseArgs(argv) {
  const args = { simulate: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--simulate') args.simulate = true;
    else if (arg === '--stable') args.stable = argv[++i];
    else if (arg === '--candidate') args.candidate = argv[++i];
    else if (arg === '--fault-rate') args.faultRate = Number(argv[++i]);
    else if (arg === '--fault-at-ms') args.faultAtMs = Number(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function configFromEnv(env) {
  const config = {};
  if (env.CANARY_STEPS) config.steps = env.CANARY_STEPS.split(',').map((s) => Number(s.trim()));
  if (env.CANARY_STEP_HOLD_MS) config.stepHoldMs = Number(env.CANARY_STEP_HOLD_MS);
  if (env.CANARY_ERROR_RATE_THRESHOLD) config.errorRateThreshold = Number(env.CANARY_ERROR_RATE_THRESHOLD);
  return config;
}

function buildLiveDeps(env, stable, candidate) {
  const missing = ['ALB_LISTENER_ARN', 'BLUE_TARGET_GROUP_ARN', 'GREEN_TARGET_GROUP_ARN', 'PROMETHEUS_URL']
    .filter((key) => !env[key]);
  if (missing.length) throw new Error(`missing required environment: ${missing.join(', ')}`);
  const router = new AwsAlbWeightedRouter({
    listenerArn: env.ALB_LISTENER_ARN,
    targetGroupArns: { blue: env.BLUE_TARGET_GROUP_ARN, green: env.GREEN_TARGET_GROUP_ARN },
    region: env.AWS_REGION,
  });
  const telemetry = new PrometheusTelemetry({ baseUrl: env.PROMETHEUS_URL });
  return { router, telemetry, stable, candidate };
}

function buildSimulatedDeps(args, stable, candidate) {
  const clock = createVirtualClock(0);
  const faults = Number.isFinite(args.faultRate)
    ? [{ color: candidate, at: Number.isFinite(args.faultAtMs) ? args.faultAtMs : 70000, errorRate: args.faultRate }]
    : [];
  const fleet = new SimulatedFleet({ clock, rps: 200, errorRates: { [stable]: 0.001, [candidate]: 0.001 }, faults });
  return { router: fleet, telemetry: fleet, clock, stable, candidate };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const stable = args.stable || 'blue';
  const candidate = args.candidate || (stable === 'blue' ? 'green' : 'blue');
  const deps = args.simulate ? buildSimulatedDeps(args, stable, candidate) : buildLiveDeps(env, stable, candidate);

  const logger = {
    info: (msg, data) => console.error(JSON.stringify({ level: 'info', msg, ...data })),
    warn: (msg, data) => console.error(JSON.stringify({ level: 'warn', msg, ...data })),
    error: (msg, data) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
  };

  const controller = new CanaryController({
    router: deps.router,
    telemetry: deps.telemetry,
    clock: deps.clock,
    logger,
    stableColor: stable,
    candidateColor: candidate,
    config: configFromEnv(env),
  });

  const result = await controller.run();
  const summary = {
    outcome: result.outcome,
    liveColor: result.liveColor,
    step: result.step,
    reason: result.reason || null,
    errorRate: result.errorRate ?? null,
    rollbackMs: result.rollbackMs ?? null,
    durationMs: result.durationMs,
    simulated: args.simulate,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT, `outcome=${summary.outcome}\nlive_color=${summary.liveColor}\n`);
  }
  return summary.outcome === 'promoted' ? 0 : 2;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(JSON.stringify({ level: 'error', msg: error.message, code: error.code }));
      process.exit(1);
    },
  );
}

module.exports = { main, parseArgs, configFromEnv };
