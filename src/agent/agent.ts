import type { AgentConfig, GenerateResponse, GuardRail, GuardRailContext, MemoryRecord, Message } from "./types.js";
import { GuardrailTripwireError } from "../guardrail/guardError.js";
import { MemoryManager } from "../memory/memory-manager.js";
import { noopLogger, type Logger } from "../logger.js";
import {
  ToolNotFoundError,
  ToolCallParseError,
  ToolExecutionError,
  MaxToolIterationsExceededError,
  StructuredOutputParseError
} from "../error.js";
import { getCurrentTracer, runWithSpan } from "../tracing/context.js";
import { NoopTracer, type Tracer } from "../tracing/tracer.js";

const DEFAULT_MAX_TOOL_ITERATIONS = 5;
const STRUCTURED_OUTPUT_FORMAT_NAME = "structured_response";

export class AgentSession {
  constructor(
    private agent: Agent,
    private sessionId: string,
    private userId?: string
  ) {

  }

  async run(input: string): Promise<GenerateResponse> {
    return this.agent.run(input, this.sessionId, this.userId)
  }
}

export class Agent {
  private memory: MemoryManager;
  private logger: Logger;
  private maxToolIterations: number;
  private readonly tracer: Tracer;

  constructor(private config: AgentConfig) {
    this.memory = new MemoryManager(config.memory);
    this.logger = config.logger ?? noopLogger;
    this.maxToolIterations =
      config.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    this.tracer = config.tracer ?? new NoopTracer();
  }

  session(sessionId: string, userId?: string): AgentSession {
    return new AgentSession(this, sessionId, userId);
  }

  private async runGuardrails(
    guardrails: GuardRail[] | undefined,
    context: GuardRailContext
  ) {
    for (const guardrail of guardrails ?? []) {
      const tracer = getCurrentTracer() ?? this.tracer;
      const spanName = context.type === "input" ? "guardrail.input" : "guardrail.output";
      const span = tracer.startSpan(spanName);
      span.setAttribute("guardrail.name", guardrail.name);

      try {
        const result = await guardrail.check(context);
        if (result.triggered) {
          throw new GuardrailTripwireError(guardrail.name, result.reason);
        }
      } catch (error) {
        span.recordError(error);
        throw error;
      } finally {
        span.end();
      }
    }
  }

  private getTool(name: string) {
    return this.config.tools?.find(tool => tool.name === name);
  }

  private async generate(
    messages: Message[],
    options: { includeTools: boolean; includeResponseFormat: boolean }
  ): Promise<GenerateResponse> {
    return this.config.model.generate({
      system: this.config.instructions,
      messages,
      ...(options.includeTools && this.config.tools && { tools: this.config.tools }),
      ...(options.includeResponseFormat && this.config.structuredOutput && {
        responseFormat: {
          name: STRUCTURED_OUTPUT_FORMAT_NAME,
          schema: this.config.structuredOutput
        }
      })
    });
  }
  private async generateWithTracing(
    messages: Message[],
    options: { includeTools: boolean; includeResponseFormat: boolean }
  ): Promise<GenerateResponse> {
    const tracer = getCurrentTracer() ?? this.tracer;
    const span = tracer.startSpan("llm-generate");
    try {
      return await this.generate(messages, options);
    } catch (error) {
      span.recordError(error);
      throw error;
    } finally {
      span.end();
    }
  }
  /** Runs one tool call, translating any failure into a typed SDK error and a tool message the model can see. */
  private async runToolCall(
    toolCall: NonNullable<GenerateResponse["toolCalls"]>[number]
  ): Promise<Message> {
    const tool = this.getTool(toolCall.name);

    if (!tool) {
      throw new ToolNotFoundError(toolCall.name);
    }

    const tracer = getCurrentTracer() ?? this.tracer;
    const span = tracer.startSpan("tool.call");
    span.setAttribute("tool.name", tool.name);

    try {
      let parsedInput: unknown;
      try {
        parsedInput = JSON.parse(toolCall.arguments);
      } catch (cause) {
        throw new ToolCallParseError(toolCall.name, toolCall.arguments, cause);
      }

      const validatedInput = tool.inputSchema.parse(parsedInput);

      let result: unknown;
      try {
        result = await tool.execute(validatedInput);
      } catch (cause) {
        throw new ToolExecutionError(toolCall.name, cause);
      }

      const validatedOutput = tool.outputSchema.parse(result);

      return {
        role: "tool",
        toolCallId: toolCall.id,
        toolName: tool.name,
        content: JSON.stringify(validatedOutput)
      };
    } catch (error) {
      span.recordError(error);
      throw error;
    } finally {
      span.end();
    }
  }

