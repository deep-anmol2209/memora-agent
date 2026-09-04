import type { Message, TokenCounter } from "./agent/types.js";

export class ApproximateTokenizer implements TokenCounter {

    count(messages: Message[]): number {

        const text = messages
            .map(message => {

                if (message.role === "user") {
                    return message.content;
                }

                if (message.role === "assistant") {
                    return [
                        message.content ?? "",
                        ...message.toolCalls.map(
                            toolCall => toolCall.arguments
                        )
                    ].join(" ");
                }

                if (message.role === "tool") {
                    return message.content;
                }

                return "";
            })
            .join(" ");

        return Math.ceil(text.length / 4);
    }
}