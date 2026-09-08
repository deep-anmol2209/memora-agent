import type {
  Message,
  MemoryOptions,
  MemoryStore,
  TokenCounter
} from "../agent/types.js";
import { getCurrentTracer } from "../tracing/context.js";
import { ApproximateTokenizer } from "../tokenizer.js";
export class InMemoryStore implements MemoryStore {
  private sessions = new Map<string, Message[]>();
private tokenizer: TokenCounter;
  constructor(private options: MemoryOptions = {}) {
    this.tokenizer= options.tokenizer ?? new ApproximateTokenizer();
  }

  async get(sessionId: string): Promise<Message[]> {
    const tracer = getCurrentTracer();
    const span = tracer?.startSpan("short-term-memory.get");

    try {
      return this.sessions.get(sessionId) ?? [];
    } catch (error) {
      span?.recordError(error);
      throw error;
    } finally {
      span?.end();
    }
  }

  async add(sessionId: string, message: Message): Promise<void> {
    const tracer = getCurrentTracer();
    const span = tracer?.startSpan("short-term-memory.add");

    try {
      const messages = this.sessions.get(sessionId) ?? [];
      messages.push(message);
      this.sessions.set(sessionId, messages);
    } catch (error) {
      span?.recordError(error);
      throw error;
    } finally {
      span?.end();
    }
  }

  async clear(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

async endTurn(sessionId: string): Promise<void> {

    const messages =
        this.sessions.get(sessionId) ?? [];

    const maxTurns = this.options.maxTurns;
    const maxTokens = this.options.maxTokens;
    const shouldTrace =
        (maxTurns !== undefined || maxTokens !== undefined) &&
        messages.length > 0;
    const tracer = getCurrentTracer();
    const span = shouldTrace ? tracer?.startSpan("short-term-memory.end-turn") : undefined;

    try {
        // -------------------------
        // MAX TURNS
        // -------------------------

        if (maxTurns !== undefined) {

            const userIndexes: number[] = [];

            for (let i = 0; i < messages.length; i++) {

                if (messages[i]?.role === "user") {
                    userIndexes.push(i);
                }
            }

            if (userIndexes.length > maxTurns) {

                const keepFrom =
                    userIndexes[userIndexes.length - maxTurns];

                messages.splice(0, keepFrom);
            }
        }

        // -------------------------
        // MAX TOKENS
        // -------------------------

        if (maxTokens !== undefined) {

            while (
                messages.length > 0 &&
               await this.tokenizer.count(messages) > maxTokens
            ) {

                // Remove one COMPLETE TURN
                const firstUserIndex =
                    messages.findIndex(
                        message => message.role === "user"
                    );

                if (firstUserIndex === -1) {
                    messages.shift();
                    continue;
                }

                let nextUserIndex = -1;

                for (
                    let i = firstUserIndex + 1;
                    i < messages.length;
                    i++
                ) {
                    if (messages[i]?.role === "user") {
                        nextUserIndex = i;
                        break;
                    }
                }

                if (nextUserIndex === -1) {

                    // Only one turn remains.
                    // Remove it completely.
                    messages.splice(0);

                } else {

                    messages.splice(
                        firstUserIndex,
                        nextUserIndex - firstUserIndex
                    );
                }
            }
        }

        this.sessions.set(sessionId, messages);
    } catch (error) {
        span?.recordError(error);
        throw error;
    } finally {
        span?.end();
    }
}
}