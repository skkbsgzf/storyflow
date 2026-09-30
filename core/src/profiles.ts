import { nodeFs, nodePath } from "./abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import { assertSchema } from "./schema.js";

export interface AgentProfile {
  id: string;
  title: string;
  role: string;
  version: string;
  status?: string;
  mission?: string;
  three_layer_binding?: { skill?: string; skills?: string[]; knowledge?: string[]; minitools?: string[] };
  context_independence?: { reads?: string[]; journal_read_policy?: string; rationale?: string };
  [k: string]: unknown;
}

/** 任务包携带的剖面投影（紧凑视图，宿主 spawn 子代理时用） */
export interface TaskProfile {
  id: string;
  role: string;
  title: string;
  mission?: string;
  skill?: string;
  knowledge?: string[];
  journalReadPolicy?: string;
}

export class ProfileRegistry {
  private byId = new Map<string, AgentProfile>();
  private bySkill = new Map<string, AgentProfile>();

  constructor(root: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath) {
    const dir = path.join(root, "agents");
    if (!fs.exists(dir)) return;
    for (const f of fs.readDir(dir).sort()) {
      if (!f.endsWith(".profile.json")) continue;
      try {
        const raw = JSON.parse(fs.readText(path.join(dir, f)));
        assertSchema("agent-profile", raw);
        const p = raw as AgentProfile;
        if (p.status && p.status !== "active") continue;
        this.byId.set(p.id, p);
        const binding = p.three_layer_binding ?? {};
        // 技能键归一：剖面里可能写 "skills/plot-redline.md"，flow 节点里是裸 id "plot-redline"
        const norm = (s: string) => s.replace(/^skills\//, "").replace(/\.md$/, "");
        for (const s of [binding.skill, ...(binding.skills ?? [])].map((x) => (x ? norm(x) : x))) {
          if (s) this.bySkill.set(s, p);
        }
      } catch {
        /* 坏剖面跳过，不炸注册表 */
      }
    }
  }

  all(): AgentProfile[] {
    return [...this.byId.values()];
  }

  /** 节点剖面解析：节点显式声明 > 技能反向匹配 > 角色族缺省（agent→screenwriter，gate/srd→red-reviewer）。 */
  resolve(flowNode: { profile?: string; skill?: string; kind?: string; gate_role?: string }): AgentProfile | undefined {
    if (flowNode.profile && this.byId.has(flowNode.profile)) return this.byId.get(flowNode.profile);
    if (flowNode.skill && this.bySkill.has(flowNode.skill)) return this.bySkill.get(flowNode.skill);
    if (flowNode.kind === "gate" || flowNode.kind === "srd") {
      const red = this.bySkill.get("plot-redline");
      if (red) return red;
    }
    if (flowNode.kind === "agent") {
      return this.byId.get("scene-screenwriter") ?? this.byId.get("story-analyst");
    }
    return undefined;
  }

  /** 任务包用的紧凑投影。 */
  project(p: AgentProfile | undefined, skill?: string): TaskProfile | undefined {
    if (!p) return undefined;
    const ci = p.context_independence ?? {};
    return {
      id: p.id,
      role: p.role,
      title: p.title,
      ...(p.mission ? { mission: p.mission } : {}),
      ...(skill ?? p.three_layer_binding?.skill ? { skill: skill ?? p.three_layer_binding?.skill } : {}),
      ...(p.three_layer_binding?.knowledge ? { knowledge: p.three_layer_binding.knowledge } : {}),
      ...(ci.journal_read_policy ? { journalReadPolicy: ci.journal_read_policy } : {}),
    };
  }
}
