import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { Entry, EntryKind, Id, JsonValue, SystemMessage, ToolControl } from "../types.ts";
export type UserEntry = Entry & {
    kind: "pi.user";
    model: [UserMessage];
    data?: {
        continuation: true;
        from: Id;
    };
};
export type AssistantEntry = Entry & {
    kind: "pi.assistant";
    model: [AssistantMessage];
    data: {
        attempt: number;
    };
};
export type ToolResultEntry = Entry & {
    kind: "pi.tool_result";
    model: [ToolResultMessage];
    data: {
        details?: JsonValue;
        diagnostics?: JsonValue;
        control?: ToolControl;
        truncated?: {
            bytes: number;
            lines: number;
        };
    };
};
export type SystemEntry = Entry & {
    kind: "pi.system";
    model: [SystemMessage];
    data: {
        baseline: boolean;
    };
};
export type NoticeEntry = Entry & {
    kind: "pi.notice";
    model: [UserMessage];
};
export type UsageEntry = Entry & {
    kind: "pi.usage";
    data: {
        attempt: number;
        usage?: AssistantMessage["usage"];
        error: string;
    };
};
export type SummaryEntry = Entry & {
    kind: "pi.summary";
    model: [UserMessage];
    data: {
        through: Id;
    };
    head: Id;
};
export type HandoffEntry = Entry & {
    kind: "pi.handoff";
    model: [UserMessage];
    head: Id;
};
export type ResetEntry = Entry & {
    kind: "pi.reset";
    head: Id;
};
export declare const entries: {
    readonly user: EntryKind<UserEntry>;
    readonly assistant: EntryKind<AssistantEntry>;
    readonly toolResult: EntryKind<ToolResultEntry>;
    readonly system: EntryKind<SystemEntry>;
    readonly notice: EntryKind<NoticeEntry>;
    readonly usage: EntryKind<UsageEntry>;
    readonly summary: EntryKind<SummaryEntry>;
    readonly handoff: EntryKind<HandoffEntry>;
    readonly reset: EntryKind<ResetEntry>;
};
//# sourceMappingURL=entries.d.ts.map