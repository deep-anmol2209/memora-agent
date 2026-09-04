import type { EmbeddingProvider } from "../agent/types.js";
import { withRetry, type RetryOptions } from "../utils/retry.js";
import { SdkError } from "../error.js";

export interface OllamaEmbeddingProviderOptions {
    model?: string;
    baseUrl?: string;
    /** Aborts a request that hangs longer than this. Default 30s. */
    timeoutMs?: number;
    retry?: RetryOptions;
}

export class OllamaEmbeddingProvider
    implements EmbeddingProvider {

    private model: string;
    private baseUrl: string;
    private timeoutMs: number;
    private retryOptions: RetryOptions | undefined;

    constructor(options: OllamaEmbeddingProviderOptions = {}) {
        this.model = options.model ?? "nomic-embed-text";
        this.baseUrl = options.baseUrl ?? "http://localhost:11434";
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.retryOptions = options.retry;
    }

    async embed(text: string): Promise<number[]> {

        const response = await withRetry(async () => {
            const controller = new AbortController();
            const timeout = setTimeout(
                () => controller.abort(),
                this.timeoutMs
            );

            try {
                return await fetch(
                    `${this.baseUrl}/api/embed`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            model: this.model,
                            input: text
                        }),
                        signal: controller.signal
                    }
                );
            } finally {
                clearTimeout(timeout);
            }
        }, this.retryOptions);

        if (!response.ok) {
            throw new SdkError(
                `Ollama embedding failed: ${response.status} ${await response.text()}`
            );
        }

        const data = await response.json();
        const embedding = data?.embeddings?.[0];

        if (!Array.isArray(embedding)) {
            throw new SdkError(
                "Ollama embedding response was missing an embeddings[0] array"
            );
        }

        return embedding;
    }
}