import { StorageDecorator } from "./storage-decorator.js";
/** Test-only transparent Storage decorator that records commit admission. */
export class InstrumentedStorage extends StorageDecorator {
    commitAttempts = [];
    getCommitAttempts() {
        return this.commitAttempts.slice();
    }
    clearCommitAttempts() {
        this.commitAttempts.length = 0;
    }
    commit(writes, context) {
        this.commitAttempts.push(writes);
        return this.delegate.commit(writes, context);
    }
}
//# sourceMappingURL=instrumented-storage.js.map