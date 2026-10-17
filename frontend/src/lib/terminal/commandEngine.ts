import type {
  RegisterTaskInput,
  Task,
  TaskStatus,
  UpdateTaskInput,
} from "@/src/lib/mockApi/tasks";

export type TerminalApi = {
  listTasks: () => Promise<Task[]>;
  createTask: (input: RegisterTaskInput) => Promise<Task>;
  updateTask: (input: UpdateTaskInput) => Promise<Task>;
  deleteTask: (id: string) => Promise<unknown>;
  simulate: (contract: string, fn: string) => Promise<string>;
};

export type TerminalResult = {
  output: string[];
  clear?: boolean;
};

const ROOT_COMMANDS = ["sorotask", "help", "clear"];
const SOROTASK_COMMANDS = [
  "help",
  "list",
  "create",
  "update",
  "delete",
  "simulate",
];

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let tokenStarted = false;
  for (const character of command) {
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
    } else {
      token += character;
      tokenStarted = true;
    }
  }
  if (quote) throw new Error("Unclosed quote in command.");
  if (tokenStarted) tokens.push(token);
  return tokens;
}

function splitPipeline(command: string): string[] {
  const segments: string[] = [];
  let quote: "'" | '"' | null = null;
  let segmentStart = 0;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "|") {
      segments.push(command.slice(segmentStart, index).trim());
      segmentStart = index + 1;
    }
  }
  if (quote) throw new Error("Unclosed quote in command.");
  segments.push(command.slice(segmentStart).trim());
  if (segments.some((segment) => !segment)) {
    throw new Error("Each side of a pipe must be a command.");
  }
  return segments;
}

function parseOptions(tokens: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}"`);
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Option ${token} needs a value`);
    }
    if (options.has(token.slice(2))) {
      throw new Error(`Option ${token} was provided more than once`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  return options;
}

function required(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) throw new Error(`Missing required option --${key}`);
  return value;
}

function positiveNumber(options: Map<string, string>, key: string): number {
  const value = Number(required(options, key));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${key} must be a positive number`);
  }
  return value;
}

function formatTask(task: Task): string {
  return JSON.stringify(task);
}

function parseStatus(value: string): TaskStatus {
  if (
    value === "pending" ||
    value === "running" ||
    value === "success" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error(`Unknown task status "${value}"`);
}

async function executeBaseCommand(
  tokens: string[],
  api: TerminalApi,
): Promise<TerminalResult> {
  const [root, subcommand, ...args] = tokens;
  if (root === "help" || (root === "sorotask" && subcommand === "help")) {
    return {
      output: [
        "sorotask list [--status pending|running|success|failed]",
        "sorotask create --contract ADDRESS --fn NAME --interval SECONDS --gas UNITS",
        "sorotask update --id ID [--interval SECONDS] [--gas UNITS]",
        "sorotask delete --id ID",
        "sorotask simulate --contract ADDRESS --fn NAME",
        "Pipes: sorotask list | grep TEXT | json",
      ],
    };
  }
  if (root === "clear") return { output: [], clear: true };
  if (root !== "sorotask") {
    throw new Error(`Unknown command "${root}". Type "help" for commands.`);
  }

  switch (subcommand) {
    case "list": {
      const options = parseOptions(args);
      for (const key of options.keys()) {
        if (key !== "status") throw new Error(`Unknown option --${key}`);
      }
      const tasks = await api.listTasks();
      const status = options.get("status");
      const filtered = status
        ? tasks.filter((task) => task.status === parseStatus(status))
        : tasks;
      return {
        output: filtered.length
          ? filtered.map(formatTask)
          : ["No tasks found."],
      };
    }
    case "create": {
      const options = parseOptions(args);
      for (const key of options.keys()) {
        if (!["contract", "fn", "interval", "gas"].includes(key)) {
          throw new Error(`Unknown option --${key}`);
        }
      }
      const task = await api.createTask({
        contract: required(options, "contract"),
        fn: required(options, "fn"),
        intervalSec: positiveNumber(options, "interval"),
        gas: positiveNumber(options, "gas"),
      });
      return { output: [`Created task ${task.id}.`, formatTask(task)] };
    }
    case "update": {
      const options = parseOptions(args);
      for (const key of options.keys()) {
        if (!["id", "interval", "gas"].includes(key)) {
          throw new Error(`Unknown option --${key}`);
        }
      }
      const input: { id: string; intervalSec?: number; gas?: number } = {
        id: required(options, "id"),
      };
      if (options.has("interval")) {
        input.intervalSec = positiveNumber(options, "interval");
      }
      if (options.has("gas")) input.gas = positiveNumber(options, "gas");
      if (input.intervalSec === undefined && input.gas === undefined) {
        throw new Error("Provide --interval and/or --gas");
      }
      const task = await api.updateTask(input);
      return { output: [`Updated task ${task.id}.`, formatTask(task)] };
    }
    case "delete": {
      const options = parseOptions(args);
      for (const key of options.keys()) {
        if (key !== "id") throw new Error(`Unknown option --${key}`);
      }
      const id = required(options, "id");
      await api.deleteTask(id);
      return { output: [`Deleted task ${id}.`] };
    }
    case "simulate": {
      const options = parseOptions(args);
      for (const key of options.keys()) {
        if (!["contract", "fn"].includes(key)) {
          throw new Error(`Unknown option --${key}`);
        }
      }
      const output = await api.simulate(
        required(options, "contract"),
        required(options, "fn"),
      );
      return { output: [output] };
    }
    default:
      throw new Error(
        subcommand
          ? `Unknown sorotask command "${subcommand}". Type "sorotask help".`
          : "Type \"sorotask help\" to see available commands.",
      );
  }
}

export async function executeTerminalCommand(
  command: string,
  api: TerminalApi,
): Promise<TerminalResult> {
  if (!command.trim()) return { output: [] };
  const segments = splitPipeline(command);
  if (!segments.length) return { output: [] };

  let result = await executeBaseCommand(tokenize(segments[0]), api);
  for (const segment of segments.slice(1)) {
    const [operator, ...args] = tokenize(segment);
    if (operator === "grep") {
      if (args.length !== 1) throw new Error("Usage: | grep TEXT");
      const query = args[0].toLowerCase();
      result = {
        output: result.output.filter((line) =>
          line.toLowerCase().includes(query),
        ),
      };
    } else if (operator === "json") {
      if (args.length) throw new Error("Usage: | json");
      result = {
        output: [JSON.stringify(result.output.map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return line;
          }
        }), null, 2)],
      };
    } else {
      throw new Error(`Unsupported pipe command "${operator}"`);
    }
  }
  return result;
}

export function getTerminalCompletions(input: string): string[] {
  const trimmed = input.trimStart();
  if (!trimmed.includes(" ")) {
    return ROOT_COMMANDS.filter((command) => command.startsWith(trimmed));
  }

  const [root, ...rest] = trimmed.split(/\s+/);
  if (root === "sorotask" && rest.length === 1) {
    return SOROTASK_COMMANDS
      .filter((command) => command.startsWith(rest[0]))
      .map((command) => `${root} ${command}`);
  }
  return [];
}
