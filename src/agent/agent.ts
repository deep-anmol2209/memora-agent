import type { AgentConfig, GenerateResponse, GuardRail, GuardRailContext, MemoryRecord, Message } from "./types.js";
import { GuardrailTripwireError } from "../guardrail/guardError.js";
import { MemoryManager } from "../memory/memory-manager.js";
import { noopLogger, type Logger } from "../logger.js";
import {
    ToolNotFoundError,
    ToolCallParseError,
    ToolExecutionError,
    MaxToolIterationsExceededError
} from "../error.js";

const DEFAULT_MAX_TOOL_ITERATIONS = 5;

export class AgentSession{
    constructor(
        private agent: Agent,
        private sessionId: string,
        private userId?: string
    ){

    }

    async run(input: string): Promise<GenerateResponse>{
      return this.agent.run(input, this.sessionId, this.userId)
    }
}

export class Agent {
    private memory: MemoryManager;
    private logger: Logger;
    private maxToolIterations: number;

    constructor(private config: AgentConfig) {
        this.memory = new MemoryManager(config.memory);
        this.logger = config.logger ?? noopLogger;
        this.maxToolIterations =
            config.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    }

  session(sessionId: string, userId?: string): AgentSession {
    return new AgentSession(this, sessionId, userId);
  }

  private async runGuardrails(
    guardrails: GuardRail[] | undefined,
    context: GuardRailContext
  ) {
    for (const guardrail of guardrails ?? []) {
      const result = await guardrail.check(context);
      if (result.triggered) {
        throw new GuardrailTripwireError(guardrail.name, result.reason);
      }
    }
  }

  private getTool(name: string) {
    return this.config.tools?.find(tool => tool.name === name);
  }

  private async generate(messages: Message[]): Promise<GenerateResponse> {
    return this.config.model.generate({
      system: this.config.instructions,
      messages,
      ...(this.config.tools && { tools: this.config.tools })
    });
  }

  /** Runs one tool call, translating any failure into a typed SDK error and a tool message the model can see. */
  private async runToolCall(
    toolCall: NonNullable<GenerateResponse["toolCalls"]>[number]
  ): Promise<Message> {
    const tool = this.getTool(toolCall.name);

    if (!tool) {
      throw new ToolNotFoundError(toolCall.name);
    }

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
  }

  async run(input: string, sessionId: string = "default", userId?: string): Promise<GenerateResponse> {
    const turnMessages: Message[] = [];
    const shortTermMemory = this.memory.shortTerm;
    const previousMessages = shortTermMemory
      ? await shortTermMemory.get(sessionId)
      : [];
let longTermMemories: MemoryRecord[] = [];

if (this.memory.longTerm && userId) {
    try {
        longTermMemories =
            await this.memory.longTerm.search(
                input,
                {
                    userId,
                    limit: 5
                }
            );
            // console.log("long term result:", longTermMemories);
            

        this.logger.debug(
            "Retrieved long-term memories",
            {
                count: longTermMemories.length
            }
        );
    } catch (error) {
        this.logger.error(
            "Long-term memory retrieval failed",
            { error }
        );
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
        

        const originalUserMessage: Message={
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

    let response = await this.generate(messages);

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

      response = await this.generate(messages);
    }

    if (response.text) {
      await this.runGuardrails(this.config.outputGuardrails, {
        type: "output",
        value: response.text
      });

      const assistantMessage: Message = {
        role: "assistant",
        content: response.text,
        toolCalls: []
      };

      messages.push(assistantMessage);
      turnMessages.push(assistantMessage);
      if (shortTermMemory) {
        await shortTermMemory.add(sessionId, assistantMessage);
        await shortTermMemory.endTurn(sessionId);
      }
    }

    if (this.memory.longTerm && this.memory.extractor) {
      try {
        // console.log("extracting memory for neo4j");
        
        await this.memory.extractAndRemember(turnMessages, { userId, sessionId });
      } catch (error) {
        // Memory extraction is best-effort — a failure here shouldn't take
        // down a response the user is already waiting on.
        this.logger.error("Memory extraction failed", { error });
      }
    }

    return response;
  }
}