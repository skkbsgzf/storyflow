import type { Context } from "@earendil-works/chord";
import type { AnyToolDeclaration, ContextEdit, CoreTx, Entry, HookInfo, HookResult, Id, JsonValue, RewindableState, Runtime, Stored, SystemMessage } from "./types.ts";
export interface SystemSection<T extends JsonValue = JsonValue> {
    readonly key: string;
    render(value: T): string;
}
export declare function defineSystemSection<T extends JsonValue>(definition: {
    key: string;
    render(value: T): string;
}): SystemSection<T>;
export type EnvironmentInfo = {
    cwd: string;
};
export type SkillInfo = {
    name: string;
    description: string;
};
export declare const systemSections: {
    readonly identity: SystemSection<string>;
    readonly environment: SystemSection<EnvironmentInfo>;
    readonly skills: SystemSection<SkillInfo[]>;
};
/** Section seed for a new conversation (§8.1): set with a checked pair, or remove an inherited key. */
export type SectionSeed = {
    key: string;
    value: JsonValue;
} | {
    key: string;
    remove: true;
};
export declare const sectionSeed: <T extends import("@earendil-works/chord").JsonValue>(section: SystemSection<T>, value: T) => SectionSeed;
export declare const removeSection: (key: string) => SectionSeed;
export type SectionRecord = {
    key: string;
    action: "set";
    value: JsonValue;
    rendered: string;
} | {
    key: string;
    action: "remove";
};
export type SystemEntryData = {
    baseline?: true;
    sections: SectionRecord[];
};
/** A metadata-only delta has `model: []`. */
export type SystemEntry = Entry & {
    kind: "pi.system";
    model: [] | [Stored<SystemMessage>];
    data: SystemEntryData;
};
type SectionState = {
    value: JsonValue;
    rendered: string;
};
export type Canonical = Map<string, SectionState>;
export declare function foldCanonical(reads: Pick<CoreTx, "scanEntries">, conversationId: Id): Promise<{
    canonical: Canonical;
    newestManaged: Id | null;
    newestBaseline: Id | null;
}>;
export interface SystemSectionDraft {
    get<T extends JsonValue>(section: SystemSection<T>): T | undefined;
    set<T extends JsonValue>(section: SystemSection<T>, value: T): void;
    delete(section: {
        key: string;
    }): void;
    wrap<T extends JsonValue>(section: SystemSection<T>, transform: (rendered: string) => string): void;
}
export interface SectionRegistry {
    readonly map: ReadonlyMap<string, SystemSection>;
    readonly revision: number;
}
export interface ToolRegistry {
    readonly map: ReadonlyMap<string, AnyToolDeclaration>;
    readonly revision: number;
}
/** Snapshot S. Compared field by field before the `prepared` commit. */
export interface PreparationSnapshot {
    newestManaged: Id | null;
    newestBaseline: Id | null;
    newestHead: Id | null;
    settings: {
        model?: JsonValue;
        thinkingLevel: JsonValue;
        selectedTools: string[];
        profile: JsonValue;
    };
    sectionsRev: number;
    toolsRev: number;
}
export declare const sameSnapshot: (a: PreparationSnapshot, b: PreparationSnapshot) => boolean;
export declare function takeSnapshot(tx: Pick<CoreTx, "scanEntries" | "newestEntry" | "snapshot" | "conversation">, conversationId: Id, sections: SectionRegistry, tools: ToolRegistry): Promise<{
    snapshot: PreparationSnapshot;
    canonical: Canonical;
    seed: readonly SectionSeed[] | undefined;
}>;
export interface SystemInstructionsHooks {
    /** Edit the draft; optionally override the tool loadout (last override wins). A throwing handler's edits are rolled back. */
    systemInstructions(input: {
        sections: SystemSectionDraft;
        config: PreparationSnapshot["settings"];
        tools: readonly AnyToolDeclaration[];
    }, info: HookInfo, ctx: Context): HookResult<{
        tools?: readonly AnyToolDeclaration[];
    }>;
}
/** Off the line: seed the draft, run handlers, freeze. */
export declare function prepareDraft(rt: Pick<Runtime<SystemInstructionsHooks>, "hooks" | "tools">, sections: SectionRegistry, canonical: Canonical, seed: readonly SectionSeed[] | undefined, settings: PreparationSnapshot["settings"], onReport: (m: string) => void, ctx: Context): Promise<{
    desired: Canonical;
    tools: readonly AnyToolDeclaration[];
}>;
/** On the line, in the `prepared` commit: diff desired against canonical; baseline if a head intervened. */
export declare function planManagedEntry(tx: Pick<CoreTx, "context">, conversationId: Id, snapshot: PreparationSnapshot, canonical: Canonical, desired: Canonical, tools: readonly AnyToolDeclaration[], now: number): Promise<{
    data: SystemEntryData;
    model: [] | [Stored<SystemMessage>];
    edits?: ContextEdit[];
} | undefined>;
/** Tools effective in a projected request: fold toolsAdded/toolsRemoved across its SystemMessages. */
export declare function effectiveTools(messages: readonly {
    role: string;
}[]): {
    name: string;
}[];
export type { RewindableState, Runtime };
//# sourceMappingURL=system.d.ts.map