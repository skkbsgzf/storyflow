import type { AssistantMessage, AssistantMessageFrame } from "@earendil-works/pi-ai";
/**
 * Apply one encoded frame to the tracked output. Same switch as pi-ai's
 * reduceAssistantMessageFrames (the test oracle); no buffering, no second copy.
 */
export declare function applyFrame(o: {
    message?: AssistantMessage;
}, frame: AssistantMessageFrame): void;
//# sourceMappingURL=frames.d.ts.map