export class SdkError extends Error {
    constructor(message: string, public cause?: unknown) {
        super(message);
        this.name = "SdkError";
    }
}

export class ToolNotFoundError extends SdkError {
    constructor(public toolName: string) {
        super(`Tool "${toolName}" not found`);
        this.name = "ToolNotFoundError";
    }
}

export class ToolExecutionError extends SdkError {
    constructor(public toolName: string, cause: unknown) {
        super(
            `Tool "${toolName}" failed: ${
                cause instanceof Error ? cause.message : String(cause)
            }`,
            cause
        );
        this.name = "ToolExecutionError";
    }
}

export class ToolCallParseError extends SdkError {
    constructor(public toolName: string, public rawArguments: string, cause: unknown) {
        super(
            `Failed to parse arguments for tool "${toolName}": ${
                cause instanceof Error ? cause.message : String(cause)
            }`,
            cause
        );
        this.name = "ToolCallParseError";
    }
}

export class ModelGenerationError extends SdkError {
    constructor(public provider: string, cause: unknown) {
        super(
            `Model generation failed (${provider}): ${
                cause instanceof Error ? cause.message : String(cause)
            }`,
            cause
        );
        this.name = "ModelGenerationError";
    }
}

export class MemoryOperationError extends SdkError {
    constructor(public operation: string, cause: unknown) {
        super(
            `Memory operation "${operation}" failed: ${
                cause instanceof Error ? cause.message : String(cause)
            }`,
            cause
        );
        this.name = "MemoryOperationError";
    }
}

export class MaxToolIterationsExceededError extends SdkError {
    constructor(public maxIterations: number) {
        super(
            `Exceeded maximum tool-call iterations (${maxIterations}) in a single turn`
        );
        this.name = "MaxToolIterationsExceededError";
    }
}