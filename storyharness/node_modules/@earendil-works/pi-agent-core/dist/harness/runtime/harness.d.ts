import type { Models, RetryPolicy } from "@earendil-works/pi-ai";
import type { QueueMode } from "../../types.ts";
import type { AcquireLaneOptions, AgentHarness, AgentHarnessOptions, AgentLane, LaneInfo, OpenOperation, Resources } from "../agent-harness.ts";
import { type CompactionSettings } from "../compaction/compaction.ts";
import type { Context } from "../context.ts";
import { HarnessEventBus } from "../events.ts";
import { HookRegistry } from "../hooks.ts";
import type { LaneConfiguration, Session } from "../session/types.ts";
import type { AgentHarnessStreamOptions, AgentHarnessTool } from "../types.ts";
import { Lane } from "./lane.ts";
import { type LaneState } from "./types.ts";
/** Runtime implementation of AgentHarness. The harness manages lanes but is not itself a lane. */
export declare class Harness<TContext extends object | undefined> implements AgentHarness<TContext> {
    readonly session: Session;
    readonly models: Models;
    readonly hooks: HookRegistry;
    readonly events: HarnessEventBus;
    readonly lanesByName: Map<string, Lane<TContext>>;
    private readonly seed;
    private readonly configStore;
    private closePromise;
    private closedError;
    private faultError;
    constructor(options: AgentHarnessOptions<TContext>, seed: LaneConfiguration, restored: Map<string, LaneState>);
    lane(name: string, context: Context): Promise<AgentLane>;
    lane(name: string, options: AcquireLaneOptions, context: Context): Promise<AgentLane>;
    lanes(context: Context): Promise<LaneInfo[]>;
    getName(context: Context): Promise<string | undefined>;
    setName(name: string | undefined, context: Context): Promise<void>;
    getLabel(targetId: string, context: Context): Promise<string | undefined>;
    setLabel(targetId: string, label: string | undefined, context: Context): Promise<void>;
    getTools(context: Context): Promise<AgentHarnessTool<TContext>[]>;
    setTools(tools: AgentHarnessTool<TContext>[], context: Context): Promise<void>;
    getResources(context: Context): Promise<Resources>;
    setResources(resources: Resources, context: Context): Promise<void>;
    getStreamOptions(context: Context): Promise<AgentHarnessStreamOptions>;
    setStreamOptions(options: AgentHarnessStreamOptions, context: Context): Promise<void>;
    getRetryPolicy(context: Context): Promise<RetryPolicy>;
    setRetryPolicy(policy: RetryPolicy, context: Context): Promise<void>;
    getCompactionSettings(context: Context): Promise<CompactionSettings>;
    setCompactionSettings(compaction: CompactionSettings, context: Context): Promise<void>;
    getSteeringMode(context: Context): Promise<QueueMode>;
    setSteeringMode(steeringMode: QueueMode, context: Context): Promise<void>;
    getFollowUpMode(context: Context): Promise<QueueMode>;
    setFollowUpMode(followUpMode: QueueMode, context: Context): Promise<void>;
    watchSession(_context: Context): Promise<never>;
    fault(cause: unknown, context: Context): Error;
    close(context: Context): Promise<void>;
    private buildLane;
    private getConfig;
    private setConfig;
    private assertOpen;
}
/** Attach runtime without starting provider, tool, hook, or timer effects. */
export declare function createAgentHarness<TContext extends object | undefined = object | undefined>(options: AgentHarnessOptions<TContext>, context: Context): Promise<{
    harness: AgentHarness<TContext>;
    open: OpenOperation[];
}>;
//# sourceMappingURL=harness.d.ts.map