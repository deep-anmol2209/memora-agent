import { AsyncLocalStorage } from "node:async_hooks";
import type { Span, Tracer } from "./tracer.js";

const spanContext = new AsyncLocalStorage<Span>();
const tracerContext = new AsyncLocalStorage<Tracer>();

export function getCurrentSpan(): Span | undefined {
    return spanContext.getStore();
}

export function getCurrentTracer(): Tracer | undefined {
    return tracerContext.getStore();
}

export function runWithSpan<T>(
    span: Span,
    tracer: Tracer,
    callback: () => T
): T {
    return tracerContext.run(
        tracer,
        () => spanContext.run(span, callback)
    );
}