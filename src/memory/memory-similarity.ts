import { cosineSimilarity } from "../utils/cosine-similarity.js";
import type { EmbeddingProvider, MemorySimilarity } from "../agent/types.js";


export class FakeMemorySimilarity implements MemorySimilarity{

    async similarity(a: string, b: string): Promise<number> {
        if(a.toLowerCase().includes("typescript") && b.toLowerCase().includes("typescript")){
            return 0.95;
        }
        return 0.1;
    }
}


export class EmbeddingMemorySimilarity
    implements MemorySimilarity {

    constructor(
        private embedding: EmbeddingProvider
    ) {}

    async similarity(
        a: string,
        b: string
    ): Promise<number> {

        const [aEmbedding, bEmbedding] =
            await Promise.all([
                this.embedding.embed(a),
                this.embedding.embed(b)
            ]);

        return cosineSimilarity(
            aEmbedding,
            bEmbedding
        );
    }
}