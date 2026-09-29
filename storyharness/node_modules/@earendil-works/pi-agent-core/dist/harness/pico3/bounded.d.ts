/**
 * Bounded byte collector. It retains a prefix or suffix constrained by both a byte
 * budget and a newline budget, and accounts for every discarded byte/newline.
 */
export declare class Bounded {
    private bytes;
    private readonly maxBytes;
    private readonly maxLines;
    private readonly retain;
    droppedBytes: number;
    droppedLines: number;
    total: number;
    constructor(maxBytes: number, maxLines: number, retain: "head" | "tail");
    push(chunk: Uint8Array): void;
    private pushHead;
    private pushTail;
    private drop;
    get dropped(): number;
    text(): string;
}
//# sourceMappingURL=bounded.d.ts.map