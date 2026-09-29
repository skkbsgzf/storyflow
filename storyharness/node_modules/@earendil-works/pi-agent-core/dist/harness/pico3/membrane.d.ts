/**
 * A transaction-scoped revocable membrane over a Chord-tracked document.
 *
 * Every object reached through a document proxy is wrapped lazily; all wrappers of one
 * transaction share one liveness flag; identity is preserved by a WeakMap. Mutations forward
 * to the underlying Chord proxy so its tracker records ops. At transaction finish — success,
 * callback failure, validation failure, storage failure — `revoke()` flips the flag and every
 * retained wrapper, root or nested, throws on any operation.
 *
 * Assigning one wrapper into another (`a.list = b.list`) is rejected: Chord stores the value it
 * is given, and a stored proxy is the classic footgun. Assign plain values; splice in place.
 */
export declare class Membrane {
    private alive;
    private readonly wrappers;
    private readonly isWrapper;
    private readonly what;
    constructor(what: string);
    revoke(): void;
    wrap<T extends object>(target: T): T;
    private assertPlainInput;
}
//# sourceMappingURL=membrane.d.ts.map