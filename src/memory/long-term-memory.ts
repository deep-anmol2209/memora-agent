import { calculateKeywordScore, calculateMemoryScore } from "./memory-ranking.js";
import type { EmbeddingProvider, GraphStore, LongTermMemory, LongTermMemoryStore, MemoryContradictionDetector, MemoryGraphReference, MemoryOptions, MemoryRecord, MemorySearchOptions, MemorySimilarity, VectorStore } from "../agent/types.js";
import { InMemoryLongTermMemoryStore } from "./in-memory-memory-store.js";
import { noopLogger, type Logger } from "../logger.js";

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

   if(!this.config.graphStore){
    throw new Error("Graph store is not configured")
   }

   

    return this.config.graphStore.search(options);
}



async remember(record: MemoryRecord): Promise<void> {

    const contradictionStrategy =
        this.config.options?.contradictionStrategy ?? "replace";

    const threshold =
        this.config.options?.semanticSimilarityThreshold ?? 0.85;

    const normalizedContent =
        record.content.trim().toLowerCase();

    const existingMemories =
        await this.config.store?.getAll();

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

                const contradiction =
                    await this.config.contradictionDetector.isContradiction(
                        existing,
                        record
                    );

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

                        await this.config.store.delete(
                            existing.id
                        );

                        if (this.config.vectorStore) {
                            await this.config.vectorStore.delete(
                                existing.id
                            );
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

                await this.config.store.delete(
                    existing.id
                );

                if (this.config.vectorStore) {
                    await this.config.vectorStore.delete(
                        existing.id
                    );
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

            await this.config.store.delete(
                existing.id
            );
   if(this.config.graphStore){
    await this.config.graphStore.delete?.(existing.id)
   }
            if (this.config.vectorStore) {
                await this.config.vectorStore.delete(
                    existing.id
                );
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

    const score =
        await this.config.similarity.similarity(
            existing.content,
            record.content
        );

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

    await this.config.store?.set(record);


    if(this.config.graphStore){
        await this.config.graphStore.set(record)
    }
    // ----------------------------------
    // 5. Store embedding
    // ----------------------------------

    if (
        this.config.embedding &&
        this.config.vectorStore
    ) {

        const vector =
            await this.config.embedding.embed(
                record.content
            );

        await this.config.vectorStore.upsert({
            id: record.id,
            vector,

            ...(record.metadata !== undefined && {
                metadata: record.metadata
            })
        });
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

        const classification =
            await this.config.queryClassifier.classify(
                query
            );

        if (classification.metadata) {

            searchOptions = {
                ...options,

                metadata:
                    classification.metadata
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

        const graphResults =
            await this.config.graphStore.search(
                searchOptions.graph
            );

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

        const queryVector =
            await this.config.embedding.embed(query);

        const vectorSearchOptions = {
            limit: Math.max(limit * 5, 20),

            ...(searchOptions.userId !== undefined && {
                userId: searchOptions.userId
            }),

            ...(searchOptions.sessionId !== undefined && {
                sessionId: searchOptions.sessionId
            })
        };

        const vectorResults =
            await this.config.vectorStore.search(
                queryVector,
                vectorSearchOptions
            );


        for (const result of vectorResults) {

            const memory =
                await this.config.store?.get(result.id);

            if (!memory) {
                continue;
            }

            const existingCandidate =
                candidates.find(
                    candidate =>
                        candidate.memory.id === memory.id
                );

            if (existingCandidate) {

                // Vector result is more informative
                // than graph-only candidate.
                existingCandidate.semanticScore =
                    result.score;

            } else {

                candidates.push({
                    memory,
                    semanticScore: result.score
                });

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