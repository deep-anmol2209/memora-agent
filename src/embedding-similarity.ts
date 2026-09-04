import type {
    EmbeddingProvider,
    MemorySimilarity
} from "./agent/types.js";

export class EmbeddingMemorySimilarity
    implements MemorySimilarity {

    constructor(
        private embedding: EmbeddingProvider
    ) {}

    async similarity(
        a: string,
        b: string
    ): Promise<number> {

        const vectorA =
            await this.embedding.embed(a);

        const vectorB =
            await this.embedding.embed(b);

        let dot = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vectorA.length; i++) {
            dot += vectorA[i]! * vectorB[i]!;
            normA += vectorA[i]! * vectorA[i]!;
            normB += vectorB[i]! * vectorB[i]!;
        }

        if (normA === 0 || normB === 0) {
            return 0;
        }

        return (
            dot /
            (Math.sqrt(normA) * Math.sqrt(normB))
        );
    }
}