// import { OpenAI } from "openai";
// import type { ResponseInputItem } from "openai/resources/responses/responses";
// import z from "zod";
// import type { GenerateRequest, GenerateResponse, IModel, ITool, Message } from "../../src/agent/types.js";
// import { noopLogger, type Logger } from "../../src/logger.js";
// import { withRetry, type RetryOptions } from "../../src/utils/retry.js";
// import { ModelGenerationError } from "../../src/error.js";

// export interface OpenAIOptions {
//     apiKey: string;
//     model: string;
//     retry?: RetryOptions;
//     logger?: Logger;
// }

// export class OpenAIModel implements IModel {

//     private client: OpenAI;
//     private logger: Logger;

//     constructor(private options: OpenAIOptions) {
//         this.client = new OpenAI({
//             apiKey: options.apiKey
//         });
//         this.logger = options.logger ?? noopLogger;
//     }

//     private convertTool(tool: ITool) {
//         return {
//             type: "function" as const,
//             name: tool.name,
//             description: tool.description,
//             parameters: z.toJSONSchema(tool.inputSchema),
//             strict: true
//         };
//     }
//     private convertMessage(message: Message): ResponseInputItem[] {
//         if (message.role === "user") {
//             return [
//                 {
//                     role: "user",
//                     content: message.content
//                 }
//             ];
//         }

//         if (message.role === "assistant") {
//             const items: ResponseInputItem[] = [];

//             if (message.content) {
//                 items.push({
//                     role: "assistant",
//                     content: message.content
//                 });
//             }

//             for (const toolCall of message.toolCalls ?? []) {
//                 items.push({
//                     type: "function_call",
//                     call_id: toolCall.id,
//                     name: toolCall.name,
//                     arguments: toolCall.arguments
//                 });
//             }

//             return items;
//         }

//         return [
//             {
//                 type: "function_call_output",
//                 call_id: message.toolCallId,
//                 output: message.content
//             }
//         ];
//     }

//     async generate(
//         request: GenerateRequest
//     ): Promise<GenerateResponse> {

//         const tools = request.tools?.map(tool =>
//             this.convertTool(tool)
//         );

//         const input = request.messages.flatMap(message =>
//             this.convertMessage(message)
//         );

//         let response;
//         try {
//             response = await withRetry(
//                 () => this.client.responses.create({
//                     model: this.options.model,

//                     instructions: request.system,

//                     input,

//                     ...(tools && {
//                         tools
//                     })
//                 }),
//                 this.options.retry
//             );
//         } catch (cause) {
//             throw new ModelGenerationError("openai", cause);
//         }

//         this.logger.debug("OpenAI response", { output: response.output });

//         return {
//             ...(response.output_text
//                 ? {
//                     text: response.output_text
//                 }
//                 : {}),

//             toolCalls: response.output
//                 .filter(item => item.type === "function_call")
//                 .map(call => ({
//                     id: call.call_id,
//                     name: call.name,
//                     arguments: call.arguments
//                 }))
//         };
//     }
// }


import { OpenAI } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import z from "zod";
import type { GenerateRequest, GenerateResponse, IModel, ITool, Message } from "../../src/agent/types.js";
import { noopLogger, type Logger } from "../../src/logger.js";
import { withRetry, type RetryOptions } from "../../src/utils/retry.js";
import { ModelGenerationError } from "../../src/error.js";

export interface OpenAIOptions {
    apiKey: string;
    model: string;
    retry?: RetryOptions;
    logger?: Logger;
}

export class OpenAIModel implements IModel {

    private client: OpenAI;
    private logger: Logger;

    constructor(private options: OpenAIOptions) {
        this.client = new OpenAI({
            apiKey: options.apiKey
        });
        this.logger = options.logger ?? noopLogger;
    }

    private convertTool(tool: ITool) {
        return {
            type: "function" as const,
            name: tool.name,
            description: tool.description,
            parameters: z.toJSONSchema(tool.inputSchema),
            strict: true
        };
    }
    private convertMessage(message: Message): ResponseInputItem[] {
        if (message.role === "user") {
            return [
                {
                    role: "user",
                    content: message.content
                }
            ];
        }

        if (message.role === "assistant") {
            const items: ResponseInputItem[] = [];

            if (message.content) {
                items.push({
                    role: "assistant",
                    content: message.content
                });
            }

            for (const toolCall of message.toolCalls ?? []) {
                items.push({
                    type: "function_call",
                    call_id: toolCall.id,
                    name: toolCall.name,
                    arguments: toolCall.arguments
                });
            }

            return items;
        }

        return [
            {
                type: "function_call_output",
                call_id: message.toolCallId,
                output: message.content
            }
        ];
    }

    async generate(
        request: GenerateRequest
    ): Promise<GenerateResponse> {

        const tools = request.tools?.map(tool =>
            this.convertTool(tool)
        );

        const input = request.messages.flatMap(message =>
            this.convertMessage(message)
        );

        const textFormat = request.responseFormat && {
            format: {
                type: "json_schema" as const,
                name: request.responseFormat.name,
                schema: z.toJSONSchema(request.responseFormat.schema),
                strict: true
            }
        };

        let response;
        try {
            response = await withRetry(
                () => this.client.responses.create({
                    model: this.options.model,

                    instructions: request.system,

                    input,

                    ...(tools && {
                        tools
                    }),

                    ...(textFormat && {
                        text: textFormat
                    })
                }),
                this.options.retry
            );
        } catch (cause) {
            throw new ModelGenerationError("openai", cause);
        }

        this.logger.debug("OpenAI response", { output: response.output });

        return {
            ...(response.output_text
                ? {
                    text: response.output_text
                }
                : {}),

            toolCalls: response.output
                .filter(item => item.type === "function_call")
                .map(call => ({
                    id: call.call_id,
                    name: call.name,
                    arguments: call.arguments
                }))
        };
    }
}