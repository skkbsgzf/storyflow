/**
 * Apply one encoded frame to the tracked output. Same switch as pi-ai's
 * reduceAssistantMessageFrames (the test oracle); no buffering, no second copy.
 */
export function applyFrame(o, frame) {
    if (frame.type === "start") {
        o.message = frame.partial; // the encoder's clone
        return;
    }
    const m = o.message;
    if (m === undefined)
        throw new Error(`${frame.type} before start`);
    const c = m.content;
    switch (frame.type) {
        case "text_start":
            c[frame.contentIndex] = { ...frame.content };
            return;
        case "text_delta":
            c[frame.contentIndex].text += frame.delta;
            return;
        case "text_end": {
            const b = c[frame.contentIndex];
            b.text = frame.content;
            delete b.textSignature;
            if (frame.textSignature !== undefined)
                b.textSignature = frame.textSignature;
            return;
        }
        case "thinking_start":
            c[frame.contentIndex] = { ...frame.content };
            return;
        case "thinking_delta":
            c[frame.contentIndex].thinking += frame.delta;
            return;
        case "thinking_end": {
            const b = c[frame.contentIndex];
            b.thinking = frame.content;
            delete b.thinkingSignature;
            delete b.redacted;
            if (frame.thinkingSignature !== undefined)
                b.thinkingSignature = frame.thinkingSignature;
            if (frame.redacted !== undefined)
                b.redacted = frame.redacted;
            return;
        }
        case "toolcall_start":
            c[frame.contentIndex] = { ...frame.toolCall };
            return;
        case "toolcall_checkpoint":
            c[frame.contentIndex].arguments = safeParse(frame.json);
            return;
        case "toolcall_delta":
            return; // arguments materialise at checkpoint/end; deltas only feed the encoder's own json buffer
        case "toolcall_end": {
            const b = c[frame.contentIndex];
            b.id = frame.id;
            b.name = frame.name;
            b.arguments = frame.arguments;
            if (frame.thoughtSignature !== undefined)
                b.thoughtSignature = frame.thoughtSignature;
            if (frame.namespace !== undefined)
                b.namespace = frame.namespace;
            return;
        }
    }
}
function safeParse(json) {
    try {
        return JSON.parse(json);
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=frames.js.map