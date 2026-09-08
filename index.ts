import { BasicTracer } from "./src/tracing/tracer.js";

// Agent
export { Agent, AgentSession } from "./src/agent/agent.js";
export { defineTool } from "./src/agent/types.js";
export type * from "./src/agent/types.js";

// Model providers live behind subpath imports so you only need the peer
// dependency for the provider you actually use:
//   import { OpenAIModel } from "ai-sdk/openai";
//   import { GeminiModel } from "ai-sdk/gemini";
//   import { GroqModel } from "ai-sdk/groq";

// Memory
export { MemoryManager } from "./src/memory/memory-manager.js";
export { InMemoryStore } from "./src/memory/memory.js";
export { InMemoryLongTermMemory } from "./src/memory/long-term-memory.js";
export { InMemoryLongTermMemoryStore } from "./src/memory/in-memory-memory-store.js";
// Neo4jLongTermMemoryStore lives behind a subpath import (needs neo4j-driver):
//   import { Neo4jLongTermMemoryStore } from "ai-sdk/neo4j";
export { LLMMemoryExtractor } from "./src/memory/memory-extractor.js";
export { LLMMemoryContradictionDetector } from "./src/memory/memory-contradiction-detector.js";
export { FakeMemorySimilarity, EmbeddingMemorySimilarity } from "./src/memory/memory-similarity.js";
export { calculateMemoryScore, calculateKeywordScore } from "./src/memory/memory-ranking.js";
export * from "./src/memory/memory-query-classifier.js";

// Embeddings & vectors
export { OllamaEmbeddingProvider } from "./src/embeddings/embedding.js";
export type { OllamaEmbeddingProviderOptions } from "./src/embeddings/embedding.js";
export { InMemoryVectorStore } from "./src/vector/vector-store.js";

// Guardrails
export { Guardrails } from "./src/guardrail/guardrails.js";
export { GuardrailTripwireError } from "./src/guardrail/guardError.js";

// Tokenizer
export { ApproximateTokenizer } from "./src/tokenizer.js";

// Cross-cutting utilities
export { noopLogger, consoleLogger } from "./src/logger.js";
export type { Logger } from "./src/logger.js";
export { withRetry } from "./src/utils/retry.js";
export type { RetryOptions } from "./src/utils/retry.js";
export { cosineSimilarity } from "./src/utils/cosine-similarity.js";
export {
    SdkError,
    ToolNotFoundError,
    ToolExecutionError,
    ToolCallParseError,
    ModelGenerationError,
    MemoryOperationError,
    MaxToolIterationsExceededError
} from "./src/error.js";

export {BasicTracer} from "./src/tracing/tracer.js"
export type {Span, Tracer} from "./src/tracing/tracer.js"
export {NoopTracer} from "./src/tracing/tracer.js"
export {NoopSpan} from "./src/tracing/tracer.js"
