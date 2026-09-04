import type {
    VectorRecord,
    VectorSearchOptions,
    VectorSearchResult,
    VectorStore
} from "../agent/types.js";
import { cosineSimilarity } from "../utils/cosine-similarity.js";

export class InMemoryVectorStore implements VectorStore {

    private records = new Map<string, VectorRecord>();

    async upsert(record: VectorRecord): Promise<void> {
        this.records.set(record.id, record);
    }

   async search(
    vector: number[],
    options: VectorSearchOptions
): Promise<VectorSearchResult[]> {

    const results: VectorSearchResult[] = [];

    for (const record of this.records.values()) {

        if (
            options.userId &&
            record.metadata?.userId !== options.userId
        ) {
            continue;
        }

        if (
            options.sessionId &&
            record.metadata?.sessionId !== options.sessionId
        ) {
            continue;
        }

        const score = cosineSimilarity(
            vector,
            record.vector
        );

        results.push({
            id: record.id,
            score,
            ...(record.metadata !== undefined && {
                metadata: record.metadata
            })
        });
    }

    results.sort(
        (a, b) => b.score - a.score
    );

    return results.slice(0, options.limit);
}

    async delete(id: string): Promise<void> {
        this.records.delete(id);
    }

    async clear(): Promise<void> {
        this.records.clear();
    }
}