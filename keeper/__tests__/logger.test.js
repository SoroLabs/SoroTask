/**
 * Unit tests for logger.js - Structured logging with pino
 */

const {
  createLogger,
  createChildLogger,
  reinitializeLogger,
  normalizeLogLevel,
  SENSITIVE_FIELDS,
} = require('../src/logger.js');

describe('Logger', () => {
  // Store original env vars
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to get fresh logger instances
    jest.resetModules();
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('createLogger', () => {
    it('should create a logger with all log level methods', () => {
      const logger = createLogger('test');

      expect(typeof logger.trace).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.fatal).toBe('function');
    });

    it('should create a logger with raw pino instance', () => {
      const logger = createLogger('test');
      expect(logger.raw).toBeDefined();
    });

    it('should include module name in child logger', () => {
      const logger = createLogger('poller');
      expect(logger.raw.bindings()).toHaveProperty('module', 'poller');
    });
  });

  describe('createChildLogger', () => {
    it('should be an alias for createLogger', () => {
      const logger1 = createLogger('test');
      const logger2 = createChildLogger('test');

      expect(typeof logger1.info).toBe('function');
      expect(typeof logger2.info).toBe('function');
    });
  });

  describe('log levels', () => {
    it('should default to info level', () => {
      const logger = createLogger('test');
      // In pino, level 30 is 'info'
      expect(logger.raw.level).toBe('info');
    });

    it('should respect LOG_LEVEL environment variable', () => {
      process.env.LOG_LEVEL = 'debug';
      jest.resetModules();
      const { createLogger: freshCreateLogger } = require('../src/logger.js');
      const logger = freshCreateLogger('test');

      expect(logger.raw.level).toBe('debug');
    });

    it('should respect LOG_LEVEL=error', () => {
      process.env.LOG_LEVEL = 'error';
      jest.resetModules();
      const { createLogger: freshCreateLogger } = require('../src/logger.js');
      const logger = freshCreateLogger('test');

      expect(logger.raw.level).toBe('error');
    });

    it('should fall back to info for invalid LOG_LEVEL values', () => {
      expect(normalizeLogLevel('verbose')).toBe('info');
      expect(normalizeLogLevel('debug')).toBe('debug');
    });
  });

  describe('getLogLevel and setLogLevel', () => {
    it('should get current log level', () => {
      process.env.LOG_LEVEL = 'warn';
      jest.resetModules();
      const { getLogLevel: freshGetLogLevel } = require('../src/logger.js');

      expect(freshGetLogLevel()).toBe('warn');
    });

    it('should set log level dynamically', () => {
      const { setLogLevel: freshSetLogLevel, getLogLevel: freshGetLogLevel } = require('../src/logger.js');

      freshSetLogLevel('debug');
      expect(freshGetLogLevel()).toBe('debug');
    });
  });

  describe('reinitializeLogger', () => {
    it('should allow reinitializing with new options', () => {
      const { reinitializeLogger: freshReinit, getLogLevel: freshGetLevel } = require('../src/logger.js');

      freshReinit({ level: 'trace' });
      expect(freshGetLevel()).toBe('trace');
    });
  });

  describe('sensitive field redaction', () => {
    it('should have defined sensitive fields list', () => {
      expect(SENSITIVE_FIELDS).toBeDefined();
      expect(Array.isArray(SENSITIVE_FIELDS)).toBe(true);
      expect(SENSITIVE_FIELDS).toContain('secret');
      expect(SENSITIVE_FIELDS).toContain('privateKey');
      expect(SENSITIVE_FIELDS).toContain('password');
      expect(SENSITIVE_FIELDS).toContain('KEEPER_SECRET');
    });

    it('should include keypair-related fields', () => {
      expect(SENSITIVE_FIELDS).toContain('keypair');
      expect(SENSITIVE_FIELDS).toContain('secretKey');
    });
  });

  describe('log format selection', () => {
    it('should default to JSON even in development mode', () => {
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      const { createLogger: freshCreateLogger, getBaseLogger: freshGetBase } = require('../src/logger.js');

      freshCreateLogger('test');
      const baseLogger = freshGetBase();

      expect(baseLogger.logFormat).toBe('json');
    });

    it('should configure pretty transport only when LOG_FORMAT=pretty', () => {
      process.env.LOG_FORMAT = 'pretty';
      jest.resetModules();
      const { createLogger: freshCreateLogger, getBaseLogger: freshGetBase } = require('../src/logger.js');

      freshCreateLogger('test');
      const baseLogger = freshGetBase();

      expect(baseLogger.logFormat).toBe('pretty');
    });
  });

  describe('JSON output', () => {
    it('should emit JSON logs with normalized fields and metadata', () => {
      const chunks = [];
      const destination = {
        write(chunk) {
          chunks.push(chunk.toString());
        },
      };

      reinitializeLogger({ destination });
      const logger = createLogger('poller');
      logger.info('Task is due', { taskId: 42, dueInSeconds: 0 });

      const payload = JSON.parse(chunks[0]);
      expect(payload).toMatchObject({
        level: 'info',
        message: 'Task is due',
        module: 'poller',
        service: 'keeper',
        taskId: 42,
        dueInSeconds: 0,
      });
      expect(payload.timestamp).toBeDefined();
      expect(typeof payload.timestamp).toBe('string');
    });
  });

  describe('logger output methods', () => {
    let logger;
    let baseLoggerSpy;

    beforeEach(() => {
      jest.resetModules();
      const loggerModule = require('../src/logger.js');
      logger = loggerModule.createLogger('test');

      // Spy on the raw logger methods
      baseLoggerSpy = {
        trace: jest.spyOn(logger.raw, 'trace').mockImplementation(() => {}),
        debug: jest.spyOn(logger.raw, 'debug').mockImplementation(() => {}),
        info: jest.spyOn(logger.raw, 'info').mockImplementation(() => {}),
        warn: jest.spyOn(logger.raw, 'warn').mockImplementation(() => {}),
        error: jest.spyOn(logger.raw, 'error').mockImplementation(() => {}),
        fatal: jest.spyOn(logger.raw, 'fatal').mockImplementation(() => {}),
      };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should call trace on raw logger', () => {
      logger.trace('test message', { meta: 'data' });
      expect(baseLoggerSpy.trace).toHaveBeenCalledWith({ meta: 'data' }, 'test message');
    });

    it('should call debug on raw logger', () => {
      logger.debug('debug message', { key: 'value' });
      expect(baseLoggerSpy.debug).toHaveBeenCalledWith({ key: 'value' }, 'debug message');
    });

    it('should call info on raw logger', () => {
      logger.info('info message', { count: 5 });
      expect(baseLoggerSpy.info).toHaveBeenCalledWith({ count: 5 }, 'info message');
    });

    it('should call warn on raw logger', () => {
      logger.warn('warning message', { warning: true });
      expect(baseLoggerSpy.warn).toHaveBeenCalledWith({ warning: true }, 'warning message');
    });

    it('should call error on raw logger', () => {
      logger.error('error message', { error: 'details' });
      expect(baseLoggerSpy.error).toHaveBeenCalledWith({ error: 'details' }, 'error message');
    });

    it('should call fatal on raw logger', () => {
      logger.fatal('fatal message', { critical: true });
      expect(baseLoggerSpy.fatal).toHaveBeenCalledWith({ critical: true }, 'fatal message');
    });

    it('should work with empty metadata', () => {
      logger.info('simple message');
      expect(baseLoggerSpy.info).toHaveBeenCalledWith({}, 'simple message');
    });
  });

  describe('base logger singleton', () => {
    it('should return same base logger instance', () => {
      jest.resetModules();
      const { getBaseLogger: freshGetBase } = require('../src/logger.js');

      const base1 = freshGetBase();
      const base2 = freshGetBase();

      expect(base1).toBe(base2);
    });
  });

  describe('child logger bindings', () => {
    it('should have module binding in child logger', () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = require('../src/logger.js');

      const logger = freshCreateLogger('poller');
      const bindings = logger.raw.bindings();

      expect(bindings.module).toBe('poller');
    });

    it('should have different modules for different child loggers', () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = require('../src/logger.js');

      const pollerLogger = freshCreateLogger('poller');
      const registryLogger = freshCreateLogger('registry');

      expect(pollerLogger.raw.bindings().module).toBe('poller');
      expect(registryLogger.raw.bindings().module).toBe('registry');
    });
  });

  describe('traced child loggers', () => {
    let tracedLogger;
    let tracedSpy;

    beforeEach(() => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = require('../src/logger.js');
      tracedLogger = freshCreateLogger('poller').childWithTrace('cycle-123');
      tracedSpy = {
        trace: jest.spyOn(tracedLogger.raw, 'trace').mockImplementation(() => {}),
        debug: jest.spyOn(tracedLogger.raw, 'debug').mockImplementation(() => {}),
        info: jest.spyOn(tracedLogger.raw, 'info').mockImplementation(() => {}),
        warn: jest.spyOn(tracedLogger.raw, 'warn').mockImplementation(() => {}),
        error: jest.spyOn(tracedLogger.raw, 'error').mockImplementation(() => {}),
        fatal: jest.spyOn(tracedLogger.raw, 'fatal').mockImplementation(() => {}),
      };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should proxy all log methods to the traced raw logger', () => {
      tracedLogger.trace('trace message', { trace: true });
      tracedLogger.debug('debug message', { debug: true });
      tracedLogger.info('info message', { info: true });
      tracedLogger.warn('warn message', { warn: true });
      tracedLogger.error('error message', { error: true });
      tracedLogger.fatal('fatal message', { fatal: true });

      expect(tracedSpy.trace).toHaveBeenCalledWith({ trace: true }, 'trace message');
      expect(tracedSpy.debug).toHaveBeenCalledWith({ debug: true }, 'debug message');
      expect(tracedSpy.info).toHaveBeenCalledWith({ info: true }, 'info message');
      expect(tracedSpy.warn).toHaveBeenCalledWith({ warn: true }, 'warn message');
      expect(tracedSpy.error).toHaveBeenCalledWith({ error: true }, 'error message');
      expect(tracedSpy.fatal).toHaveBeenCalledWith({ fatal: true }, 'fatal message');
    });

    it('should create nested traced loggers', () => {
      const nested = tracedLogger.childWithTrace('task-456');
      expect(nested.raw.bindings()).toMatchObject({
        module: 'poller',
        correlationId: 'task-456',
      });
    });
  });
});
