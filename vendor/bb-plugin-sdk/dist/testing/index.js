// src/testing/fake-plugin-host.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CronExpressionParser } from "cron-parser";
import { Hono } from "hono";
import { z } from "zod";

// src/backend-contract.ts
var PLUGIN_CLI_OUTPUT_MAX_BYTES = 1024 * 1024;

// src/testing/fake-sdk.ts
function withSpawnAttribution(pluginId, args) {
  const [first, ...rest] = args;
  if (typeof first !== "object" || first === null) return args;
  const spawnArgs = first;
  const origin = spawnArgs.origin ?? "plugin";
  return [
    {
      ...spawnArgs,
      origin,
      ...origin === "plugin" ? { originPluginId: spawnArgs.originPluginId ?? pluginId } : {}
    },
    ...rest
  ];
}
function createFakeSdk(options) {
  const calls = [];
  const stubs = /* @__PURE__ */ new Map();
  function addOverrides(prefix, value) {
    if (typeof value === "function") {
      stubs.set(prefix, value);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      addOverrides(prefix.length === 0 ? key : `${prefix}.${key}`, child);
    }
  }
  addOverrides("", options.overrides ?? {});
  function invoke(path, rawArgs) {
    const args = path === "threads.spawn" ? withSpawnAttribution(options.pluginId, rawArgs) : rawArgs;
    calls.push({ path, args });
    const stub = stubs.get(path);
    if (!stub) {
      throw new Error(
        `bb.sdk.${path} is not stubbed \u2014 pass an implementation via createFakePluginHost({ sdk: { ... } }) or harness.sdk.stub("${path}", fn)`
      );
    }
    return stub(...args);
  }
  const nodes = /* @__PURE__ */ new Map();
  function node(path) {
    const cached = nodes.get(path);
    if (cached) return cached;
    const created = new Proxy(function() {
    }, {
      get(_target, prop) {
        if (typeof prop !== "string" || prop === "then") return void 0;
        return node(path === "" ? prop : `${path}.${prop}`);
      },
      apply(_target, _thisArg, args) {
        return invoke(path, args);
      }
    });
    nodes.set(path, created);
    return created;
  }
  const harness = {
    calls,
    callsTo(path) {
      return calls.filter((call) => call.path === path).map((call) => call.args);
    },
    stub(path, implementation) {
      stubs.set(path, implementation);
    }
  };
  return { sdk: node(""), harness };
}

