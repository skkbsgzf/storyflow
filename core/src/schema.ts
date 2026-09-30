import AjvModule from "ajv/dist/2020.js";
import { nodeFs, nodePath, nodeEnv } from "./abstraction/defaults.js";

interface ValidateFn {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }>;
}
interface AjvInstance {
  addSchema(schema: object, id: string): void;
  getSchema(id: string): ValidateFn | undefined;
}
// ajv/dist/2020 的 CJS interop 类型不完整，收窄为实际用到的面
const Ajv2020 = AjvModule as unknown as new (opts: Record<string, unknown>) => AjvInstance;

/**
 * 语料根（FS1 §六 D3 真解耦，工单 R7-2）：不再 import 期求值——宿主未注册适配器时
 * import 本模块不再炸；语料寻址保持字符串口径不变。CORE_DIR 无消费者，随常量形态一并退役。
 */
export function rootOf(): string {
  const dir = nodePath.dirname(nodePath.fromFileUrl(import.meta.url));
  return nodePath.resolve(dir, "..", "..");
}
export function contractsDirOf(): string {
  return nodeEnv.get("MINIFLOW_CONTRACTS_DIR") ?? nodePath.join(rootOf(), "contracts");
}

const SCHEMA_IDS = [
  "run-state",
  "task-package",
  "artifact",
  "artifact-header",
  "journal-event",
  "minitool",
  "flow",
  "flow-overlay",
  "module",
  "module-report",
  "skill-overlay",
  "toolbox",
  "page-payload",
  "metrics",
  "diagnostics",
  "flow-pack",
  // 批D（kit@1 清场）："kit" 已除名——kits/ 与装载路径删除，contracts/kit.schema.json 只读留档
  "agent-profile",
  "project-config",
  "decision",
  "catalog-entry",
  "assertion-preset",
] as const;
export type SchemaId = (typeof SCHEMA_IDS)[number];

const validators = new Map<SchemaId, ValidateFn>();

function loadAjv(): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  for (const id of SCHEMA_IDS) {
    const file = nodePath.join(contractsDirOf(), `${id}.schema.json`);
    if (!nodeFs.exists(file)) continue;
    const schema = JSON.parse(nodeFs.readText(file));
    ajv.addSchema(schema, `miniflow/${id}`);
  }
  for (const id of SCHEMA_IDS) {
    const v = ajv.getSchema(`miniflow/${id}`);
    if (v) validators.set(id, v);
  }
}
let ajvLoaded = false;
/** 惰性装载（D3 同族）：首次 assertSchema 才读盘——import 本模块不再有副作用。 */
function ensureLoaded(): void {
  if (ajvLoaded) return;
  ajvLoaded = true;
  loadAjv();
}

export class SchemaViolation extends Error {
  constructor(public schemaId: string, public errors: string) {
    super(`schema violation [${schemaId}]: ${errors}`);
  }
}

/** 落盘前复验入口：不过即抛 SchemaViolation（磁盘快照永远合法）。 */
export function assertSchema(schemaId: SchemaId, obj: unknown): void {
  ensureLoaded();
  const v = validators.get(schemaId);
  if (!v) throw new SchemaViolation(schemaId, `validator missing (${contractsDirOf()})`);
  if (!v(obj)) {
    const errs = (v.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ""}`).join("; ");
    throw new SchemaViolation(schemaId, errs);
  }
}

export function schemaLoaded(): boolean {
  ensureLoaded();
  return validators.has("run-state");
}
