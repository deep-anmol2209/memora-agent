export interface Logger {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Default logger: does nothing. Production libraries should never write to
 * stdout/stderr unless the consumer explicitly opts in.
 */
export const noopLogger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {}
};

/**
 * Convenience logger consumers can opt into for local development.
 */
export const consoleLogger: Logger = {
    debug: (message, meta) => console.debug(`[ai-sdk] ${message}`, meta ?? ""),
    info: (message, meta) => console.info(`[ai-sdk] ${message}`, meta ?? ""),
    warn: (message, meta) => console.warn(`[ai-sdk] ${message}`, meta ?? ""),
    error: (message, meta) => console.error(`[ai-sdk] ${message}`, meta ?? "")
};