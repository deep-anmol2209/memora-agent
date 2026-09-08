// import type { Content } from "@google/genai";
// import { GoogleGenAI } from "@google/genai";
// import z from "zod";
// import type { GenerateRequest, GenerateResponse, IModel, ITool, Message } from "../../src/agent/types.js";
// import { noopLogger, type Logger } from "../../src/logger.js";
// import { withRetry, type RetryOptions } from "../../src/utils/retry.js";
// import { ModelGenerationError } from "../../src/error.js";

// export interface GeminiOptions {
//     apiKey: string;
//     model: string;
//     retry?: RetryOptions;
//     logger?: Logger;
// }

// export class GeminiModel implements IModel {

//     private client: GoogleGenAI;
//     private logger: Logger;

//     constructor(private options: GeminiOptions) {
//         this.client = new GoogleGenAI({
//             apiKey: options.apiKey
//         });
//         this.logger = options.logger ?? noopLogger;
//     }
//     private convertTool(tool: ITool) {
//         return {
//             name: tool.name,
//             description: tool.description,
//             parametersJsonSchema: z.toJSONSchema(tool.inputSchema)
//         };
//     }
//     private convertMessage(
//         message: Message
//     ): Content | undefined {

//         if (message.role === "user") {
//             return {
//                 role: "user",
//                 parts: [
//                     {
//                         text: message.content
//                     }
//                 ]
//             };
//         }

//         if (message.role === "assistant") {
//             return {
//                 role: "model",
//                 parts: (message.toolCalls ?? []).map(toolCall => ({
//                     functionCall: {
//                         name: toolCall.name,
//                         args: JSON.parse(toolCall.arguments),
//                         id: toolCall.id
//                     },

//                     ...(toolCall.thoughtSignature && {
//                         thoughtSignature: toolCall.thoughtSignature
//                     })
//                 }))
//             };
//         }

//         if (message.role === "tool") {
//             return {
//                 role: "user",
//                 parts: [
//                     {
//                         functionResponse: {
//                             name: message.toolName,
//                             response: JSON.parse(message.content)
//                         }
//                     }
//                 ]
//             };
//         }

//         return undefined;
//     }

//     async generate(
//         request: GenerateRequest
//     ): Promise<GenerateResponse> {
//         const tools = request.tools?.map(tool =>
//             this.convertTool(tool)
//         );
//         const contents = request.messages
//             .map(message => this.convertMessage(message))
//             .filter(
//                 (message): message is Content =>
//                     message !== undefined
//             );

//         let response;
//         try {
//             response = await withRetry(
//                 () => this.client.models.generateContent({

//                     model: this.options.model,

//                     contents,

//                     config: {
//                         systemInstruction: request.system,
//                         ...(tools && {
//                             tools: [
//                                 {
//                                     functionDeclarations: tools
//                                 }
//                             ]
//                         })
//                     }
//                 }),
//                 this.options.retry
//             );
//         } catch (cause) {
//             throw new ModelGenerationError("gemini", cause);
//         }

//         this.logger.debug("Gemini response", { candidates: response.candidates });
//         const functionCalls =
//             response.candidates?.[0]?.content?.parts
//                 ?.filter(
//                     part =>
//                         part.functionCall?.name
//                 )
//                 .map(part => ({
//                     id: part.functionCall!.id ?? "",
//                     name: part.functionCall!.name!,
//                     arguments: JSON.stringify(
//                         part.functionCall!.args ?? {}
//                     ),
//                     ...(part.thoughtSignature && {
//                         thoughtSignature: part.thoughtSignature
//                     })
//                 }));
//         return {
//             ...(response.text
//                 ? { text: response.text }
//                 : {}),

//             ...(functionCalls?.length
//                 ? { toolCalls: functionCalls }
//                 : {})
//         };
//     }
// }


import type { Content } from "@google/genai";
import { GoogleGenAI } from "@google/genai";
import z from "zod";
import type { GenerateRequest, GenerateResponse, IModel, ITool, Message } from "../../src/agent/types.js";
import { noopLogger, type Logger } from "../../src/logger.js";
import { withRetry, type RetryOptions } from "../../src/utils/retry.js";
import { ModelGenerationError, StructuredOutputUnsupportedError } from "../../src/error.js";

export interface GeminiOptions {
    apiKey: string;
    model: string;
    retry?: RetryOptions;
    logger?: Logger;
}

export class GeminiModel implements IModel {

    private client: GoogleGenAI;
    private logger: Logger;

    constructor(private options: GeminiOptions) {
        this.client = new GoogleGenAI({
            apiKey: options.apiKey
        });
        this.logger = options.logger ?? noopLogger;
    }
    private convertTool(tool: ITool) {
        return {
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: z.toJSONSchema(tool.inputSchema)
        };
    }
    private convertMessage(
        message: Message
    ): Content | undefined {

        if (message.role === "user") {
            return {
                role: "user",
                parts: [
                    {
                        text: message.content
                    }
                ]
            };
        }

        if (message.role === "assistant") {
            return {
                role: "model",
                parts: (message.toolCalls ?? []).map(toolCall => ({
                    functionCall: {
                        name: toolCall.name,
                        args: JSON.parse(toolCall.arguments),
                        id: toolCall.id
                    },

                    ...(toolCall.thoughtSignature && {
                        thoughtSignature: toolCall.thoughtSignature
                    })
                }))
            };
        }

        if (message.role === "tool") {
            return {
                role: "user",
                parts: [
                    {
                        functionResponse: {
                            name: message.toolName,
                            response: JSON.parse(message.content)
                        }
                    }
                ]
            };
        }

        return undefined;
    }

    async generate(
        request: GenerateRequest
    ): Promise<GenerateResponse> {
        const tools = request.tools?.map(tool =>
            this.convertTool(tool)
        );

        if (request.responseFormat && tools?.length) {
            // Gemini's generateContent does not support combining a JSON
            // response schema with function-calling tools in the same
            // request — fail fast with a clear reason instead of letting
            // the API reject it (or silently ignore one of the two).
            throw new StructuredOutputUnsupportedError(
                "gemini",
                "responseFormat cannot be combined with tools in the same request"
            );
        }

        const contents = request.messages
            .map(message => this.convertMessage(message))
            .filter(
                (message): message is Content =>
                    message !== undefined
            );

        let response;
        try {
            response = await withRetry(
                () => this.client.models.generateContent({

                    model: this.options.model,

                    contents,

                    config: {
                        systemInstruction: request.system,
                        ...(tools && {
                            tools: [
                                {
                                    functionDeclarations: tools
                                }
                            ]
                        }),
                        ...(request.responseFormat && {
                            responseMimeType: "application/json",
                            responseJsonSchema: z.toJSONSchema(request.responseFormat.schema)
                        })
                    }
                }),
                this.options.retry
            );
        } catch (cause) {
            throw new ModelGenerationError("gemini", cause);
        }

        this.logger.debug("Gemini response", { candidates: response.candidates });
        const functionCalls =
            response.candidates?.[0]?.content?.parts
                ?.filter(
                    part =>
                        part.functionCall?.name
                )
                .map(part => ({
                    id: part.functionCall!.id ?? "",
                    name: part.functionCall!.name!,
                    arguments: JSON.stringify(
                        part.functionCall!.args ?? {}
                    ),
                    ...(part.thoughtSignature && {
                        thoughtSignature: part.thoughtSignature
                    })
                }));
        return {
            ...(response.text
                ? { text: response.text }
                : {}),

            ...(functionCalls?.length
                ? { toolCalls: functionCalls }
                : {})
        };
    }
}