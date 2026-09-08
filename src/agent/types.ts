import z from "zod"
import type { Logger } from "../logger.js"
import type { Tracer } from "../tracing/tracer.js";
import type { MemoryQueryClassifier } from "../memory/memory-query-classifier.js";



export type GuardRailContext= | 
{type: "input"; 
 value: string;
}
|{
    type: "output";
    value: string;
}
|{
    type: "tool-input";
    toolName: string;
    value: unknown;
}
|{
 type: "tool-output";
 toolName: string;
 value: unknown
};

export interface ContentFilterOptions{
    words?: string[];
    patterns?: RegExp[]
}
export interface GuardRailResult{

    triggered: boolean;
    reason?: string
}

export interface GuardRail{
name: string;
check(
    context: GuardRailContext
): Promise<GuardRailResult>
}

export interface GenerateRequest {
    system: string;
    messages: Message[]
    tools?: ITool[];
    /**
     * When set, the model must produce a final answer conforming to this
     * zod schema, using whatever native structured-output mechanism the
     * provider offers (e.g. OpenAI/Groq `response_format: json_schema`,
     * Gemini `responseJsonSchema`) rather than a prompted convention.
     * Providers that don't support this should ignore it.
     */
    responseFormat?: {
        /** A short identifier for the schema (provider-facing, not shown to the end user). */
        name: string;
        schema: z.ZodType;
    };
}

export interface GenerateResponse {
    text?: string;
    toolCalls?: ToolCall[];
    output?: unknown
}
export interface ToolCall {
    id: string;
    name: string;
    arguments: string;
     thoughtSignature?: string;
}

export interface ITool<
    TInputSchema extends z.ZodType = z.ZodType<any>,
    TOutputSchema extends z.ZodType = z.ZodType<any>
> {
    name: string;
    description: string;
    inputSchema: TInputSchema;
    outputSchema: TOutputSchema;
    execute: (input: z.infer<TInputSchema>) => Promise<z.infer<TOutputSchema>>;
}

/**
 * Identity helper that lets TypeScript infer the input/output types from
 * your Zod schemas, so `execute`'s parameter and return type are checked
 * against them instead of falling back to `any`.
 *
 * const weatherTool = defineTool({
 *   name: "weatherFetcher",
 *   description: "...",
 *   inputSchema: z.object({ city: z.string() }),
 *   outputSchema: z.object({ degree: z.number() }),
 *   execute: async (input) => ({ degree: 20 }) // input is { city: string }
 * });
 */
export function defineTool<
    TInputSchema extends z.ZodType,
    TOutputSchema extends z.ZodType
>(
    tool: ITool<TInputSchema, TOutputSchema>
): ITool<TInputSchema, TOutputSchema> {
    return tool;
}


export interface IModel {
    generate(
        request: GenerateRequest
    ): Promise<GenerateResponse>;
}

export interface AgentConfig {
    instructions: string;
    tools?: ITool[];
    tracer?: Tracer
    model: IModel
    inputGuardrails?: GuardRail[];
    outputGuardrails?: GuardRail[];
    memory?: MemoryManagerConfig;
 
    /**
     * When set, the agent's final answer is constrained to this zod schema
     * using the model provider's native structured-output support (not a
     * prompted convention), and the parsed, validated result is available
     * on `GenerateResponse.output`.
     */
    structuredOutput?: z.ZodType;
 
    /** Injectable logger. Defaults to a no-op logger — nothing is logged unless you opt in. */
    logger?: Logger;
 
    /** Max rounds of tool-call -> tool-result -> model-generate within a single turn. Default 5. */
    maxToolIterations?: number;
}

export interface UserMessage{
   role: "user";
   content: string
}

export interface AssistantMessage{
    role: "assistant";
    content?: string;
    toolCalls: ToolCall[]

}

export interface ToolMessage{
    role: "tool";
    toolCallId: string;
    toolName: string
    content: string
}

export type Message = UserMessage | AssistantMessage | ToolMessage 


// export interface MemoryMessage {
//     role: "user" | "assistant" | "tool";
//     content: string;
// }

export interface MemoryStore {
    get(sessionId: string): Promise<Message[]>;
    add( sessionId: string, message: Message): Promise<void>;
    clear(sessionId: string): Promise<void>
    endTurn(sessionId: string): Promise<void>;
}

export interface LongTermMemoryStore {
    get(id: string): Promise<MemoryRecord | undefined>;

    getAll(): Promise<MemoryRecord[]>;

