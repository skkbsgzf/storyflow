import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AjvModule from "ajv/dist/2020.js";

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CORE_DIR = path.resolve(__dirname, "..");
export const ROOT = path.resolve(CORE_DIR, "..");
export const CONTRACTS_DIR = process.env.MINIFLOW_CONTRACTS_DIR ?? path.join(ROOT, "contracts");

const SCHEMA_IDS = [
  "run-state",
  "task-package",
  "artifact",
  "artifact-header",
  "journal-event",
  "minitool",
  "flow",
  "flow-overlay",
  "metrics",
  "flow-pack",
  "kit",
  "agent-profile",
  "project-config",
] as const;
export type SchemaId = (typeof SCHEMA_IDS)[number];

const validators = new Map<SchemaId, ValidateFn>();

function loadAjv(): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  for (const id of SCHEMA_IDS) {
    const file = path.join(CONTRACTS_DIR, `${id}.schema.json`);
    if (!fs.existsSync(file)) continue;
    const schema = JSON.parse(fs.readFileSync(file, "utf-8"));
    ajv.addSchema(schema, `miniflow/${id}`);
  }
  for (const id of SCHEMA_IDS) {
    const v = ajv.getSchema(`miniflow/${id}`);
    if (v) validators.set(id, v);
  }
}
loadAjv();

export class SchemaViolation extends Error {
  constructor(public schemaId: string, public errors: string) {
    super(`schema violation [${schemaId}]: ${errors}`);
  }
}

/** 落盘前复验入口：不过即抛 SchemaViolation（磁盘快照永远合法）。 */
export function assertSchema(schemaId: SchemaId, obj: unknown): void {
  const v = validators.get(schemaId);
  if (!v) throw new SchemaViolation(schemaId, `validator missing (${CONTRACTS_DIR})`);
  if (!v(obj)) {
    const errs = (v.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ""}`).join("; ");
    throw new SchemaViolation(schemaId, errs);
  }
}

export function schemaLoaded(): boolean {
  return validators.has("run-state");
}
