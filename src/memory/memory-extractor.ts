import type {
    IModel,
    MemoryExtractor,
    MemoryRecord,
    MemoryRecordMetadata,
    Message
} from "../agent/types.js";
import { noopLogger, type Logger } from "../logger.js";

const VALID_TYPES = new Set<MemoryRecordMetadata["type"]>([
    "preference",
    "personal-info",
    "fact",
    "goal",
    "project",
    "other"
]);
const VALID_STRATEGIES = new Set<NonNullable<MemoryRecord["strategy"]>>([
    "replace",
    "append"
]);

export class SimpleMemoryExtractor
    implements MemoryExtractor {

    async extract(
        messages: Message[]
    ): Promise<MemoryRecord[]> {

        const memories: MemoryRecord[] = [];

        for (const message of messages) {

            if (message.role !== "user") {
                continue;
            }

            const content = message.content.toLowerCase();

            if (
                content.includes("my name is")
            ) {
                memories.push({
                    id: crypto.randomUUID(),
                    content: message.content,
                    metadata: {
                        type: "personal-info"
                    }
                });
            }

            if (
                content.includes("i like") ||
                content.includes("i prefer")
            ) {
                memories.push({
                    id: crypto.randomUUID(),
                    content: message.content,
                    metadata: {
                        type: "preference"
                    }
                });
            }
        }

        return memories;
    }
}



export class LLMMemoryExtractor
    implements MemoryExtractor {

    private logger: Logger;

    constructor(
        private model: IModel,
        logger?: Logger
    ) {
        this.logger = logger ?? noopLogger;
    }

    async extract(
        messages: Message[]
    ): Promise<MemoryRecord[]> {

        const request = {
           system: `
You are a memory extraction system.

Your job is to identify durable information
from the conversation that would be useful
in future conversations.

Extract only information worth remembering.

Do NOT extract:
- greetings
- temporary questions
- casual conversation
- assistant-generated information
- tool results unless they represent a durable fact

Return ONLY valid JSON.

Format:
[
  {
    "content": "short durable fact",
    "type": "preference",
    "key": "stable logical identity of the fact",
    "strategy": "replace" or "append"
  }
]

type must be one of:
- preference
- personal-info
- fact
- goal
- project
- other


KEY GENERATION RULES:

The key must represent the underlying concept
of the memory, NOT the exact wording used by the user.

Use the SAME key when multiple statements describe
the same underlying concept.

Do NOT create different keys just because the user
uses different words such as:
- like
- love
- prefer
- enjoy
- favorite

For example, "I like TypeScript" and
"I love TypeScript" represent the same concept
and must use the same key.

Keys should be short, stable, lowercase,
and use hyphens.

Do NOT include specific values in the key.

Bad:
- likes-pakistan
- loves-england
- prefers-typescript

Good:
- liked-countries
- preferred-programming-language
- favorite-country


Examples:

"My name is Anmol"
→ {
    "content": "User's name is Anmol",
    "type": "personal-info",
    "key": "user-name",
    "strategy": "replace"
  }


"I like TypeScript"
→ {
    "content": "User likes TypeScript",
    "type": "preference",
    "key": "preferred-programming-language",
    "strategy": "replace"
  }


"I prefer TypeScript"
→ {
    "content": "User prefers TypeScript",
    "type": "preference",
    "key": "preferred-programming-language",
    "strategy": "replace"
  }


"I like Pakistan"
→ {
    "content": "User likes Pakistan",
    "type": "preference",
    "key": "liked-countries",
    "strategy": "append"
  }


"I love England"
→ {
    "content": "User loves England",
    "type": "preference",
    "key": "liked-countries",
    "strategy": "append"
  }


"My favorite country is Pakistan"
→ {
    "content": "User's favorite country is Pakistan",
    "type": "preference",
    "key": "favorite-country",
    "strategy": "replace"
  }


"Actually, England is my favorite country"
→ {
    "content": "User's favorite country is England",
    "type": "preference",
    "key": "favorite-country",
    "strategy": "${VALID_STRATEGIES}"
  }


STRATEGY RULES:

Use "replace" when the memory represents ONE
current value that can change over time.

Examples:
- preferred programming language
- favorite country
- current goal
- current status
- user's name

Use "append" when multiple values can
exist at the same time.

Examples:
- countries the user likes
- projects the user has worked on
- hobbies
- interests
- experiences
- general facts

IMPORTANT:

Do not use "replace" simply because two memories
have the same type.

Do not use "append" simply because two memories
have different values.

Choose the strategy based on whether multiple
values can logically coexist.

Examples:

"I like Pakistan"
"I love England"

→ same key: "liked-countries"
→ strategy: "append"
→ both memories can coexist.


"My favorite country is Pakistan"
"England is my favorite country"

→ same key: "favorite-country"
→ strategy: "replace"
→ the newer value replaces the previous value.


If there is nothing worth remembering,
return [].

Return ONLY the JSON array.
No explanations.
No markdown.
No additional text.
`,

            messages
        };

        const response =
            await this.model.generate(request);

        if (!response.text) {
            return [];
        }

        try {

            const parsed =
                JSON.parse(response.text);

            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed
                .filter(
                    (memory): memory is { content: string; key?: string; strategy?: string; type?: string } =>
                        typeof memory?.content === "string" && memory.content.length > 0
                )
                .map(
                    (memory): MemoryRecord => {
                        const strategy = VALID_STRATEGIES.has(memory.strategy as never)
                            ? (memory.strategy as MemoryRecord["strategy"])
                            : undefined;

                        const type = VALID_TYPES.has(memory.type as never)
                            ? (memory.type as MemoryRecordMetadata["type"])
                            : undefined;

                        return {
                            id: crypto.randomUUID(),
                            content: memory.content,
                            ...(memory.key !== undefined && { key: memory.key }),
                            ...(strategy !== undefined && { strategy }),
                            ...(type !== undefined && { metadata: { type } })
                        };
                    }
                );

        } catch (cause) {

            this.logger.warn("Failed to parse memory extraction response as JSON", {
                cause,
                raw: response.text
            });

            return [];
        }
    }
}