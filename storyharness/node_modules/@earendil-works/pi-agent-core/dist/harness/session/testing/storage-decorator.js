/** Test-only forwarding base for decorators that alter one part of Storage behavior. */
export class StorageDecorator {
    delegate;
    constructor(delegate) {
        this.delegate = delegate;
    }
    commit(writes, context) {
        return this.delegate.commit(writes, context);
    }
    getEntries(ids, context) {
        return this.delegate.getEntries(ids, context);
    }
    getValue(address, context) {
        return this.delegate.getValue(address, context);
    }
    scanValues(prefix, context) {
        return this.delegate.scanValues(prefix, context);
    }
    readList(address, options, context) {
        return this.delegate.readList(address, options, context);
    }
    scanBranch(query, context) {
        return this.delegate.scanBranch(query, context);
    }
    scanBranchStructure(query, context) {
        return this.delegate.scanBranchStructure(query, context);
    }
    scanEntries(query, context) {
        return this.delegate.scanEntries(query, context);
    }
    scanUsage(query, context) {
        return this.delegate.scanUsage(query, context);
    }
    getStats(context) {
        return this.delegate.getStats(context);
    }
    close(context) {
        return this.delegate.close(context);
    }
}
//# sourceMappingURL=storage-decorator.js.map