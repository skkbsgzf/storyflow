export class ServiceException extends Error {
    $fault;
    $response;
    $retryable;
    $metadata;
    constructor(options) {
        super(options.message);
        Object.setPrototypeOf(this, Object.getPrototypeOf(this).constructor.prototype);
        this.name = options.name;
        this.$fault = options.$fault;
        this.$metadata = options.$metadata;
    }
    static isInstance(value) {
        if (!value)
            return false;
        const candidate = value;
        return (ServiceException.prototype.isPrototypeOf(candidate) ||
            (Boolean(candidate.$fault) &&
                Boolean(candidate.$metadata) &&
                (candidate.$fault === "client" || candidate.$fault === "server")));
    }
    static [Symbol.hasInstance](instance) {
        if (!instance)
            return false;
        const candidate = instance;
        if (this === ServiceException) {
            return ServiceException.isInstance(instance);
        }
        if (ServiceException.isInstance(instance)) {
            if (this.prototype.isPrototypeOf(instance)) {
                return true;
            }
            const targetName = this.name;
            if (!targetName || !candidate.name) {
                return false;
            }
            if (candidate.name === targetName) {
                return true;
            }
            let proto = Object.getPrototypeOf(candidate);
            while (proto && proto !== Object.prototype) {
                const ctorName = proto.constructor?.name;
                if (ctorName && ctorName !== "Error" && ctorName === targetName) {
                    return true;
                }
                proto = Object.getPrototypeOf(proto);
            }
            return false;
        }
        return false;
    }
}
export const decorateServiceException = (exception, additions = {}) => {
    Object.entries(additions)
        .filter(([, v]) => v !== undefined)
        .forEach(([k, v]) => {
        if (exception[k] == undefined || exception[k] === "") {
            exception[k] = v;
        }
    });
    const message = exception.message || exception.Message || "UnknownError";
    exception.message = message;
    delete exception.Message;
    return exception;
};