// src/testing/fake-plugin-host.ts
var PluginContextStaleError = class extends Error {
  constructor(pluginId) {
    super(
      `plugin "${pluginId}" used a stale API handle \u2014 it was reloaded or disabled; re-entry happens via a fresh factory call`
    );
    this.name = "PluginContextStaleError";
  }
};
var KV_VALUE_MAX_BYTES = 256 * 1024;
var PLUGIN_INTERACTION_MAX_TITLE_LENGTH = 160;
var PLUGIN_HTTP_METHODS = /* @__PURE__ */ new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS"
]);
var RPC_METHOD_PATTERN = /^[a-zA-Z0-9_-]+$/;
var BACKGROUND_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
var CLI_COMMAND_NAME_PATTERN = /^[a-z0-9-]+$/;
var AGENT_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
var PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS = 4096;
var PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS = 80;
var PLUGIN_AGENT_SELECTION_MAX_IDS = 256;
var PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS = 4096;
function enforcePluginCliOutputLimit(result, jsonOutput) {
  const stdoutBytes = Buffer.byteLength(result.stdout, "utf8");
  const stderrBytes = Buffer.byteLength(result.stderr, "utf8");
  const totalBytes = stdoutBytes + stderrBytes;
  if (totalBytes <= PLUGIN_CLI_OUTPUT_MAX_BYTES) return result;
  const error = {
    code: "plugin_cli_output_too_large",
    message: `Plugin CLI output is ${totalBytes} bytes (${stdoutBytes} stdout + ${stderrBytes} stderr), exceeding the ${PLUGIN_CLI_OUTPUT_MAX_BYTES}-byte limit. Narrow the query, request a smaller page, or use a file/streaming command.`,
    maxBytes: PLUGIN_CLI_OUTPUT_MAX_BYTES,
    stdoutBytes,
    stderrBytes,
    totalBytes
  };
  return jsonOutput ? {
    exitCode: 1,
    stdout: JSON.stringify({ error }),
    stderr: "",
    error
  } : { exitCode: 1, stdout: "", stderr: error.message, error };
}
var MENTION_PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
var PLUGIN_MENTION_TRIGGER_VALUES = [
  "@",
  "#",
  "$",
  "!",
  "~"
];
var DEFAULT_PLUGIN_MENTION_TRIGGERS = [
  "@"
];
var SETTING_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
function isPluginMentionTrigger(value) {
  return typeof value === "string" && PLUGIN_MENTION_TRIGGER_VALUES.includes(value);
}
function normalizeMentionProviderTriggers(providerId, triggers) {
  if (triggers === void 0) {
    return DEFAULT_PLUGIN_MENTION_TRIGGERS;
  }
  if (!Array.isArray(triggers)) {
    throw new Error(
      `mention provider "${providerId}" triggers must be an array`
    );
  }
  if (triggers.length === 0) {
    throw new Error(
      `mention provider "${providerId}" triggers must include at least one trigger`
    );
  }
  const seen = /* @__PURE__ */ new Set();
  const normalized = [];
  for (const trigger of triggers) {
    if (!isPluginMentionTrigger(trigger)) {
      throw new Error(
        `mention provider "${providerId}" trigger ${JSON.stringify(trigger)} is invalid \u2014 use one of ${PLUGIN_MENTION_TRIGGER_VALUES.join(" ")}`
      );
    }
    if (seen.has(trigger)) {
      throw new Error(
        `mention provider "${providerId}" trigger ${JSON.stringify(trigger)} is duplicated`
      );
    }
    seen.add(trigger);
    normalized.push(trigger);
  }
  return normalized;
}
var RESERVED_BB_CLI_COMMANDS = [
  "environment",
  "guide",
  "help",
  "manager",
  "plugin",
  "project",
  "provider",
  "status",
  "theme",
  "thread",
  "ui"
];
var RESERVED_AGENT_TOOL_NAMES = [
  "update_environment_directory"
];
var settingsBaseFields = {
  label: z.string().min(1),
  description: z.string().min(1).optional()
};
var settingDescriptorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("string"),
    ...settingsBaseFields,
    secret: z.literal(true).optional(),
    default: z.string().optional()
  }).strict(),
  z.object({
    type: z.literal("boolean"),
    ...settingsBaseFields,
    default: z.boolean().optional()
  }).strict(),
  z.object({
    type: z.literal("select"),
    ...settingsBaseFields,
    options: z.array(z.string().min(1)).min(1),
    default: z.string().optional()
  }).strict(),
  z.object({
    type: z.literal("project"),
    ...settingsBaseFields,
    default: z.string().optional()
  }).strict()
]);
function registerSettingDescriptors(target, added) {
  const validated = {};
  for (const [key, raw] of Object.entries(added)) {
    if (!SETTING_KEY_PATTERN.test(key)) {
      throw new Error(
        `invalid setting key "${key}" \u2014 use letters, digits, "-" and "_"`
      );
    }
    if (key in target) {
      throw new Error(`setting "${key}" is already defined`);
    }
    const parsed = settingDescriptorSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") ?? "";
      throw new Error(
        `invalid descriptor for setting "${key}"${path ? ` (${path})` : ""}: ${issue?.message ?? "unknown error"}`
      );
    }
    const descriptor = parsed.data;
    if (descriptor.type === "select" && descriptor.default !== void 0 && !descriptor.options.includes(descriptor.default)) {
      throw new Error(
        `default for setting "${key}" must be one of its options`
      );
    }
    validated[key] = descriptor;
  }
  Object.assign(target, validated);
  return validated;
}
function readSettingsValues(descriptors, stored) {
  const values = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    let value = stored.get(key);
    const expected = descriptor.type === "boolean" ? "boolean" : "string";
    if (typeof value !== expected) value = void 0;
    if (descriptor.type === "select" && typeof value === "string" && !descriptor.options.includes(value)) {
      value = void 0;
    }
    values[key] = value ?? descriptor.default;
  }
  return values;
}
function validateSettingsUpdate(descriptors, values) {
  const errors = [];
  for (const [key, value] of Object.entries(values)) {
    const descriptor = descriptors[key];
    if (!descriptor) {
      errors.push(`unknown setting "${key}"`);
      continue;
    }
    if (value === null) continue;
    if (descriptor.type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push(`setting "${key}" expects a boolean`);
      }
      continue;
    }
    if (typeof value !== "string") {
      errors.push(`setting "${key}" expects a string`);
      continue;
    }
    if (descriptor.type === "select" && !descriptor.options.includes(value)) {
      errors.push(
        `setting "${key}" must be one of: ${descriptor.options.join(", ")}`
      );
    }
  }
  return errors;
}
function isNeedsConfigurationError(error) {
  return error instanceof Error && error.name === "NeedsConfigurationError";
}
function isZodSchemaLike(value) {
  return typeof value === "object" && value !== null && typeof value.safeParse === "function";
}
function summarizeParseIssues(error) {
  const issues = error?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues.map((issue) => {
      const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "(input)";
      return `${path}: ${issue.message ?? "invalid"}`;
    }).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function jsonRoundTrip(value, what) {
  if (value === void 0) return void 0;
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    json = void 0;
  }
  if (json === void 0) {
    throw new Error(`${what} is not JSON-serializable`);
  }
  return JSON.parse(json);
}
function isStandardSchema(value) {
  if (typeof value !== "object" || value === null) return false;
  const standard = Reflect.get(value, "~standard");
  return typeof standard === "object" && standard !== null && Reflect.get(standard, "version") === 1 && typeof Reflect.get(standard, "vendor") === "string" && typeof Reflect.get(standard, "validate") === "function";
}
function readRpcMethodContract(method, value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `rpc method "${method}" contract must provide input and output Standard Schemas`
    );
  }
  const input = Reflect.get(value, "input");
  const output = Reflect.get(value, "output");
  if (!isStandardSchema(input)) {
    throw new Error(
      `rpc method "${method}" input must be a Standard Schema v1 validator`
    );
  }
  if (!isStandardSchema(output)) {
    throw new Error(
      `rpc method "${method}" output must be a Standard Schema v1 validator`
    );
  }
  return { input, output };
}
function normalizeRpcIssues(issues) {
  return issues.map((issue) => {
    const rawPath = issue.path;
    const segments = rawPath === void 0 ? [] : Array.isArray(rawPath) ? rawPath : [rawPath];
    const path = segments.map((segment) => {
      const key = typeof segment === "object" && segment !== null ? Reflect.get(segment, "key") : segment;
      return typeof key === "number" ? key : String(key);
    });
    return {
      message: issue.message,
      ...path.length > 0 ? { path } : {}
    };
  });
}
function throwRpcError(error) {
  const thrown = new Error(error.message);
  Reflect.set(thrown, "code", error.code);
  if (error.issues !== void 0) Reflect.set(thrown, "issues", error.issues);
  throw thrown;
}
async function validateRpcValue(schema, value, phase) {
  let result;
  try {
    result = await schema["~standard"].validate(value);
  } catch (error) {
    const message = errorMessage(error);
    return throwRpcError({
      code: phase === "input" ? "invalid_input" : "invalid_output",
      message: `rpc ${phase} validator failed: ${message}`,
      issues: [{ message }]
    });
  }
  if (result.issues !== void 0) {
    return throwRpcError({
      code: phase === "input" ? "invalid_input" : "invalid_output",
      message: `rpc ${phase} validation failed`,
      issues: normalizeRpcIssues(result.issues)
    });
  }
  return result.value;
}
function normalizeRpcJsonResult(value) {
  const ancestors = /* @__PURE__ */ new Set();
  function visit(current, path) {
    if (current === null || typeof current === "string" || typeof current === "boolean") {
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        return throwRpcError({
          code: "non_json_result",
          message: `rpc result at ${path} contains a non-finite number`
        });
      }
      return current;
    }
    if (typeof current !== "object") {
      return throwRpcError({
        code: "non_json_result",
        message: `rpc result at ${path} is not a JSON value (${typeof current})`
      });
    }
    if (ancestors.has(current)) {
      return throwRpcError({
        code: "non_json_result",
        message: `rpc result at ${path} is cyclic`
      });
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        return current.map((item, index) => visit(item, `${path}[${index}]`));
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        return throwRpcError({
          code: "non_json_result",
          message: `rpc result at ${path} must be a plain JSON object`
        });
      }
      if (Reflect.ownKeys(current).some((key) => typeof key === "symbol")) {
        return throwRpcError({
          code: "non_json_result",
          message: `rpc result at ${path} contains a symbol key`
        });
      }
      const normalized = {};
      for (const [key, child] of Object.entries(current)) {
        normalized[key] = visit(child, `${path}.${key}`);
      }
      return normalized;
    } finally {
      ancestors.delete(current);
    }
  }
  return visit(value, "$result");
}
var AGENT_TOOL_PARAMETERS_MAX_BYTES = 128 * 1024;
function normalizeAgentToolSelections(args) {
  if (!Array.isArray(args.value)) {
    throw new Error("configure() output.tools must be an array");
  }
  if (args.value.length > PLUGIN_AGENT_SELECTION_MAX_IDS) {
    throw new Error(
      `configure() output.tools exceeds the ${PLUGIN_AGENT_SELECTION_MAX_IDS}-id limit`
    );
  }
  const toolIds = [];
  const parameterOverrides = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  for (let index = 0; index < args.value.length; index += 1) {
    const entry = args.value[index];
    let name;
    let parameters = null;
    if (typeof entry === "string") {
      name = entry;
    } else if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const typed = entry;
      const unknownKeys = Object.keys(typed).filter((key) => !["name", "parameters"].includes(key)).sort();
      if (unknownKeys.length > 0) {
        throw new Error(
          `configure() output.tools[${index}] contains unknown field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}`
        );
      }
      name = typed.name;
      parameters = normalizeAgentToolParameters({
        index,
        value: typed.parameters
      });
    } else {
      throw new Error(
        `configure() output.tools[${index}] must be a tool name or { name, parameters }`
      );
    }
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(
        `configure() output.tools[${index}] must ${typeof entry === "string" ? "be" : "name"} a non-empty string`
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `configure() output.tools contains duplicate id ${JSON.stringify(name)}`
      );
    }
    if (!args.knownIds.has(name)) {
      throw new Error(
        `configure() selected unknown tool id ${JSON.stringify(name)} owned by plugin ${JSON.stringify(args.pluginId)}`
      );
    }
    seen.add(name);
    toolIds.push(name);
    if (parameters !== null) parameterOverrides.set(name, parameters);
  }
  return { toolIds, parameterOverrides };
}
function normalizeAgentToolParameters(args) {
  const { index, value } = args;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `configure() output.tools[${index}].parameters must be a JSON-schema object`
    );
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(
      `configure() output.tools[${index}].parameters is not JSON-serializable`
    );
  }
  if (serialized === void 0) {
    throw new Error(
      `configure() output.tools[${index}].parameters is not JSON-serializable`
    );
  }
  if (Buffer.byteLength(serialized, "utf8") > AGENT_TOOL_PARAMETERS_MAX_BYTES) {
    throw new Error(
      `configure() output.tools[${index}].parameters exceeds the ${AGENT_TOOL_PARAMETERS_MAX_BYTES}-byte limit`
    );
  }
  const parameters = JSON.parse(serialized);
  if (parameters.type !== "object") {
    throw new Error(
      `configure() output.tools[${index}].parameters must have root type "object"`
    );
  }
  return parameters;
}
function normalizeAgentConfigurationIds(args) {
  if (!Array.isArray(args.value)) {
    throw new Error(`configure() output.${args.field} must be an array`);
  }
  if (args.value.length > PLUGIN_AGENT_SELECTION_MAX_IDS) {
    throw new Error(
      `configure() output.${args.field} exceeds the ${PLUGIN_AGENT_SELECTION_MAX_IDS}-id limit`
    );
  }
  const selected = [];
  const seen = /* @__PURE__ */ new Set();
  for (let index = 0; index < args.value.length; index += 1) {
    const id = args.value[index];
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        `configure() output.${args.field}[${index}] must be a non-empty string`
      );
    }
    if (seen.has(id)) {
      throw new Error(
        `configure() output.${args.field} contains duplicate id ${JSON.stringify(id)}`
      );
    }
    if (!args.knownIds.has(id)) {
      throw new Error(
        `configure() selected unknown skill id ${JSON.stringify(id)} owned by plugin ${JSON.stringify(args.pluginId)}`
      );
    }
    seen.add(id);
    selected.push(id);
  }
  return selected;
}
function normalizeAgentConfiguration(args) {
  if (typeof args.value !== "object" || args.value === null || Array.isArray(args.value)) {
    throw new Error(
      "configure() must return { tools: string[], skills: string[], instructions?: string }"
    );
  }
  const output = args.value;
  const unknownKeys = Object.keys(output).filter((key) => !["tools", "skills", "instructions"].includes(key)).sort();
  if (unknownKeys.length > 0) {
    throw new Error(
      `configure() output contains unknown field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}`
    );
  }
  if (output.instructions !== void 0 && typeof output.instructions !== "string") {
    throw new Error("configure() output.instructions must be a string");
  }
  const toolSelections = normalizeAgentToolSelections({
    knownIds: args.knownToolIds,
    pluginId: args.pluginId,
    value: output.tools
  });
  return {
    toolIds: toolSelections.toolIds,
    toolParameterOverrides: toolSelections.parameterOverrides,
    skillIds: normalizeAgentConfigurationIds({
      field: "skills",
      knownIds: args.knownSkillIds,
      pluginId: args.pluginId,
      value: output.skills
    }),
    instructions: typeof output.instructions === "string" && output.instructions.trim().length > 0 ? output.instructions.slice(
      0,
      PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS
    ) : null
  };
}
var fakeHostDisposers = /* @__PURE__ */ new WeakMap();
function createFakePluginHost(options = {}) {
  return createFakePluginHostInternal(options);
}
function createFakePluginHostInternal(options, sharedState) {
  const persistentState = sharedState ?? {
    kvRows: /* @__PURE__ */ new Map(),
    storageRoot: mkdtempSync(join(tmpdir(), "bb-fake-plugin-host-")),
    storedSettings: new Map(
      Object.entries(options.settings ?? {})
    )
  };
  const pluginId = options.pluginId ?? "test-plugin";
  const agentSkillIds = [...options.agentSkillIds ?? []];
  if (new Set(agentSkillIds).size !== agentSkillIds.length) {
    throw new Error("agentSkillIds must not contain duplicates");
  }
  let invalidated = false;
  let disposed = false;
  function assertLive() {
    if (invalidated) throw new PluginContextStaleError(pluginId);
  }
  const logEntries = [];
  function emitLog(level, message) {
    logEntries.push({ level, message });
  }
  const log = {
    debug: (message) => emitLog("debug", message),
    info: (message) => emitLog("info", message),
    warn: (message) => emitLog("warn", message),
    error: (message) => emitLog("error", message)
  };
  const kvRows = persistentState.kvRows;
  const kv = {
    async get(key) {
      assertLive();
      const raw = kvRows.get(key);
      if (raw === void 0) return void 0;
      return JSON.parse(raw);
    },
    async set(key, value) {
      assertLive();
      const json = JSON.stringify(value);
      if (json === void 0) {
        throw new Error(`kv value for "${key}" is not JSON-serializable`);
      }
      const bytes = Buffer.byteLength(json, "utf8");
      if (bytes > KV_VALUE_MAX_BYTES) {
        throw new Error(
          `kv value for "${key}" is ${bytes} bytes; the limit is ${KV_VALUE_MAX_BYTES} (256KB). Store large data in storage.database() instead.`
        );
      }
      kvRows.set(key, json);
    },
    async delete(key) {
      assertLive();
      kvRows.delete(key);
    },
    async list(prefix) {
      assertLive();
      return [...kvRows.keys()].filter((key) => prefix === void 0 || key.startsWith(prefix)).sort();
    }
  };
  const storageRoot = persistentState.storageRoot;
  let databaseHandle;
  const storage = {
    kv,
    database() {
      assertLive();
      if (!databaseHandle) {
        databaseHandle = new Database(join(storageRoot, "data.db"));
        databaseHandle.pragma("busy_timeout = 5000");
      }
      return databaseHandle;
    },
    migrate(database, statements) {
      assertLive();
      database.exec(
        "CREATE TABLE IF NOT EXISTS _bb_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)"
      );
      const applied = new Set(
        database.prepare("SELECT id FROM _bb_migrations").all().map((row) => row.id)
      );
      const record = database.prepare(
        "INSERT INTO _bb_migrations (id, applied_at) VALUES (?, ?)"
      );
      database.transaction(() => {
        statements.forEach((statement, index) => {
          if (applied.has(index)) return;
          database.exec(statement);
          record.run(index, Date.now());
        });
      })();
    }
  };
  const settingsDescriptors = {};
  const settingsListeners = [];
  const storedSettings = persistentState.storedSettings;
  const settings = {
    define(descriptors) {
      assertLive();
      registerSettingDescriptors(
        settingsDescriptors,
        descriptors
      );
      return {
        async get() {
          assertLive();
          return readSettingsValues(
            settingsDescriptors,
            storedSettings
          );
        },
        onChange(listener) {
          assertLive();
          settingsListeners.push(
            listener
          );
        }
      };
    }
  };
  const httpRoutes = [];
  const http = {
    route(method, path, handler, opts) {
      assertLive();
      const normalizedMethod = String(method).toUpperCase();
      if (!PLUGIN_HTTP_METHODS.has(normalizedMethod)) {
        throw new Error(
          `invalid http method "${String(method)}" \u2014 use one of: ${[...PLUGIN_HTTP_METHODS].join(", ")}`
        );
      }
      if (typeof path !== "string" || !path.startsWith("/")) {
        throw new Error(
          `http route path must be a string starting with "/", got ${JSON.stringify(path)}`
        );
      }
      if (typeof handler !== "function") {
        throw new Error(
          `http route handler for ${normalizedMethod} ${path} must be a function`
        );
      }
      const auth = opts?.auth ?? "local";
      if (auth !== "local" && auth !== "token" && auth !== "none") {
        throw new Error(
          `invalid auth mode "${String(auth)}" for ${normalizedMethod} ${path} \u2014 use "local", "token", or "none"`
        );
      }
      if (httpRoutes.some(
        (route) => route.method === normalizedMethod && route.path === path
      )) {
        throw new Error(
          `http route ${normalizedMethod} ${path} is already registered`
        );
      }
      httpRoutes.push({ method: normalizedMethod, path, auth, handler });
    }
  };
  const rpcHandlers = /* @__PURE__ */ new Map();
  const rpc = {
    register(contract, handlers) {
      assertLive();
      if (typeof contract !== "object" || contract === null || Array.isArray(contract)) {
        throw new Error("rpc.register contract must be an object");
      }
      if (typeof handlers !== "object" || handlers === null || Array.isArray(handlers)) {
        throw new Error("rpc.register handlers must be an object");
      }
      const pending = [];
      const contractEntries = Object.entries(contract);
      const contractNames = new Set(contractEntries.map(([name]) => name));
      for (const extraName of Object.keys(handlers)) {
        if (!contractNames.has(extraName)) {
          throw new Error(
            `rpc handler "${extraName}" has no matching contract method`
          );
        }
      }
      for (const [name, contractValue] of contractEntries) {
        if (!RPC_METHOD_PATTERN.test(name)) {
          throw new Error(
            `invalid rpc method name "${name}" \u2014 use letters, digits, "-" and "_"`
          );
        }
        const methodContract = readRpcMethodContract(name, contractValue);
        const handler = Reflect.get(handlers, name);
        if (typeof handler !== "function") {
          throw new Error(
            `rpc method "${name}" must provide a handler function`
          );
        }
        if (rpcHandlers.has(name)) {
          throw new Error(`rpc method "${name}" is already registered`);
        }
        pending.push([
          name,
          {
            inputSchema: methodContract.input,
            outputSchema: methodContract.output,
            handler
          }
        ]);
      }
      for (const [name, record] of pending) {
        rpcHandlers.set(name, record);
      }
    }
  };
  const realtimeSignals = [];
  const realtime = {
    publish(channel, payload) {
      assertLive();
      if (typeof channel !== "string" || channel.length === 0) {
        throw new Error("realtime channel must be a non-empty string");
      }
      const normalized = payload === void 0 ? null : jsonRoundTrip(
        payload,
        `realtime payload for channel "${channel}"`
      ) ?? null;
      realtimeSignals.push({ channel, payload: normalized });
    }
  };
  const services = [];
  const schedules = [];
  const background = {
    service(name, service) {
      assertLive();
      if (typeof name !== "string" || !BACKGROUND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid service name ${JSON.stringify(name)} \u2014 use letters, digits, "-" and "_"`
        );
      }
      if (services.some((record) => record.name === name)) {
        throw new Error(`background service "${name}" is already registered`);
      }
      if (typeof service?.start !== "function") {
        throw new Error(
          `background service "${name}" must provide a start(signal) function`
        );
      }
      services.push({ name, start: service.start.bind(service) });
    },
    schedule(name, cron, fn) {
      assertLive();
      if (typeof name !== "string" || !BACKGROUND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid schedule name ${JSON.stringify(name)} \u2014 use letters, digits, "-" and "_"`
        );
      }
      if (schedules.some((record) => record.name === name)) {
        throw new Error(`schedule "${name}" is already registered`);
      }
      try {
        CronExpressionParser.parse(String(cron));
      } catch (error) {
        throw new Error(
          `invalid cron ${JSON.stringify(cron)} for schedule "${name}": ${errorMessage(error)}`
        );
      }
      if (typeof fn !== "function") {
        throw new Error(`schedule "${name}" must provide a function`);
      }
      schedules.push({ name, cron: String(cron), fn });
    }
  };
  const cliRecord = {
    registration: null
  };
  const cli = {
    register(registration) {
      assertLive();
      if (cliRecord.registration !== null) {
        throw new Error("cli command is already registered");
      }
      const name = registration?.name;
      if (typeof name !== "string" || !CLI_COMMAND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid cli command name ${JSON.stringify(name)} \u2014 use lowercase letters, digits, and "-"`
        );
      }
      if (RESERVED_BB_CLI_COMMANDS.includes(name)) {
        throw new Error(
          `cli command name "${name}" is reserved by the bb CLI \u2014 pick another name`
        );
      }
      if (typeof registration.summary !== "string" || registration.summary.trim().length === 0) {
        throw new Error(`cli command "${name}" must provide a summary`);
      }
      const commands = registration.commands ?? [];
      if (!Array.isArray(commands)) {
        throw new Error(`cli command "${name}" commands must be an array`);
      }
      const validatedCommands = commands.map((command, index) => {
        if (typeof command?.name !== "string" || !CLI_COMMAND_NAME_PATTERN.test(command.name) || typeof command.summary !== "string" || typeof command.usage !== "string") {
          throw new Error(
            `cli command "${name}" commands[${index}] must be { name: [a-z0-9-]+, summary, usage }`
          );
        }
        return {
          name: command.name,
          summary: command.summary,
          usage: command.usage
        };
      });
      if (typeof registration.run !== "function") {
        throw new Error(
          `cli command "${name}" must provide a run(argv, ctx) function`
        );
      }
      cliRecord.registration = {
        name,
        summary: registration.summary,
        commands: validatedCommands,
        run: registration.run.bind(registration)
      };
    }
  };
  const agentTools = [];
  let agentConfigurationProvider = null;
  let instructionProvider = null;
  const agents = {
    configure(provider) {
      assertLive();
      if (agentConfigurationProvider !== null) {
        throw new Error("agent configuration is already registered");
      }
      if (typeof provider !== "function") {
        throw new Error(
          "configure requires a provider function (context) => ({ tools, skills, instructions? })"
        );
      }
      agentConfigurationProvider = provider;
    },
    contributeInstructions(provider) {
      assertLive();
      if (instructionProvider !== null) {
        throw new Error("agent instructions are already registered");
      }
      if (typeof provider !== "function") {
        throw new Error(
          "contributeInstructions requires a provider function (ctx) => string | null"
        );
      }
      instructionProvider = provider;
    },
    registerTool(tool) {
      assertLive();
      const name = tool?.name;
      if (typeof name !== "string" || !AGENT_TOOL_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid tool name ${JSON.stringify(name)} \u2014 use letters, digits, "-" and "_"`
        );
      }
      if (RESERVED_AGENT_TOOL_NAMES.includes(name)) {
        throw new Error(
          `tool name "${name}" is a built-in bb tool \u2014 pick another name`
        );
      }
      if (typeof tool.description !== "string" || tool.description.trim().length === 0) {
        throw new Error(`tool "${name}" must provide a description`);
      }
      if (tool.instructions !== void 0 && typeof tool.instructions !== "string") {
        throw new Error(`tool "${name}" instructions must be a string`);
      }
      if (typeof tool.instructions === "string" && tool.instructions.length > PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS) {
        throw new Error(
          `tool "${name}" instructions exceed the ${PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS}-character limit`
        );
      }
      const experimentalStatusLabels = tool.experimental_statusLabels;
      if (experimentalStatusLabels !== void 0 && (typeof experimentalStatusLabels !== "object" || experimentalStatusLabels === null || typeof experimentalStatusLabels.pending !== "string" || typeof experimentalStatusLabels.completed !== "string" || experimentalStatusLabels.pending.trim().length === 0 || experimentalStatusLabels.completed.trim().length === 0)) {
        throw new Error(
          `tool "${name}" experimental_statusLabels must provide non-empty pending and completed strings`
        );
      }
      if (experimentalStatusLabels !== void 0 && (experimentalStatusLabels.pending.length > PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS || experimentalStatusLabels.completed.length > PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS)) {
        throw new Error(
          `tool "${name}" experimental_statusLabels exceed the ${PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS}-character limit`
        );
      }
      if (typeof tool.execute !== "function") {
        throw new Error(
          `tool "${name}" must provide an execute(params, ctx) function`
        );
      }
      const parameters = tool.parameters;
      let inputSchema;
      let parse;
      if (isZodSchemaLike(parameters)) {
        try {
          inputSchema = z.toJSONSchema(parameters, {
            io: "input"
          });
        } catch (error) {
          throw new Error(
            `tool "${name}" parameters look like a zod schema but could not be converted to JSON Schema (${errorMessage(error)}) \u2014 use zod 4, or pass a plain JSON-schema object`
          );
        }
        parse = (input) => {
          const result = parameters.safeParse(input);
          if (result.success) return { ok: true, value: result.data };
          return { ok: false, error: summarizeParseIssues(result.error) };
        };
      } else if (typeof parameters === "object" && parameters !== null && !Array.isArray(parameters)) {
        try {
          inputSchema = JSON.parse(JSON.stringify(parameters));
        } catch {
          throw new Error(
            `tool "${name}" parameters JSON schema is not JSON-serializable`
          );
        }
        parse = (input) => ({ ok: true, value: input });
      } else {
        throw new Error(
          `tool "${name}" parameters must be a zod schema or a JSON-schema object`
        );
      }
      const record = {
        name,
        description: tool.description,
        experimentalStatusLabels: experimentalStatusLabels === void 0 ? null : {
          pending: experimentalStatusLabels.pending,
          completed: experimentalStatusLabels.completed
        },
        instructions: tool.instructions !== void 0 && tool.instructions.trim().length > 0 ? tool.instructions : null,
        inputSchema,
        parse,
        execute: tool.execute.bind(tool)
      };
      if (agentTools.some((existing) => existing.name === name)) {
        throw new Error(`tool "${name}" is already registered`);
      }
      agentTools.push(record);
    }
  };
  const mentionProviders = [];
  const ui = {
    requestInput,
    registerMentionProvider(provider) {
      assertLive();
      const id = provider?.id;
      if (typeof id !== "string" || !MENTION_PROVIDER_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid mention provider id ${JSON.stringify(id)} \u2014 use letters, digits, "-" and "_"`
        );
      }
      if (mentionProviders.some((record) => record.id === id)) {
        throw new Error(`mention provider "${id}" is already registered`);
      }
      if (typeof provider.label !== "string" || provider.label.trim().length === 0) {
        throw new Error(`mention provider "${id}" must provide a label`);
      }
      if (typeof provider.search !== "function") {
        throw new Error(
          `mention provider "${id}" must provide a search({ query, projectId, threadId }) function`
        );
      }
      if (typeof provider.resolve !== "function") {
        throw new Error(
          `mention provider "${id}" must provide a resolve(itemId) function`
        );
      }
      mentionProviders.push({
        id,
        label: provider.label.trim(),
        triggers: normalizeMentionProviderTriggers(id, provider.triggers),
        search: provider.search.bind(provider),
        resolve: provider.resolve.bind(provider)
      });
    }
  };
  const needsConfigurationMessages = [];
  const status = {
    needsConfiguration(message) {
      assertLive();
      needsConfigurationMessages.push(
        typeof message === "string" && message.length > 0 ? message : "needs configuration"
      );
    }
  };
  const loopbackBaseUrl = options.loopbackBaseUrl ?? "http://127.0.0.1:38886";
  const server = {
    get loopbackBaseUrl() {
      assertLive();
      return loopbackBaseUrl;
    }
  };
  const { sdk, harness: sdkHarness } = createFakeSdk({
    pluginId,
    overrides: options.sdk
  });
  const threadEventHandlers = {
    "thread.created": [],
    "thread.active": [],
    "thread.idle": [],
    "thread.failed": [],
    "thread.archived": [],
    "thread.deleted": []
  };
  const disposeHooks = [];
  const serviceControllers = [];
  let nextInteractionId = 1;
  const pendingInteractions = /* @__PURE__ */ new Map();
  function requestInput(request, requestOptions) {
    assertLive();
    if (!request || typeof request !== "object") {
      throw new Error("ui.requestInput requires an options object");
    }
    if (typeof request.threadId !== "string" || request.threadId.length === 0) {
      throw new Error("ui.requestInput threadId must be a non-empty string");
    }
    if (typeof request.rendererId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(request.rendererId)) {
      throw new Error(
        "ui.requestInput rendererId must use letters, digits, '-' or '_'"
      );
    }
    if (typeof request.title !== "string" || request.title.trim().length === 0 || request.title.trim().length > PLUGIN_INTERACTION_MAX_TITLE_LENGTH) {
      throw new Error(
        `ui.requestInput title must be 1-${PLUGIN_INTERACTION_MAX_TITLE_LENGTH} characters`
      );
    }
    let payload;
    try {
      const json = JSON.stringify(request.payload);
      if (json === void 0) throw new Error();
      if (Buffer.byteLength(json, "utf8") > 64 * 1024) {
        throw new Error("ui.requestInput payload exceeds 64 KiB");
      }
      payload = JSON.parse(json);
    } catch (error) {
      if (error instanceof Error && error.message.includes("64 KiB")) {
        throw error;
      }
      throw new Error("ui.requestInput payload must be JSON-serializable");
    }
    const timeoutMs = request.timeoutMs ?? 10 * 60 * 1e3;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60 * 60 * 1e3) {
      throw new Error(
        "ui.requestInput timeoutMs must be between 1 and 3600000"
      );
    }
    const normalizedRequest = {
      ...request,
      title: request.title.trim(),
      payload,
      timeoutMs
    };
    const id = `fake-interaction-${nextInteractionId++}`;
    return new Promise((resolve) => {
      const settleAborted = () => {
        const pending = pendingInteractions.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingInteractions.delete(id);
        resolve({ outcome: "cancelled", reason: "request-aborted" });
      };
      requestOptions?.signal?.addEventListener("abort", settleAborted, {
        once: true
      });
      const timer = setTimeout(() => {
        pendingInteractions.delete(id);
        resolve({ outcome: "cancelled", reason: "timeout" });
      }, timeoutMs);
      pendingInteractions.set(id, {
        request: normalizedRequest,
        resolve,
        timer
      });
    });
  }
  const sharedPortDeclarations = [];
  const hosts = {
    async ensureSharedPortTunnel(hostId) {
      assertLive();
      if (hostId.trim().length === 0) {
        throw new Error("shared-port hostId must be non-empty");
      }
      const identity = options.sharedPortTunnelIdentities?.[hostId];
      if (!identity) {
        throw new Error(`host ${hostId} has no shared-port tunnel identity`);
      }
      return { ...identity };
    },
    declareSharedPorts(hostId, ports) {
      assertLive();
      if (hostId.trim().length === 0) {
        throw new Error("shared-port hostId must be non-empty");
      }
      const normalizedPorts = [...new Set(ports)].sort((a, b) => a - b);
      for (const port of normalizedPorts) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error(
            `shared port ${String(port)} must be an integer between 1 and 65535`
          );
        }
      }
      const replacement = {
        hostId,
        ports: normalizedPorts
      };
      const existingIndex = sharedPortDeclarations.findIndex(
        (declaration) => declaration.hostId === hostId
      );
      if (existingIndex === -1) {
        sharedPortDeclarations.push(replacement);
      } else {
        sharedPortDeclarations[existingIndex] = replacement;
      }
    }
  };
  disposeHooks.push(() => {
    sharedPortDeclarations.length = 0;
  });
  const events = {
    on(event, handler) {
      assertLive();
      const handlers = threadEventHandlers[event];
      if (handlers === void 0) {
        throw new Error(
          `unknown event "${String(event)}" \u2014 supported events: ${Object.keys(
            threadEventHandlers
          ).join(", ")}`
        );
      }
      handlers.push(handler);
    }
  };
  const bb = {
    pluginId,
    log,
    settings,
    storage,
    http,
    rpc,
    realtime,
    background,
    cli,
    agents,
    ui,
    events,
    status,
    server,
    hosts,
    get sdk() {
      assertLive();
      return sdk;
    },
    onDispose(hook) {
      assertLive();
      disposeHooks.push(hook);
    }
  };
  async function disposeHost(cleanupStorage) {
    if (disposed) return;
    disposed = true;
    for (const [id, pending] of pendingInteractions) {
      clearTimeout(pending.timer);
      pendingInteractions.delete(id);
      pending.resolve({ outcome: "cancelled", reason: "plugin-disposed" });
    }
    for (const controller of serviceControllers) controller.abort();
    for (const hook of [...disposeHooks].reverse()) {
      try {
        await hook();
      } catch (error) {
        emitLog("warn", `dispose hook failed: ${errorMessage(error)}`);
      }
    }
    if (databaseHandle) {
      try {
        databaseHandle.close();
      } catch (error) {
        emitLog("warn", `database close failed: ${errorMessage(error)}`);
      }
    }
    if (cleanupStorage) {
      rmSync(storageRoot, { recursive: true, force: true });
    }
    invalidated = true;
  }
  const harness = {
    get behavior() {
      return this;
    },
    get inspection() {
      return this;
    },
    get lifecycle() {
      return this;
    },
    pluginId,
    logEntries,
    realtimeSignals,
    needsConfigurationMessages,
    sharedPortDeclarations,
    sdk: sdkHarness,
    registrations: {
      settingsDescriptors,
      httpRoutes,
      get rpcMethods() {
        return [...rpcHandlers.keys()];
      },
      services,
      schedules,
      get cli() {
        return cliRecord.registration;
      },
      agentTools,
      get agentConfigurationProvider() {
        return agentConfigurationProvider;
      },
      get instructionProvider() {
        return instructionProvider;
      },
      get threadEventHandlers() {
        return {
          "thread.created": threadEventHandlers["thread.created"].length,
          "thread.active": threadEventHandlers["thread.active"].length,
          "thread.idle": threadEventHandlers["thread.idle"].length,
          "thread.failed": threadEventHandlers["thread.failed"].length,
          "thread.archived": threadEventHandlers["thread.archived"].length,
          "thread.deleted": threadEventHandlers["thread.deleted"].length
        };
      },
      mentionProviders
    },
    get pendingInteractions() {
      return [...pendingInteractions].map(([id, pending]) => ({
        id,
        ...pending.request
      }));
    },
    submitInteraction(id, value) {
      const pending = pendingInteractions.get(id);
      if (!pending) throw new Error(`no pending interaction "${id}"`);
      clearTimeout(pending.timer);
      pendingInteractions.delete(id);
      pending.resolve({ outcome: "submitted", value });
    },
    cancelInteraction(id) {
      const pending = pendingInteractions.get(id);
      if (!pending) throw new Error(`no pending interaction "${id}"`);
      clearTimeout(pending.timer);
      pendingInteractions.delete(id);
      pending.resolve({ outcome: "cancelled", reason: "user" });
    },
    async setSettings(values) {
      const errors = validateSettingsUpdate(settingsDescriptors, values);
      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }
      const prev = readSettingsValues(settingsDescriptors, storedSettings);
      for (const [key, value] of Object.entries(values)) {
        if (value === null) storedSettings.delete(key);
        else storedSettings.set(key, value);
      }
      const next = readSettingsValues(settingsDescriptors, storedSettings);
      if (JSON.stringify(next) === JSON.stringify(prev)) return;
      for (const listener of settingsListeners) {
        try {
          listener(next, prev);
        } catch (error) {
          emitLog(
            "warn",
            `settings onChange listener failed: ${errorMessage(error)}`
          );
        }
      }
    },
    async callRpc(method, input) {
      const record = rpcHandlers.get(method);
      if (!record) {
        return throwRpcError({
          code: "unknown_method",
          message: `plugin "${pluginId}" has no rpc method "${method}"`
        });
      }
      const parsedInput = input === void 0 ? null : jsonRoundTrip(input, `rpc "${method}" input`);
      const validatedInput = await validateRpcValue(
        record.inputSchema,
        parsedInput,
        "input"
      );
      let result;
      try {
        result = await record.handler(validatedInput);
      } catch (error) {
        return throwRpcError({
          code: "handler_error",
          message: errorMessage(error)
        });
      }
      const validatedOutput = await validateRpcValue(
        record.outputSchema,
        result,
        "output"
      );
      return normalizeRpcJsonResult(validatedOutput);
    },
    async runCli(argv, ctx = {}) {
      const registration = cliRecord.registration;
      if (!registration) {
        throw new Error(`plugin "${pluginId}" registers no CLI command`);
      }
      try {
        const result = await registration.run(argv, ctx);
        if (typeof result?.exitCode !== "number") {
          throw new Error(
            "cli run() must return { exitCode: number, stdout?, stderr? }"
          );
        }
        return enforcePluginCliOutputLimit(
          {
            exitCode: result.exitCode,
            stdout: typeof result.stdout === "string" ? result.stdout : "",
            stderr: typeof result.stderr === "string" ? result.stderr : ""
          },
          argv.includes("--json")
        );
      } catch (error) {
        return enforcePluginCliOutputLimit(
          {
            exitCode: 1,
            stdout: "",
            stderr: `bb ${registration.name} failed: ${errorMessage(error)}`
          },
          argv.includes("--json")
        );
      }
    },
    async fetchHttp(method, path, init) {
      const normalizedMethod = String(method).toUpperCase();
      const pathname = new URL(path, "http://plugin.test").pathname;
      const route = httpRoutes.find(
        (candidate) => candidate.method === normalizedMethod && candidate.path === pathname
      );
      if (!route) {
        throw new Error(
          `no http route ${normalizedMethod} ${pathname} is registered \u2014 registered: ${httpRoutes.map((r) => `${r.method} ${r.path}`).join(", ") || "(none)"}`
        );
      }
      const app = new Hono();
      app.on(route.method, route.path, async (context) => {
        try {
          const response = await route.handler(context);
          if (!(response instanceof Response)) {
            throw new Error("http route handler must return a Response");
          }
          return response;
        } catch (error) {
          const message = errorMessage(error);
          emitLog(
            "warn",
            `http ${route.method} ${route.path} failed: ${message}`
          );
          return context.json(
            { ok: false, error: `plugin route failed: ${message}` },
            500
          );
        }
      });
      return app.request(path, { ...init, method: normalizedMethod });
    },
    runService(name) {
      const service = services.find((record) => record.name === name);
      if (!service) {
        throw new Error(`no background service "${name}" is registered`);
      }
      const controller = new AbortController();
      serviceControllers.push(controller);
      let started;
      try {
        started = Promise.resolve(service.start(controller.signal)).then(
          () => void 0
        );
      } catch (error) {
        started = Promise.reject(error);
      }
      const done = started.catch((error) => {
        if (isNeedsConfigurationError(error)) {
          needsConfigurationMessages.push(error.message);
          return void 0;
        }
        throw error;
      });
      return { controller, done };
    },
    async runSchedule(name) {
      const schedule = schedules.find((record) => record.name === name);
      if (!schedule) {
        throw new Error(`no schedule "${name}" is registered`);
      }
      await schedule.fn();
    },
    async emitThreadEvent(event, payload) {
      const errors = [];
      for (const handler of [...threadEventHandlers[event]]) {
        try {
          await handler(payload);
        } catch (error) {
          errors.push(error);
          emitLog("warn", `${event} handler failed: ${errorMessage(error)}`);
        }
      }
      return { errors };
    },
    async callAgentTool(name, input, ctx) {
      const record = agentTools.find((tool) => tool.name === name);
      if (!record) {
        throw new Error(`no agent tool "${name}" is registered`);
      }
      const parsed = record.parse(input);
      if (!parsed.ok) {
        throw new Error(
          `tool "${name}" arguments are invalid: ${parsed.error}`
        );
      }
      return record.execute(parsed.value, {
        threadId: ctx?.threadId ?? "thread-test",
        projectId: ctx?.projectId ?? "project-test",
        signal: ctx?.signal ?? new AbortController().signal
      });
    },
    async resolveAgentConfiguration(context) {
      if (agentConfigurationProvider === null) {
        return {
          tools: [...agentTools],
          skills: [...agentSkillIds],
          instructions: null
        };
      }
      try {
        const normalized = normalizeAgentConfiguration({
          knownSkillIds: new Set(agentSkillIds),
          knownToolIds: new Set(agentTools.map((tool) => tool.name)),
          pluginId,
          value: agentConfigurationProvider(context)
        });
        const selectedTools = new Set(normalized.toolIds);
        return {
          tools: agentTools.filter((tool) => selectedTools.has(tool.name)).map((tool) => {
            const parameters = normalized.toolParameterOverrides.get(
              tool.name
            );
            return parameters === void 0 ? tool : { ...tool, inputSchema: parameters };
          }),
          skills: normalized.skillIds,
          instructions: normalized.instructions
        };
      } catch (error) {
        emitLog("warn", `agent configure failed: ${errorMessage(error)}`);
        return { tools: [], skills: [], instructions: null };
      }
    },
    async reload(factory) {
      assertLive();
      const replacement = createFakePluginHostInternal(
        options,
        persistentState
      );
      try {
        await factory(replacement.bb);
      } catch (error) {
        await fakeHostDisposers.get(replacement.harness)?.(false);
        throw error;
      }
      await disposeHost(false);
      return replacement;
    },
    async dispose() {
      await disposeHost(true);
    }
  };
  fakeHostDisposers.set(harness, disposeHost);
  return { bb, harness };
}

// src/testing/fixtures.ts
function makeThreadResponse(overrides = {}) {
  return {
    id: "thread-1",
    projectId: "project-1",
    environmentId: null,
    providerId: "test-provider",
    title: null,
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    childOrigin: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 0,
    createdAt: 0,
    updatedAt: 0,
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    canSpawnChild: true,
    ...overrides
  };
}
export {
  PluginContextStaleError,
  createFakePluginHost,
  createFakeSdk,
  makeThreadResponse
};
