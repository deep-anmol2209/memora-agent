

import type {
    MemoryManagerConfig,
    MemoryRecord,
    MemorySearchOptions,
    Message,
    MemoryContext
} from "../agent/types.js";
import { getCurrentTracer, runWithSpan } from "../tracing/context.js";
import { DefaultMemoryQueryClassifier, type MemoryQueryClassifier } from "./memory-query-classifier.js";
import { noopLogger, type Logger } from "../logger.js";

export class MemoryManager {
    private queryClassifier: MemoryQueryClassifier;
    private logger: Logger;

    constructor(
        private config: MemoryManagerConfig = {}
    ) {
        this.queryClassifier = config.queryClassifier ?? new DefaultMemoryQueryClassifier();
        this.logger = config.logger ?? noopLogger;
    }

    get shortTerm() {
        return this.config.shortTerm;
    }

    get longTerm() {
        return this.config.longTerm;
    }

    get extractor() {
        return this.config.extractor;
    }

    get graph(){
        return this.config.graph;
    }

    async extractAndRemember(
        messages: Message[],
        context: MemoryContext
    ): Promise<void> {
    //    console.log("Extractor input:");
    //    console.dir(messages, {depth: null})
       
        if (
            !this.config.extractor ||
            !this.config.longTerm
        ) {
            return;
        }

        const triggeringMessage = messages.find(
            (message): message is Message & { role: "user" } => message.role === "user"
        );

        if (triggeringMessage) {
            const classification = await this.queryClassifier.classify(triggeringMessage.content);
     
           
            // Only skip when the classifier CONFIDENTLY recognized this as a
            // known read-only lookup pattern (e.g. "what is my name") — the
            // unclassified fallback (`intent: "read"`, no `confidence`) means
            // "I don't recognize this phrasing", not "nothing to remember",
            // so it must still go through the real extractor. Any `write`
            // intent or bare metadata hint (e.g. a negated preference, a
            // project/goal mention) is left to the extractor too.
            if (classification.intent === "read" && classification.confidence !== undefined) {
                this.logger.debug(
                    "Skipped memory extraction: query classified as a pure lookup",
                    { query: triggeringMessage.content, metadata: classification.metadata }
                );
                return;
            }
        }

        const tracer = getCurrentTracer();
        const extractSpan = tracer?.startSpan("memory.extract");
        let memories: MemoryRecord[] = [];

        try {
            memories = await this.config.extractor.extract(messages);
            extractSpan?.setAttribute("memory.count", memories.length);
        } catch (error) {
            extractSpan?.recordError(error);
            throw error;
        } finally {
            extractSpan?.end();
        }

       for (const memory of memories) {
    const rememberSpan =
        tracer?.startSpan("memory.remember");

    try {
        if (rememberSpan && tracer) {
            await runWithSpan(
                rememberSpan,
                tracer,
                async () => {
                    await this.config.longTerm!.remember({
                        ...memory,
                        metadata: {
                            ...memory.metadata,

                            ...(context.userId !== undefined && {
                                userId: context.userId
                            }),

                            ...(context.sessionId !== undefined && {
                                sessionId: context.sessionId
                            })
                        },

                        ...(context.userId !== undefined && {
                            graph: [
                                {
                                    entityType: "User",
                                    entityId: context.userId,
                                    relation: "HAS_MEMORY"
                                }
                            ]
                        }),
                    });
                }
            );
        } else {
            await this.config.longTerm.remember({
                ...memory,
                metadata: {
                    ...memory.metadata,

                    ...(context.userId !== undefined && {
                        userId: context.userId
                    }),

                    ...(context.sessionId !== undefined && {
                        sessionId: context.sessionId
                    })
                },

                ...(context.userId !== undefined && {
                    graph: [
                        {
                            entityType: "User",
                            entityId: context.userId,
                            relation: "HAS_MEMORY"
                        }
                    ]
                }),
            });
        }
    } catch (error) {
        rememberSpan?.recordError(error);
        throw error;
    } finally {
        rememberSpan?.end();
    }
}
    }

    async remember(
    record: MemoryRecord
): Promise<void> {

    if (!this.config.longTerm) {
        throw new Error(
            "Long-term memory is not configured"
        );
    }

    await this.config.longTerm.remember(record);
}

async search(
    query: string,
    options?: MemorySearchOptions
): Promise<MemoryRecord[]> {

    if (!this.config.longTerm) {
        return [];
    }

    return this.config.longTerm.search(
        query,
        options
    );
}

async forget(
    id: string
): Promise<void> {

    if (!this.config.longTerm) {
        return;
    }

    await this.config.longTerm.forget(id);
}

async clearLongTerm(): Promise<void> {

    if (!this.config.longTerm) {
        return;
    }

    await this.config.longTerm.clear();
}
}