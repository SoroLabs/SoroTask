/**
 * Synthetic Monitoring Script Generator System
 *
 * Generates Playwright-compatible async monitoring scripts from a declarative
 * step list. Designed for seamless integration with the SoroTask Next.js
 * frontend infrastructure.
 *
 * Time Complexity: O(N) where N is the number of monitoring steps
 * Space Complexity: O(N) to hold the steps array and assembled script string
 */

export type MonitoringAction =
  | 'navigate'
  | 'click'
  | 'type'
  | 'waitForSelector'
  | 'assertText';

export interface MonitoringStep {
  action: MonitoringAction;
  target: string;
  value?: string;
}

export interface MonitoringResult {
  success: boolean;
  timestamp: number;
  error?: string;
}

const SUPPORTED_ACTIONS: ReadonlySet<MonitoringAction> = new Set([
  'navigate',
  'click',
  'type',
  'waitForSelector',
  'assertText',
]);

function renderStep(step: MonitoringStep): string {
  switch (step.action) {
    case 'navigate':
      return `await page.goto(${JSON.stringify(step.target)}, { waitUntil: 'load' });`;

    case 'click':
      return `await page.click(${JSON.stringify(step.target)});`;

    case 'type':
      return `await page.fill(${JSON.stringify(step.target)}, ${JSON.stringify(step.value ?? '')});`;

    case 'waitForSelector':
      return `await page.waitForSelector(${JSON.stringify(step.target)}, { timeout: 5000 });`;

    case 'assertText': {
      const escaped = JSON.stringify(step.value ?? '');
      return [
        `const el = await page.$(${JSON.stringify(step.target)});`,
        `  if (!el) throw new Error('assertText: element not found for selector ' + ${JSON.stringify(step.target)});`,
        `  const text = await el.textContent();`,
        `  if (!text || !text.includes(${escaped})) {`,
        `    throw new Error('assertText: expected ' + ${escaped} + ' in element text');`,
        `  }`,
      ].join('\n  ');
    }

    default: {
      const exhaustive: never = step.action;
      throw new Error(`Unsupported monitoring action: ${exhaustive}`);
    }
  }
}

export class SyntheticMonitoringGenerator {
  private readonly steps: MonitoringStep[];

  constructor() {
    this.steps = [];
  }

  /**
   * Append a monitoring step to the generator.
   * O(1) amortised.
   */
  addStep(
    action: MonitoringAction,
    target: string,
    value: string | null = null,
  ): void {
    if (!SUPPORTED_ACTIONS.has(action)) {
      throw new Error(`Unsupported monitoring action: ${action}`);
    }
    if (!target || typeof target !== 'string') {
      throw new Error('A non-empty target is required for every monitoring step');
    }

    const step: MonitoringStep = { action, target };
    if (value !== null) {
      step.value = value;
    }
    this.steps.push(step);
  }

  /**
   * Return the number of steps currently registered.
   * O(1).
   */
  stepCount(): number {
    return this.steps.length;
  }

  /**
   * Produce a self-contained, Playwright-compatible async function string.
   * O(N) where N = number of steps.
   */
  generateScript(): string {
    if (this.steps.length === 0) {
      throw new Error('Cannot generate a script with no monitoring steps');
    }

    const body = this.steps.map(renderStep).join('\n  ');

    return `import type { Page } from '@playwright/test';

export async function runSyntheticMonitor(page: Page): Promise<${JSON.stringify({} as MonitoringResult).replace('{}', '{ success: boolean; timestamp: number; error?: string }')}> {
  try {
    ${body}
    return { success: true, timestamp: Date.now() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[SyntheticMonitor] step failed:', message);
    return { success: false, timestamp: Date.now(), error: message };
  }
}`;
  }
}
