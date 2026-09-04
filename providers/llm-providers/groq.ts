import Groq from "groq-sdk";
import z from "zod";
import type { GenerateRequest, GenerateResponse, IModel, ITool, Message } from "../../src/agent/types.js";
import { noopLogger, type Logger } from "../../src/logger.js";
import { withRetry, type RetryOptions } from "../../src/utils/retry.js";
import { ModelGenerationError } from "../../src/error.js";

export interface GroqOptions {
    apiKey: string;
    model: string;
    retry?: RetryOptions;
    logger?: Logger;
}

export class GroqModel implements IModel {

    private client: Groq;
    private logger: Logger;

    constructor(private options: GroqOptions) {
        this.client = new Groq({
            apiKey: options.apiKey
        });
        this.logger = options.logger ?? noopLogger;
    }

    private convertTool(tool: ITool) {
        return {
            type: "function" as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: z.toJSONSchema(tool.inputSchema)
            }
        };
    }
    private convertMessage(message: Message) {

        if (message.role === "user") {
            return {
                role: "user" as const,
                content: message.content
            };
        }

        if (message.role === "assistant") {
            return {
                role: "assistant" as const,
                content: message.content ?? null,

                ...(message.toolCalls && {
                    tool_calls: message.toolCalls.map(toolCall => ({
                        id: toolCall.id,
                        type: "function" as const,
                        function: {
                            name: toolCall.name,
                            arguments: toolCall.arguments
                        }
                    }))
                })
            };
        }

        return {
            role: "tool" as const,
            tool_call_id: message.toolCallId,
            content: message.content
        };
    }
    async generate(
        request: GenerateRequest
    ): Promise<GenerateResponse> {

        const tools = request.tools?.map(tool =>
            this.convertTool(tool)
        );

        let response;
        try {
            response = await withRetry(
                () => this.client.chat.completions.create({
                    model: this.options.model,

                    messages: [
                        {
                            role: "system",
                            content: request.system
                        },
                        ...request.messages.map(message =>
                            this.convertMessage(message)
                        )
                    ],

                    ...(tools && {
                        tools
                    })
                }),
                this.options.retry
            );
        } catch (cause) {
            throw new ModelGenerationError("groq", cause);
        }

        const message = response.choices[0]?.message;

        this.logger.debug("Groq response", { message });

        return {
            ...(message?.content
                ? { text: message.content }
                : {}),

            ...(message?.tool_calls?.length
                ? {
                    toolCalls: message.tool_calls.map(call => ({
                        id: call.id,
                        name: call.function.name,
                        arguments: call.function.arguments
                    }))
                }
                : {})
        };
    }
}