    /** Optional: retrieve multiple records by id in a single call to avoid N+1 lookups. */
    getMany?(ids: string[]): Promise<MemoryRecord[]>;

    set(record: MemoryRecord): Promise<void>;

    delete(id: string): Promise<void>;

    searchByMetadata(
        metadata: MemorySearchOptions["metadata"],
        options?: Pick<
            MemorySearchOptions,
            "userId" | "sessionId" | "limit"
        >
    ): Promise<MemoryRecord[]>;

    clear(): Promise<void>;
}

export interface MemoryOptions {
    maxTurns?: number;
    maxTokens?: number;
    tokenizer?: TokenCounter;
    semanticSimilarityThreshold?: number;
    contradictionStrategy?: "replace" | "keep-both" | "reject"
}



export interface TokenCounter{
    count(messages: Message[]): number | Promise<number>
}

export interface MemoryRecordMetadata{
     type?:
           | "preference"
           | "personal-info"
           | "fact"
           | "goal"
           | "project"
           | "other";

           userId?: string;
           sessionId?: string;
           [key: string]: unknown;
        
}

export interface MemoryRecord {
    id: string;
    content: string;
    metadata?: MemoryRecordMetadata
    key?: string;
    strategy?: "replace" | "append";
    createdAt?: Date;
    updatedAt?: Date
    graph?: MemoryGraphReference[]
}

export interface LongTermMemory{
    remember(record: MemoryRecord): Promise<void>

    search(query: string, options?: MemorySearchOptions): Promise<MemoryRecord[]>

    forget(id: string): Promise<void>

    clear(): Promise<void>;

    graphSearch(options: MemoryGraphReference): Promise<MemoryRecord[]>
}



export interface MemorySearchOptions{
    limit?: number;
    userId?: string;
    sessionId?: string;
    semanticWeight?: number;
    keywordWeight?: number;
    metadataWeight?: number;
    graph?: MemoryGraphSearchOptions;
    metadata?:{
        type?: string,
        key?:string,
        [key: string]: string | undefined;
    }
    /** Multiplier used to calculate vector search top-K: topK = Math.max(limit * multiplier, 20) */
    vectorTopKMultiplier?: number;
}


export interface MemoryManagerConfig{
    shortTerm?: MemoryStore;
    longTerm? : LongTermMemory;
    extractor?: MemoryExtractor;
    graph?: GraphStore
    /**
     * Gates memory extraction: before calling `extractor.extract()`, the
     * triggering user message is classified, and extraction is skipped when
     * the classifier confidently recognizes it as a pure lookup (a known
     * read-only question pattern with nothing new stated). Defaults to
     * `DefaultMemoryQueryClassifier`. Pass your own to cover app-specific
     * lookup phrasing, or a classifier that never sets `confidence` to
     * disable this optimization and always extract.
     */
    queryClassifier?: MemoryQueryClassifier;
    /** Injectable logger. Defaults to a no-op logger — nothing is logged unless you opt in. */
    logger?: Logger;
}

export interface MemoryExtractor{
        extract(messages: Message[]): Promise<MemoryRecord[]>
}


export interface MemorySimilarity{
    similarity(a: string, b: string): Promise<number>;
}


export interface EmbeddingProvider{
    embed(text: string): Promise<number[]>
}


export interface VectorRecord {
    id: string;
    vector: number[];
    metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
    id: string;
    score: number;
    metadata?: Record<string, unknown>;
}

export interface VectorStore {
    upsert(record: VectorRecord): Promise<void>;

    search(
        vector: number[],
       options?: VectorSearchOptions
    ): Promise<VectorSearchResult[]>;

    delete(id: string): Promise<void>;

    clear(): Promise<void>;
}

export interface VectorSearchOptions{
    limit: number;
    userId?: string;
    sessionId?: string;
}

export interface MemoryContradictionDetector{
    isContradiction(
        existing: MemoryRecord,
        incoming: MemoryRecord
    ): Promise<boolean>
}


export interface MemoryGraphReference{
    entityType: string
    entityId: string
    relation: string
}

export interface MemoryGraphSearchOptions{
    entityType: string
    entityId: string
    relation: string
}

export interface GraphStore{
    set(record: MemoryRecord): Promise<void>;
    search(optios: MemoryGraphSearchOptions): Promise<MemoryRecord[]>;
    delete?(id: string): Promise<void>;
    clear?(): Promise<void>;
}

export interface MemoryContext{
    userId?: string | undefined;
    sessionId: string;
}