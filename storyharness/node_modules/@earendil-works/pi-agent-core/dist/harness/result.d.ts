export type Result<TValue, TError> = {
    ok: true;
    value: TValue;
} | {
    ok: false;
    error: TError;
};
export declare const Result: {
    ok<TValue>(value: TValue): Result<TValue, never>;
    err<TError>(error: TError): Result<never, TError>;
    isOk<TValue, TError>(result: Result<TValue, TError>): result is {
        ok: true;
        value: TValue;
    };
    isErr<TValue, TError>(result: Result<TValue, TError>): result is {
        ok: false;
        error: TError;
    };
};
export interface TaggedErrorValue<Tag extends string> extends Error {
    readonly _tag: Tag;
    toJSON(): {
        _tag: Tag;
        message: string;
    } & Record<string, unknown>;
}
export interface TaggedErrorFactory<Tag extends string> {
    new <Props extends {
        message: string;
    }>(props: Props): TaggedErrorValue<Tag> & Readonly<Props>;
    is(value: unknown): value is TaggedErrorValue<Tag>;
}
export declare function TaggedError<Tag extends string>(tag: Tag): TaggedErrorFactory<Tag>;
declare const LaneBusy_base: TaggedErrorFactory<"LaneBusy">;
export declare class LaneBusy extends LaneBusy_base<{
    lane: string;
    operationId: string;
    operationKind: "run" | "compaction" | "navigation";
    message: string;
}> {
}
declare const OperationMismatch_base: TaggedErrorFactory<"OperationMismatch">;
export declare class OperationMismatch extends OperationMismatch_base<{
    lane: string;
    expectedOperationId: string;
    currentOperationId?: string;
    lastOperationId?: string;
    message: string;
}> {
}
declare const NoActiveRun_base: TaggedErrorFactory<"NoActiveRun">;
export declare class NoActiveRun extends NoActiveRun_base<{
    lane: string;
    message: string;
}> {
}
declare const NoActiveOperation_base: TaggedErrorFactory<"NoActiveOperation">;
export declare class NoActiveOperation extends NoActiveOperation_base<{
    lane: string;
    message: string;
}> {
}
declare const NothingToResume_base: TaggedErrorFactory<"NothingToResume">;
export declare class NothingToResume extends NothingToResume_base<{
    lane: string;
    message: string;
}> {
}
declare const NothingToCompact_base: TaggedErrorFactory<"NothingToCompact">;
export declare class NothingToCompact extends NothingToCompact_base<{
    lane: string;
    message: string;
}> {
}
declare const InvalidMessage_base: TaggedErrorFactory<"InvalidMessage">;
export declare class InvalidMessage extends InvalidMessage_base<{
    lane: string;
    reason: string;
    message: string;
}> {
}
declare const InvalidNavigation_base: TaggedErrorFactory<"InvalidNavigation">;
export declare class InvalidNavigation extends InvalidNavigation_base<{
    lane: string;
    reason: string;
    message: string;
}> {
}
declare const UnknownSkill_base: TaggedErrorFactory<"UnknownSkill">;
export declare class UnknownSkill extends UnknownSkill_base<{
    name: string;
    message: string;
}> {
}
declare const UnknownTemplate_base: TaggedErrorFactory<"UnknownTemplate">;
export declare class UnknownTemplate extends UnknownTemplate_base<{
    name: string;
    message: string;
}> {
}
declare const UnknownTarget_base: TaggedErrorFactory<"UnknownTarget">;
export declare class UnknownTarget extends UnknownTarget_base<{
    targetId: string;
    message: string;
}> {
}
declare const InvalidLane_base: TaggedErrorFactory<"InvalidLane">;
export declare class InvalidLane extends InvalidLane_base<{
    lane: string;
    reason: string;
    message: string;
}> {
}
declare const Closed_base: TaggedErrorFactory<"Closed">;
export declare class Closed extends Closed_base<{
    message: string;
}> {
}
export declare class HarnessFault extends Error {
    readonly cause: unknown;
    constructor(message: string, cause: unknown);
}
export declare class HarnessClosed extends Error {
    constructor();
}
export type ErrorMatchers<TError extends TaggedErrorValue<string>, TValue> = {
    [Tag in TError["_tag"]]: (error: Extract<TError, {
        _tag: Tag;
    }>) => TValue;
};
export declare function matchError<TError extends TaggedErrorValue<string>, TValue>(error: TError, matchers: ErrorMatchers<TError, TValue>): TValue;
export {};
//# sourceMappingURL=result.d.ts.map