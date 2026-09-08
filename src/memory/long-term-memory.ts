import { calculateKeywordScore, calculateMemoryScore } from "./memory-ranking.js";
import type { EmbeddingProvider, GraphStore, LongTermMemory, LongTermMemoryStore, MemoryContradictionDetector, MemoryGraphReference, MemoryOptions, MemoryRecord, MemorySearchOptions, MemorySimilarity, VectorStore } from "../agent/types.js";
import { InMemoryLongTermMemoryStore } from "./in-memory-memory-store.js";
import { noopLogger, type Logger } from "../logger.js";
import { getCurrentTracer } from "../tracing/context.js";
import type { MemoryQueryClassifier } from "../memory/memory-query-classifier.js";


export interface InMemoryLongTermMemoryOptions{
    store?: LongTermMemoryStore,
    options?: MemoryOptions,
    embedding?: EmbeddingProvider,
    vectorStore?: VectorStore,
    similarity?: MemorySimilarity
    contradictionDetector?: MemoryContradictionDetector;
    graphStore?: GraphStore,
    queryClassifier?: MemoryQueryClassifier 
}
export class InMemoryLongTermMemory implements LongTermMemory{
      private logger: Logger
      private config: InMemoryLongTermMemoryOptions & {
    store: LongTermMemoryStore;
};

constructor(
    config: InMemoryLongTermMemoryOptions = {},
    logger?: Logger
) {
    this.config = {
        ...config,
        store:
            config.store ??
            new InMemoryLongTermMemoryStore()
    };

    this.logger = logger ?? noopLogger;
}

async graphSearch(
    options: MemoryGraphReference
): Promise<MemoryRecord[]> {

    if (!this.config.graphStore) {
        throw new Error("Graph store is not configured");
    }

    const tracer = getCurrentTracer();
    const graphSpan = tracer?.startSpan("graph.search");

    try {
        return await this.config.graphStore.search(options);
    } catch (error) {
        graphSpan?.recordError(error);
        throw error;
    } finally {
        graphSpan?.end();
    }
}


async remember(record: MemoryRecord): Promise<void> {

    const contradictionStrategy =
        this.config.options?.contradictionStrategy ?? "replace";

    const threshold =
        this.config.options?.semanticSimilarityThreshold ?? 0.85;

    const normalizedContent =
        record.content.trim().toLowerCase();

    const rememberTracer = getCurrentTracer();
    let existingMemories: MemoryRecord[] = [];

    // Prefer targeted store queries when we have a key or structured metadata
    // to avoid full collection scans. Fall back to getAll() when provider
    // doesn't support targeted search.
    const storeHasSearchByMetadata =
        typeof (this.config.store as any)?.searchByMetadata === "function";

    if (record.key || record.metadata?.type || storeHasSearchByMetadata) {
        const searchSpan = rememberTracer?.startSpan("memory.store.searchByMetadata");

        try {
            if (storeHasSearchByMetadata) {
                const metadataQuery = {
                    ...(record.metadata?.type !== undefined && { type: record.metadata?.type }),
                    ...(record.key !== undefined && { key: record.key })
                };

                existingMemories =
                    (await (this.config.store as any).searchByMetadata(
                        metadataQuery,
                        {
                            userId: record.metadata?.userId,
                            sessionId: record.metadata?.sessionId,
                            limit: 50
                        }
                    )) ?? [];
            } else {
                existingMemories = (await this.config.store?.getAll()) ?? [];
            }
        } catch (error) {
            searchSpan?.recordError(error);
            throw error;
        } finally {
            searchSpan?.end();
        }
    } else {
        const getAllSpan = rememberTracer?.startSpan("memory.store.getAll");

        try {
            existingMemories =
                (await this.config.store?.getAll()) ?? [];
        } catch (error) {
            getAllSpan?.recordError(error);
            throw error;
        } finally {
            getAllSpan?.end();
        }
    }

    for (const existing of existingMemories) {

        // ----------------------------------
        // 1. Exact duplicate
        // ----------------------------------

        if (
            existing.content.trim().toLowerCase() ===
            normalizedContent
        ) {
            this.logger.debug("Dedup: exact duplicate", { content: normalizedContent });
            return;
        }


        // ----------------------------------
        // 2. Same user + same key
        // ----------------------------------
        // A "replace" memory represents the
        // current value of that key.
        //
        // Example:
        // preferred-programming-language
        //
        // Rust -> TypeScript
        //
        // Old value must be replaced.
        // ----------------------------------

        const sameUser =
            existing.metadata?.userId ===
            record.metadata?.userId;

        const sameKey =
            Boolean(
                existing.key &&
                record.key &&
                existing.key === record.key
            );

        if (
            sameUser &&
            sameKey &&
            record.strategy === "replace"
        ) {

            // ----------------------------------
            // 2a. Check contradiction if detector
            //     is configured
            // ----------------------------------

            if (this.config.contradictionDetector) {

                this.logger.debug("Contradiction candidate", {
                    existing: existing.content,
                    incoming: record.content,
                    key: record.key
                });

                const contradictionSpan = rememberTracer?.startSpan("memory.contradiction-check");
                let contradiction = false;

                try {
                    contradiction =
                        await this.config.contradictionDetector.isContradiction(
                            existing,
                            record
                        );
                } catch (error) {
                    contradictionSpan?.recordError(error);
                    throw error;
                } finally {
                    contradictionSpan?.end();
                }

                this.logger.debug("Contradiction result", { contradiction });

                // ----------------------------------
                // Contradiction
                // ----------------------------------

                if (contradiction) {

                    if (
                        contradictionStrategy ===
                        "reject"
                    ) {
                        this.logger.debug("Contradiction: rejected", {
                            existing: existing.content,
                            incoming: record.content
                        });

                        return;
                    }

                    if (
                        contradictionStrategy ===
                        "replace"
                    ) {
                        this.logger.debug("Contradiction: replace", {
                            from: existing.content,
                            to: record.content
                        });

                        const deleteSpan = rememberTracer?.startSpan("memory.store.delete");

                        try {
                            await this.config.store.delete(
                                existing.id
                            );
                        } catch (error) {
                            deleteSpan?.recordError(error);
                            throw error;
                        } finally {
                            deleteSpan?.end();
                        }

                        if (this.config.vectorStore) {
                            const vectorDeleteSpan = rememberTracer?.startSpan("vector.delete");

                            try {
                                await this.config.vectorStore.delete(
                                    existing.id
                                );
                            } catch (error) {
                                vectorDeleteSpan?.recordError(error);
                                throw error;
                            } finally {
                                vectorDeleteSpan?.end();
                            }
                        }

                        continue;
                    }

                    if (
                        contradictionStrategy ===
                        "keep-both"
                    ) {
                        this.logger.debug("Contradiction: keep both", {
                            existing: existing.content,
                            incoming: record.content
                        });

                        continue;
                    }
                }

                // ----------------------------------
                // Not contradictory
                // ----------------------------------
                //
                // Same key still means this is
                // the new current value.
                //
                // Example:
                // "User likes TypeScript"
                // ->
                // "User prefers TypeScript"
                //
                // These aren't contradictory,
                // but we still don't want two
                // values for the same replace key.
                // ----------------------------------

                this.logger.debug("Replace: same key", {
                    from: existing.content,
                    to: record.content
                });

                const deleteSpan = rememberTracer?.startSpan("memory.store.delete");

                try {
                    await this.config.store.delete(
                        existing.id
                    );
                } catch (error) {
                    deleteSpan?.recordError(error);
                    throw error;
                } finally {
                    deleteSpan?.end();
                }

                if (this.config.vectorStore) {
                    const vectorDeleteSpan = rememberTracer?.startSpan("vector.delete");

                    try {
                        await this.config.vectorStore.delete(
                            existing.id
                        );
                    } catch (error) {
                        vectorDeleteSpan?.recordError(error);
                        throw error;
                    } finally {
                        vectorDeleteSpan?.end();
                    }
                }

                continue;
            }

            // ----------------------------------
            // No contradiction detector
            // ----------------------------------
            //
            // Replace directly based on key.
            // ----------------------------------

            this.logger.debug("Replace: same key", {
                from: existing.content,
                to: record.content
            });

            const deleteSpan = rememberTracer?.startSpan("memory.store.delete");

            try {
                await this.config.store.delete(
                    existing.id
                );
            } catch (error) {
                deleteSpan?.recordError(error);
                throw error;
            } finally {
                deleteSpan?.end();
            }
   if(this.config.graphStore){
    const graphDeleteSpan = rememberTracer?.startSpan("graph.store.delete");

    try {
        await this.config.graphStore.delete?.(existing.id)
    } catch (error) {
        graphDeleteSpan?.recordError(error);
        throw error;
    } finally {
        graphDeleteSpan?.end();
    }
   }
            if (this.config.vectorStore) {
                const vectorDeleteSpan = rememberTracer?.startSpan("vector.delete");

                try {
                    await this.config.vectorStore.delete(
                        existing.id
                    );
                } catch (error) {
                    vectorDeleteSpan?.recordError(error);
                    throw error;
                } finally {
                    vectorDeleteSpan?.end();
                }
            }

            continue;
        }


        // ----------------------------------
        // 3. Semantic duplicate
        // ----------------------------------

       // ----------------------------------
// 3. Semantic duplicate
// ----------------------------------

// Semantic deduplication must be scoped
// to the same user.
//
// Otherwise:
// User A: "User prefers TypeScript"
// User B: "User prefers TypeScript"
//
// could incorrectly be treated as a duplicate.

if (
    this.config.similarity &&
    sameUser
) {

    const similaritySpan = rememberTracer?.startSpan("memory.similarity");
    let score = 0;

    try {
        score =
            await this.config.similarity.similarity(
                existing.content,
                record.content
            );
    } catch (error) {
        similaritySpan?.recordError(error);
        throw error;
    } finally {
        similaritySpan?.end();
    }

    this.logger.debug("Dedup check", {
        existing: existing.content,
        incoming: record.content,
        score,
        threshold
    });

    if (score >= threshold) {

        this.logger.debug(
            "Dedup: rejected",
            {
                score,
                threshold
            }
        );

        return;
    }

    this.logger.debug(
        "Dedup: accepted",
        {
            score,
            threshold
        }
    );
}
    }


    // ----------------------------------
    // 4. Store new memory
    // ----------------------------------

    const storeSpan = rememberTracer?.startSpan("memory.store.set");

    try {
        await this.config.store?.set(record);
    } catch (error) {
        storeSpan?.recordError(error);
        throw error;
    } finally {
        storeSpan?.end();
    }

    if(this.config.graphStore){
        const graphSpan = rememberTracer?.startSpan("graph.store.set");

        try {
            await this.config.graphStore.set(record)
        } catch (error) {
            graphSpan?.recordError(error);
            throw error;
        } finally {
            graphSpan?.end();
        }
    }
    // ----------------------------------
    // 5. Store embedding
    // ----------------------------------

    if (
        this.config.embedding &&
        this.config.vectorStore
    ) {
         const embeddingSpan= rememberTracer?.startSpan("memory.embedding");

         try {
            const vector =
            await this.config.embedding.embed(
                record.content
            );

            const vectorSpan = rememberTracer?.startSpan("vector.upsert");

            try {
                await this.config.vectorStore.upsert({
                    id: record.id,
                    vector,

                    ...(record.metadata !== undefined && {
                        metadata: record.metadata
                    })
                });
            } catch (error) {
                vectorSpan?.recordError(error);
                throw error;
            } finally {
                vectorSpan?.end();
            }
         } catch (error) {
            embeddingSpan?.recordError(error);
            throw error;
         }finally{
            embeddingSpan?.end();
         }
        
    }
}

async rebuildVectorIndex(): Promise<void> {

    if (!this.config.embedding || !this.config.vectorStore) {
        return;
    }

    const memories =
        await this.config.store?.getAll();

    for (const memory of memories) {

        const vector =
            await this.config.embedding.embed(
                memory.content
            );

        await this.config.vectorStore.upsert({
            id: memory.id,
            vector,

            ...(memory.metadata !== undefined && {
                metadata: memory.metadata
            })
        });
    }
}

async search(
    query: string,
    options: MemorySearchOptions = {}
): Promise<MemoryRecord[]> {


    let searchOptions = options;

    if (
        !searchOptions.metadata &&
        this.config.queryClassifier
    ) {

    const tracer = getCurrentTracer();
const classifierSpan =
    tracer?.startSpan("query.classify");

let classification;

try {
    classification =
        await this.config.queryClassifier.classify(
            query
        );
    
        
} catch (error) {
    classifierSpan?.recordError(error);
    throw error;
} finally {
    classifierSpan?.end();
}
    if (classification.intent === "write") {
    return [];
}

if (
    classification.intent === "read" &&
    classification.metadata &&
    this.config.store
) {
    const searchSpan = tracer?.startSpan("memory.store.searchByMetadata");

    try {
        const storeOptions: Record<string, unknown> = {
            limit: options.limit ?? 10
        };

        if (options.userId !== undefined) {
            storeOptions.userId = options.userId;
        }

        if (options.sessionId !== undefined) {
            storeOptions.sessionId = options.sessionId;
        }

       
        const metadataResults = await this.config.store.searchByMetadata(
            classification.metadata,
            storeOptions as any
        );
        if (metadataResults && metadataResults.length > 0) {
            return metadataResults;
        }
    } catch (error) {
        searchSpan?.recordError(error);
        throw error;
    } finally {
        searchSpan?.end();
    }
}

if (classification.metadata) {
    searchOptions = {
        ...options,
        metadata: classification.metadata
    };
}
    }

    const limit =
        searchOptions.limit ?? 10;
   
    const keywordWeight =
        searchOptions.keywordWeight ?? 0.3;

    const semanticWeight =
        searchOptions.semanticWeight ?? 0.7;
         
    const metadataWeight= searchOptions.metadataWeight ?? 0.2;

    const calculateMetadataScore = (
    memory: MemoryRecord
): number => {

    const metadata = searchOptions.metadata;

    if (!metadata) {
        return 0;
    }

    let total = 0;
    let matched = 0;

    if (metadata.type !== undefined) {

        total++;

        if (
            memory.metadata?.type ===
            metadata.type
        ) {
            matched++;
        }
    }

    if (metadata.key !== undefined) {

        total++;

        if (
            memory.key ===
            metadata.key
        ) {
            matched++;
        }
    }

    for (const [key, value] of Object.entries(metadata)) {

        if (
            key === "type" ||
            key === "key" ||
            value === undefined
        ) {
            continue;
        }

        total++;

        if (
            memory.metadata?.[key] === value
        ) {
            matched++;
        }
    }

    if (total === 0) {
        return 0;
    }

    return matched / total;
};

    let candidates: {
        memory: MemoryRecord;
        semanticScore: number;
    }[] = [];


    // ----------------------------------
    // GraphStore retrieval
    // ----------------------------------

     
     
    if (this.config.graphStore && searchOptions.graph) {
        const tracer = getCurrentTracer();
        const graphSpan= tracer?.startSpan("graph.search")

        let graphResults;
        try {
             graphResults =
            await this.config.graphStore.search(
                searchOptions.graph
            );
        } catch (error) {
            graphSpan?.recordError(error);
            throw error;
        }finally{
            graphSpan?.end();
        }
      

        for (const memory of graphResults) {

            const alreadyExists =
                candidates.some(
                    candidate =>
                        candidate.memory.id === memory.id
                );

            if (!alreadyExists) {

                candidates.push({
                    memory,
                    semanticScore: 0
                });

            }
        }
    }


    // ----------------------------------
    // VectorStore retrieval
    // ----------------------------------

    if (this.config.embedding && this.config.vectorStore) {
        const tracer= getCurrentTracer();
        const embeddingSpan= tracer?.startSpan("memory.embedding");
               let queryVector: number[];
        try {
             queryVector =
            await this.config.embedding.embed(query);
        } catch (error) {
            embeddingSpan?.recordError(error);
            throw error;
        }finally{
            embeddingSpan?.end();
        }
       

        const multiplier = searchOptions.vectorTopKMultiplier ?? 2;
        const vectorSearchOptions = {
            // Multiplier is configurable per-search via `vectorTopKMultiplier`.
            limit: Math.max(limit * multiplier, 20),

            ...(searchOptions.userId !== undefined && {
                userId: searchOptions.userId
            }),

            ...(searchOptions.sessionId !== undefined && {
                sessionId: searchOptions.sessionId
            })
        };

        
      const vectorSpan= tracer?.startSpan("vector.search")
      let vectorResults;

      try {
           vectorResults =
            await this.config.vectorStore.search(
                queryVector,
                vectorSearchOptions
            );

            vectorSpan?.setAttribute("vector.topK", vectorSearchOptions.limit);
            vectorSpan?.setAttribute("vector.resultCount", vectorResults.length)
      } catch (error) {
             vectorSpan?.recordError(error);
             throw error
      }finally{
        vectorSpan?.end()
      }
     


    // Batch-fetch memories for vector results to avoid N+1 store.get calls.
    const ids = vectorResults.map(r => r.id);
    const storeHasGetMany = typeof (this.config.store as any)?.getMany === "function";

    let memoryResults: { memory: MemoryRecord | undefined; score: number }[] = [];

    if (storeHasGetMany) {
        const getManySpan = tracer?.startSpan("memory.store.getMany");
        try {
            const records: MemoryRecord[] = await (this.config.store as any).getMany(ids);
            const byId: Record<string, MemoryRecord> = {};
            for (const r of records) {
                byId[r.id] = r;
            }

            memoryResults = vectorResults.map(result => ({
                memory: byId[result.id],
                score: result.score
            }));
        } catch (error) {
            getManySpan?.recordError(error);
            throw error;
        } finally {
            getManySpan?.end();
        }
    } else {
        memoryResults = await Promise.all(
            vectorResults.map(async (result) => {
                const storeTracer = getCurrentTracer();
                const storeSpan = storeTracer?.startSpan("memory.store.get");

                try {
                    const memory = await this.config.store?.get(result.id);
                    return { memory, score: result.score };
                } catch (error) {
                    storeSpan?.recordError(error);
                    throw error;
                } finally {
                    storeSpan?.end();
                }
            })
        );
    }

    for (const result of memoryResults) {
        const memory = result.memory;

        if (!memory) {
            continue;
        }

        const existingCandidate = candidates.find(
            candidate => candidate.memory.id === memory.id
        );

        if (existingCandidate) {
            existingCandidate.semanticScore = result.score;
        } else {
            candidates.push({ memory, semanticScore: result.score });
        }
    }


    } else {

        // ----------------------------------
        // Fallback: MemorySimilarity
        // ----------------------------------

        const fallbackCandidates =
            Array.from(await this.config.store.getAll())
                .filter(memory => {

                    if (
                        searchOptions.userId &&
                        memory.metadata?.userId !==
                            searchOptions.userId
                    ) {
                        return false;
                    }

                    if (
                        searchOptions.sessionId &&
                        memory.metadata?.sessionId !==
                            searchOptions.sessionId
                    ) {
                        return false;
                    }

                    return true;
                });


        if (this.config.similarity) {

            for (const memory of fallbackCandidates) {

                const score =
                    await this.config.similarity?.similarity(
                        query,
                        memory.content
                    );

                const existingCandidate =
                    candidates.find(
                        candidate =>
                            candidate.memory.id === memory.id
                    );

                if (existingCandidate) {

                    existingCandidate.semanticScore =
                        score;

                } else {

                    candidates.push({
                        memory,
                        semanticScore: score
                    });

                }
            }

        } else {

            for (const memory of fallbackCandidates) {

                const alreadyExists =
                    candidates.some(
                        candidate =>
                            candidate.memory.id === memory.id
                    );

                if (!alreadyExists) {

                    candidates.push({
                        memory,
                        semanticScore: 0
                    });

                }
            }
        }
    }
const metadataMatches = (
    memory: MemoryRecord
): boolean => {

    const metadata = searchOptions.metadata;

    if (!metadata) {
        return true;
    }

    if (
        metadata.type !== undefined &&
        memory.metadata?.type !== metadata.type
    ) {
        return false;
    }

    if (
        metadata.key !== undefined &&
        memory.key !== metadata.key
    ) {
        return false;
    }

    for (const [key, value] of Object.entries(metadata)) {

        if (
            key === "type" ||
            key === "key" ||
            value === undefined
        ) {
            continue;
        }

        if (
            memory.metadata?.[key] !== value
        ) {
            return false;
        }
    }

    return true;
};
const candidateMatches = (
    memory: MemoryRecord
): boolean => {

    if (
        searchOptions.userId &&
        memory.metadata?.userId !==
            searchOptions.userId
    ) {
        return false;
    }

    if (
        searchOptions.sessionId &&
        memory.metadata?.sessionId !==
            searchOptions.sessionId
    ) {
        return false;
    }

    return metadataMatches(memory);
};
    // ----------------------------------
    // Hybrid ranking
    // ----------------------------------

    const scored = [];

    for (const candidate of candidates) {
        // console.log("CANDIDATE: ", candidate.memory.content,"METADATA: ", candidate.memory.metadata, "KEY: ", candidate.memory.key, "MATCH: ", candidateMatches(candidate.memory),"EXPECTED", searchOptions.metadata );

        

        if(!candidateMatches(candidate.memory)){
            continue;
        }

        const keywordScore =
            calculateKeywordScore(
                query,
                candidate.memory.content
            );

            const metadataScore= calculateMetadataScore(candidate.memory)

        const finalScore =
            calculateMemoryScore(
                keywordScore,
                candidate.semanticScore,
                metadataScore,
                keywordWeight,
                semanticWeight,
                metadataWeight
            );

        scored.push({
            memory: candidate.memory,
            keywordScore,
            semanticScore: candidate.semanticScore,
            metadataScore,
            finalScore
        });
    }


    scored.sort(
        (a, b) =>
            b.finalScore - a.finalScore
    );


    return scored
        .slice(0, limit)
        .map(item => item.memory);
}

        async  forget(id: string): Promise<void> {
           await this.config.store?.delete(id);

            if(this.config.vectorStore){
                await this.config.vectorStore.delete(id);
            }
        }

        async clear(): Promise<void>{
          await  this.config.store?.clear();

            if(this.config.vectorStore){
                await this.config.vectorStore.clear();
            }
        }
    
}