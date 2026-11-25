import {
  SyntheticMonitoringGenerator,
  type MonitoringStep,
} from '../synthetic-monitoring';

describe('SyntheticMonitoringGenerator', () => {
  let generator: SyntheticMonitoringGenerator;

  beforeEach(() => {
    generator = new SyntheticMonitoringGenerator();
  });

  describe('constructor', () => {
    it('initialises with zero steps', () => {
      expect(generator.stepCount()).toBe(0);
    });
  });

  describe('addStep', () => {
    it('increments stepCount for each valid step', () => {
      generator.addStep('navigate', 'https://sorotask.app');
      expect(generator.stepCount()).toBe(1);

      generator.addStep('click', '#login-btn');
      expect(generator.stepCount()).toBe(2);
    });

    it('accepts all supported actions', () => {
      const actions: MonitoringStep['action'][] = [
        'navigate',
        'click',
        'type',
        'waitForSelector',
        'assertText',
      ];
      actions.forEach((action) => {
        const g = new SyntheticMonitoringGenerator();
        expect(() => g.addStep(action, '#target', 'value')).not.toThrow();
      });
    });

    it('throws when action is invalid', () => {
      expect(() =>
        generator.addStep('unknownAction' as MonitoringStep['action'], '#el'),
      ).toThrow(/Unsupported monitoring action/);
    });

    it('throws when target is an empty string', () => {
      expect(() => generator.addStep('click', '')).toThrow(
        /non-empty target/,
      );
    });

    it('attaches value when provided', () => {
      generator.addStep('type', '#email', 'user@sorotask.app');
      const script = generator.generateScript();
      expect(script).toContain('user@sorotask.app');
    });

    it('omits value key when null is passed', () => {
      generator.addStep('click', '#submit', null);
      generator.addStep('navigate', 'https://sorotask.app', null);
      const script = generator.generateScript();
      expect(script).not.toContain('null');
    });
  });

  describe('generateScript', () => {
    it('throws when no steps have been added', () => {
      expect(() => generator.generateScript()).toThrow(/no monitoring steps/);
    });

    it('returns a string containing the async function signature', () => {
      generator.addStep('navigate', 'https://sorotask.app');
      const script = generator.generateScript();
      expect(typeof script).toBe('string');
      expect(script).toContain('async function runSyntheticMonitor');
    });

    it('includes a navigate step using page.goto with waitUntil load', () => {
      generator.addStep('navigate', 'https://sorotask.app');
      const script = generator.generateScript();
      expect(script).toContain('page.goto');
      expect(script).toContain('https://sorotask.app');
      expect(script).toContain("waitUntil: 'load'");
      expect(script).not.toContain('networkidle');
    });

    it('includes a click step using page.click', () => {
      generator.addStep('click', '#btn');
      const script = generator.generateScript();
      expect(script).toContain('page.click');
      expect(script).toContain('#btn');
    });

    it('includes a type step using page.fill', () => {
      generator.addStep('type', '#input', 'hello');
      const script = generator.generateScript();
      expect(script).toContain('page.fill');
      expect(script).toContain('hello');
    });

    it('includes a waitForSelector step', () => {
      generator.addStep('waitForSelector', '.task-card');
      const script = generator.generateScript();
      expect(script).toContain('page.waitForSelector');
      expect(script).toContain('.task-card');
    });

    it('includes an assertText step', () => {
      generator.addStep('assertText', 'h1', 'SoroTask');
      const script = generator.generateScript();
      expect(script).toContain('assertText:');
      expect(script).toContain('SoroTask');
    });

    it('emits all steps when multiple are registered', () => {
      generator.addStep('navigate', 'https://sorotask.app');
      generator.addStep('click', '#login');
      generator.addStep('type', '#email', 'user@example.com');
      generator.addStep('waitForSelector', '.dashboard');
      const script = generator.generateScript();

      expect(script).toContain('page.goto');
      expect(script).toContain('page.click');
      expect(script).toContain('page.fill');
      expect(script).toContain('page.waitForSelector');
    });

    it('wraps execution in a try/catch returning a MonitoringResult', () => {
      generator.addStep('navigate', 'https://sorotask.app');
      const script = generator.generateScript();
      expect(script).toContain('try {');
      expect(script).toContain('catch (error)');
      expect(script).toContain('success: true');
      expect(script).toContain('success: false');
      expect(script).toContain('timestamp: Date.now()');
    });

    it('wraps target values in JSON.stringify to prevent code injection', () => {
      const malicious = 'https://evil.com/"); evil()';
      generator.addStep('navigate', malicious);
      const script = generator.generateScript();
      expect(script).toContain(JSON.stringify(malicious));
      expect(script).toContain('\\"');
    });

    it('generates independently for each generator instance', () => {
      const g1 = new SyntheticMonitoringGenerator();
      const g2 = new SyntheticMonitoringGenerator();

      g1.addStep('navigate', 'https://a.com');
      g2.addStep('navigate', 'https://b.com');

      expect(g1.generateScript()).toContain('https://a.com');
      expect(g2.generateScript()).toContain('https://b.com');
      expect(g1.generateScript()).not.toContain('https://b.com');
    });
  });
});
