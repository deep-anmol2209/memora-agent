import type {
    GuardRail,
    ContentFilterOptions
} from "../agent/types.js";

export const Guardrails = {

    contentFilter(
        options: ContentFilterOptions
    ): GuardRail {

        return {
            name: "content-filter",

            async check(context) {

                const value = String(context.value);

                const words = options.words ?? [];
                const patterns = options.patterns ?? [];

                const lowerValue = value.toLowerCase();

                const matchedWord = words.find(
                    word =>
                        lowerValue.includes(
                            word.toLowerCase()
                        )
                );

                if (matchedWord) {
                    return {
                        triggered: true,
                        reason: `Blocked word detected: ${matchedWord}`
                    };
                }

                const matchedPattern = patterns.find(
                    pattern => {
                        // Important for /g regex
                        pattern.lastIndex = 0;

                        return pattern.test(value);
                    }
                );

                if (matchedPattern) {
                    return {
                        triggered: true,
                        reason: "Blocked pattern detected"
                    };
                }

                return {
                    triggered: false
                };
            }
        };
    }
};