  /** Parses and validates the model's final text against `config.structuredOutput`. */
  private resolveStructuredOutput(text: string): unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw new StructuredOutputParseError(text, cause);
    }
    return this.config.structuredOutput!.parse(parsed);
  }

  async run(input: string, sessionId: string = "default", userId?: string): Promise<GenerateResponse> {
    const span = this.tracer.startSpan("agent.run");

    return runWithSpan(span, this.tracer, async()=>{
         try {
      const turnMessages: Message[] = [];
      const shortTermMemory = this.memory.shortTerm;
      const previousMessages = shortTermMemory
        ? await shortTermMemory.get(sessionId)
        : [];
      let longTermMemories: MemoryRecord[] = [];

      if (this.memory.longTerm && userId) {
         
        const memorySpan = this.tracer.startSpan("memory.search");
        const longTermMemory= this.memory.longTerm;
        try {
          
          await runWithSpan(memorySpan, this.tracer, async()=>{
    longTermMemories =
            await longTermMemory.search(
              input,
              {
                userId,
                limit: 5
              }
            );
          })

      
          // console.log("long term result:", longTermMemories);


          this.logger.debug(
            "Retrieved long-term memories",
            {
              count: longTermMemories.length
            }
          );
        } catch (error) {
          memorySpan.recordError(error);
          this.logger.error(
            "Long-term memory retrieval failed",
            { error }
          );
        } finally {
          memorySpan.end();
        }
      }

      const memoryContext =
        longTermMemories.length > 0
          ? `Relevant information remembered about the user:\n` +
          longTermMemories
            .map(memory => `- ${memory.content}`)
            .join("\n") +
          "\n\n"
          : "";

      // console.log("memory-context: ", memoryContext);


      const originalUserMessage: Message = {
        role: "user",
        content: input
      }
      const modelUserMessage: Message = {
        role: "user",
        content: memoryContext + input
      };



      const messages: Message[] = [
        ...previousMessages,
        modelUserMessage
      ];
      turnMessages.push(originalUserMessage)
      if (shortTermMemory) {
        await shortTermMemory.add(sessionId, originalUserMessage);
      }



      await this.runGuardrails(this.config.inputGuardrails, {
        type: "input",
        value: input
      });

      // Some providers (Groq, Gemini) reject a request that carries both
      // `tools` and a structured-output `responseFormat` at once, and even
      // where it's technically allowed (OpenAI) we treat it uniformly for
      // predictable cross-provider behavior: never send both in the same
      // request. When only structuredOutput is configured (no tools), it's
      // safe to request the schema-formatted answer directly on this first
      // call — there's no tool round-trip that could conflict with it.
      const hasTools = !!this.config.tools;
      const hasStructuredOutput = !!this.config.structuredOutput;

      let response = await this.generateWithTracing(messages, {
        includeTools: true,
        includeResponseFormat: hasStructuredOutput && !hasTools
      })

      // Loop while the model keeps requesting tool calls, up to a hard cap so
      // a misbehaving model/tool combo can't spin forever.
      let iterations = 0;
      while (response.toolCalls?.length) {
        iterations++;
        if (iterations > this.maxToolIterations) {
          throw new MaxToolIterationsExceededError(this.maxToolIterations);
        }

        const assistantToolMessage: Message = {
          role: "assistant",
          toolCalls: response.toolCalls
        };

        messages.push(assistantToolMessage);
        turnMessages.push(assistantToolMessage);
        if (shortTermMemory) {
          await shortTermMemory.add(sessionId, assistantToolMessage);
        }

        for (const toolCall of response.toolCalls) {
          this.logger.debug("Running tool call", { tool: toolCall.name });

          const toolMessage = await this.runToolCall(toolCall);

          messages.push(toolMessage);
          turnMessages.push(toolMessage);
          if (shortTermMemory) {
            await shortTermMemory.add(sessionId, toolMessage);
          }
        }

        response = await this.generateWithTracing(messages, {
          includeTools: true,
          includeResponseFormat: false
        });
      }

      // If structuredOutput is configured alongside tools, the loop above
      // deliberately never asked for schema-formatted output (to avoid
      // combining tools + responseFormat in one request). Now that the
      // model is done calling tools, make one dedicated follow-up call —
      // tools removed, responseFormat added — asking it to restate its
      // draft answer in the required schema.
      if (hasStructuredOutput && hasTools && response.text) {
        messages.push(
          { role: "assistant", content: response.text, toolCalls: [] },
          { role: "user", content: "Reformat your previous answer to match the required schema." }
        );

        response = await this.generateWithTracing(messages, {
          includeTools: false,
          includeResponseFormat: true
        });

        // Those two messages were only scratch context to steer this one
        // reformatting call — the schema-formatted response below is what
        // actually gets persisted to short-term memory, so pop them back off.
        messages.pop();
        messages.pop();
      }

      if (response.text) {
        const text = response.text;
        const output = this.config.structuredOutput
          ? this.resolveStructuredOutput(text)
          : undefined;

        await this.runGuardrails(this.config.outputGuardrails, {
          type: "output",
          value: text
        });

        const assistantMessage: Message = {
          role: "assistant",
          content: text,
          toolCalls: []
        };

        messages.push(assistantMessage);
        turnMessages.push(assistantMessage);
        if (shortTermMemory) {
          await shortTermMemory.add(sessionId, assistantMessage);
          await shortTermMemory.endTurn(sessionId);
        }

        if (this.config.structuredOutput) {
          response = { ...response, output };
        }
      }

      if (this.memory.longTerm && this.memory.extractor && userId ) {
        try {
          // console.log("extracting memory for neo4j");
        
          
          void this.memory.extractAndRemember(turnMessages, { userId, sessionId }).catch(error=> {
            this.logger.error('background processing memory failed', error)
          });
        } catch (error) {
          // Memory extraction is best-effort — a failure here shouldn't take
          // down a response the user is already waiting on.
          this.logger.error("Memory extraction failed", { error });
        }
      }

      return response;
    } catch (error) {
      span.recordError(error);
      throw error
    } finally {
      span.end();
    }
    })

 

  }
}