import { type Result } from "../../types.ts";
import { type JsonlStorageHeader } from "./types.ts";
export interface LegacyV3SessionHeader {
    type: "session";
    version: 3;
    id: string;
    timestamp: string;
    cwd: string;
    parentSession?: string;
}
export declare function isLegacyV3SessionHeader(value: unknown): value is LegacyV3SessionHeader;
export declare function isJsonlStorageHeader(value: unknown): value is JsonlStorageHeader;
export type JsonlParsedSessionHeader = {
    format: "v4";
    header: JsonlStorageHeader;
} | {
    format: "v3-legacy";
    header: LegacyV3SessionHeader;
};
export declare function parseJsonlSessionHeader(line: string): Result<JsonlParsedSessionHeader, Error>;
//# sourceMappingURL=codec.d.ts.map