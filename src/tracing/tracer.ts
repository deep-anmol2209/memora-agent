import { randomUUID } from "node:crypto";
import { getCurrentSpan } from "./context.js";
export interface Span {
    readonly name: string;
    readonly traceId: string;
    readonly spanId: string;
    readonly parentSpanId: string | undefined;

    readonly startTime: number;
    readonly endTime: number | undefined;
    readonly duration: number | undefined;

    setAttribute(key: string, value: unknown): void;
    recordError(error: unknown): void;

    end(): void;
}

export interface Tracer {
    startSpan(name: string): Span;
}


export class NoopSpan implements Span {
    readonly name = "noop";
    readonly traceId = "";
    readonly spanId = "";
    readonly parentSpanId = undefined;

    readonly startTime = 0;
    readonly endTime = undefined;
    readonly duration = undefined;

    setAttribute(_key: string, _value: unknown): void {}

    recordError(_error: unknown): void {}

    end(): void {}
}

export class NoopTracer implements Tracer {
    startSpan(_name: string): Span {
        return new NoopSpan();
    }
}


export class BasicSpan implements Span {
    readonly spanId: string;
    readonly traceId: string; 
    readonly startTime: number;
    private _endTime?: number;
    private _duration?: number;
    readonly parentSpanId: string | undefined;
    private readonly attributes: Record<string, unknown> = {};
    private error: unknown;

constructor(
    readonly name: string,
    options?: {
        traceId?: string | undefined;
        parentSpanId?: string | undefined;
    }
) {
    this.spanId = randomUUID();
    this.traceId = options?.traceId ?? randomUUID();
    this.parentSpanId = options?.parentSpanId;
    this.startTime = Date.now();
}

    get endTime(): number | undefined {
        return this._endTime;
    }

    get duration(): number | undefined {
        return this._duration;
    }

    setAttribute(key: string, value: unknown): void {
        this.attributes[key] = value;
    }

    recordError(error: unknown): void {
        this.error = error;
    }

    end(): void {
        if (this._endTime !== undefined) {
            return;
        }

        this._endTime = Date.now();
        this._duration = this._endTime - this.startTime;

      
    }
}


export class BasicTracer implements Tracer {
    startSpan(name: string): Span {
        const parentSpan = getCurrentSpan();

        return new BasicSpan(
            name,{

           traceId: parentSpan?.traceId,
           parentSpanId: parentSpan?.spanId
            }
        );
    }
}