import type {
    IModel,
    MemoryContradictionDetector,
    MemoryRecord
} from "../agent/types.js";
import { noopLogger, type Logger } from "../logger.js";

export class LLMMemoryContradictionDetector
    implements MemoryContradictionDetector {

    private logger: Logger;

    constructor(
        private model: IModel,
        logger?: Logger
    ) {
        this.logger = logger ?? noopLogger;
    }

    async isContradiction(
        existing: MemoryRecord,
        incoming: MemoryRecord
    ): Promise<boolean> {

        const response =
            await this.model.generate({

                system: `
You are a memory contradiction detector.

Determine whether the incoming memory contradicts
the existing memory.

Return ONLY valid JSON:

{
  "contradiction": true
}

or

{
  "contradiction": false
}

A contradiction means the two memories cannot both
be true for the same user at the same time.

Examples:

Existing:
"User prefers TypeScript"

Incoming:
"User prefers Rust"

=> true

Existing:
"User likes TypeScript"

Incoming:
"User is building an AI SDK"

=> false

Existing:
"User lives in Delhi"

Incoming:
"User lives in Mumbai"

=> true

Existing:
"User likes TypeScript"

Incoming:
"User is learning TypeScript"

=> false
`,

                messages: [
                    {
                        role: "user",
                        content: JSON.stringify({
                            existing: existing.content,
                            incoming: incoming.content
                        })
                    }
                ]
            });

        if (!response.text) {
            return false;
        }

        try {

            const parsed =
                JSON.parse(response.text);

            return parsed.contradiction === true;

        } catch (cause) {

            this.logger.warn("Failed to parse contradiction-detector response as JSON", {
                cause,
                raw: response.text
            });

            return false;
        }
    }
}