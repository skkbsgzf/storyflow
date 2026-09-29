import type { Context } from "../../context.ts";
import type { OperationError, OperationMeta, OperationResultRecord, OperationState, SessionReader, TerminalStatus, Write } from "../../session/types.ts";
/** Build the mechanical operation-owned suffix used by an owning procedure's terminal transaction. */
export declare function operationCleanupWrites(reader: SessionReader, operationId: string, state: OperationState, context: Context): Promise<Write[]>;
/** Construct the immutable observation record for one terminal decision. */
export declare function operationResultRecord(meta: OperationMeta, status: TerminalStatus, tipId: string | null, error?: OperationError): OperationResultRecord;
//# sourceMappingURL=terminal.d.ts.map