

import type { IModel, MemorySearchOptions } from "../agent/types.js";
import { noopLogger, type Logger } from "../logger.js";

export interface MemoryQueryClassification {
    intent?: "read" | "write";
    metadata?: NonNullable<MemorySearchOptions["metadata"]>;
    /**
     * Optional confidence in [0, 1]. Rule-based matches are cheap and exact,
     * so they report high confidence (1). Populated mainly so composite /
     * caller logic can decide whether a result is trustworthy enough to act
     * on without a second (e.g. LLM-backed) opinion.
     */
    confidence?: number;
}

export interface MemoryQueryClassifier {
    classify(
        query: string
    ): Promise<MemoryQueryClassification>;
}

/**
 * A single pattern: either a plain phrase (matched case-insensitively on
 * word boundaries, tolerant of extra whitespace) or a fully custom RegExp
 * for callers who need more control.
 */
export type MemoryTopicPattern = string | RegExp;

/**
 * Describes one real-world "memory topic" the classifier should recognize —
 * e.g. a user's name, their dietary preferences, their timezone, a support
 * ticket's account ID, whatever a given application cares about.
 *
 * This is the extension point that makes the classifier generic: instead of
 * baking categories into source code, applications configure their own
 * topics (or extend the defaults) without touching the SDK.
 */
export interface MemoryTopicRule {
    /** The `metadata.type` to assign on a match (e.g. "personal-info", "preference", or any app-specific string). */
    type: string;
    /** The `metadata.key` to assign on a match. Omit for topics that don't map to one stable key (e.g. "project"). */
    key?: string;
    /** Phrases/regexes that indicate the user is *telling* the agent this information. */
    write?: MemoryTopicPattern[];
    /** Phrases/regexes that indicate the user is *asking* the agent for this information. */
    read?: MemoryTopicPattern[];
    /**
     * Phrases/regexes that indicate this topic is merely present in the text
     * (used for topics like "project" or "goal" that should bias search
     * toward a metadata type without asserting a hard read/write intent).
     */
    mentions?: MemoryTopicPattern[];
    /**
     * If any of these appear in the query, a `write` match on this rule is
     * downgraded: intent is dropped (falls back to a soft metadata hint)
     * instead of being asserted, so e.g. "I don't like cilantro" doesn't get
     * stored the same way as "I like cilantro".
     */
    negations?: MemoryTopicPattern[];
    /** Higher runs first when multiple rules could match. Defaults to 0. */
    priority?: number;
}

const DEFAULT_NEGATIONS: MemoryTopicPattern[] = [
    "don't", "do not", "doesn't", "does not", "didn't", "did not",
    "won't", "will not", "never", "not really", "no longer", "used to"
];

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(text: string): string {
    return text
        .normalize("NFKC")
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

/** Compiles a phrase/regex pattern into a case-insensitive, word-boundary-safe RegExp (cached per instance). */
function compilePattern(pattern: MemoryTopicPattern): RegExp {
    if (pattern instanceof RegExp) {
        return pattern;
    }
    const escaped = escapeRegExp(pattern.trim()).replace(/\s+/g, "\\s+");
    return new RegExp(`\\b${escaped}\\b`, "i");
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text));
}

interface CompiledRule {
    type: string;
    key?: string;
    write: RegExp[];
    read: RegExp[];
    mentions: RegExp[];
    negations: RegExp[];
    priority: number;
}

function compileRule(rule: MemoryTopicRule): CompiledRule {
    return {
        type: rule.type,
        ...(rule.key !== undefined && { key: rule.key }),
        write: (rule.write ?? []).map(compilePattern),
        read: (rule.read ?? []).map(compilePattern),
        mentions: (rule.mentions ?? []).map(compilePattern),
        negations: (rule.negations ?? DEFAULT_NEGATIONS).map(compilePattern),
        priority: rule.priority ?? 0
    };
}

/**
 * A small heuristic for the very common "my name is X" / "I'm X" / "call me
 * X" pattern: only treat bare "I am" / "I'm" as a name statement when it's
 * immediately followed by what looks like a proper noun (a capitalized
 * token), so "I am happy today" doesn't get misclassified as someone
 * introducing themselves the way naive substring matching would.
 */
const NAME_INTRO_PATTERN = /\b(?:my name is|call me|you can call me|this is|i go by)\s+([a-z][\w'-]*)/i;
// Pronoun matched case-insensitively (people often type "i'm" lowercase),
// but the following token must be capitalized to look like a proper noun —
// so this can't just use a single "i" flag, which would also blur the
// [A-Z] check and match ordinary lowercase words.
const BARE_NAME_PATTERN = /\b(?:i'm|i am|I'm|I am)\s+([A-Z][\w'-]*)\b/;

function looksLikeNameStatement(rawQuery: string): boolean {
    if (NAME_INTRO_PATTERN.test(rawQuery)) return true;
    return BARE_NAME_PATTERN.test(rawQuery);
}

/**
 * Config-driven, regex-based query classifier.
 *
 * Unlike a hardcoded set of `if (text.includes(...))` checks, this engine:
 *  - matches on word boundaries (won't fire on substrings buried inside
 *    unrelated words),
 *  - is negation-aware (won't treat "I don't like X" the same as "I like X"),
 *  - is fully configurable: pass your own {@link MemoryTopicRule}s to cover
 *    whatever domains your application cares about (support tickets,
 *    dietary restrictions, account IDs, relationship notes, ...) without
 *    forking the SDK,
 *  - runs in well under a millisecond, so it's safe to use on every turn.
 *
 * It intentionally does NOT try to be a general-purpose NLU model — phrasing
 * it can't anticipate will simply fall through to the default (full hybrid
 * search). For broader coverage of arbitrary real-world phrasing, pair it
 * with {@link LLMMemoryQueryClassifier} via {@link CompositeMemoryQueryClassifier}.
 */
export class RuleBasedMemoryQueryClassifier implements MemoryQueryClassifier {
    private readonly rules: CompiledRule[];

    constructor(rules: MemoryTopicRule[] = []) {
        this.rules = rules
            .map(compileRule)
            .sort((a, b) => b.priority - a.priority);
    }

    async classify(query: string): Promise<MemoryQueryClassification> {
        const normalized = normalize(query);

        for (const rule of this.rules) {
            if (matchesAny(normalized, rule.read)) {
                return {
                    intent: "read",
                    metadata: { type: rule.type, ...(rule.key && { key: rule.key }) },
                    confidence: 1
                };
            }
        }

        for (const rule of this.rules) {
            if (!matchesAny(normalized, rule.write)) continue;

            const negated = matchesAny(normalized, rule.negations);
            const metadata = { type: rule.type, ...(rule.key && { key: rule.key }) };

            if (negated) {
                // Don't assert a write intent for negated statements — fall
                // back to a soft hint so retrieval still runs instead of
                // being skipped for what might not actually be a write.
                return { metadata, confidence: 0.5 };
            }

            return { intent: "write", metadata, confidence: 1 };
        }

        for (const rule of this.rules) {
            if (matchesAny(normalized, rule.mentions)) {
                return {
                    metadata: { type: rule.type, ...(rule.key && { key: rule.key }) },
                    confidence: 0.6
                };
            }
        }

        return { intent: "read" };
    }
}

/**
 * A reasonable, broadly-applicable default topic set covering the
 * information most conversational agents need to remember: identity,
 * preferences, contact/location details, and durable projects/goals.
 *
 * Extend this rather than replacing it wholesale — pass extra topics to
 * {@link DefaultMemoryQueryClassifier} and they'll be checked alongside
 * (and, if given a higher `priority`, before) these.
 */
export const DEFAULT_MEMORY_TOPICS: MemoryTopicRule[] = [
    {
        type: "personal-info",
        key: "user-name",
        priority: 10,
        write: ["my name is", "call me", "you can call me", "this is", /\bi(?:'m| am)\s+[A-Z][\w'-]*\b/],
        read: ["what is my name", "what's my name", "who am i"]
    },
    {
        type: "preference",
        key: "preferred-programming-language",
        write: [
            "i like", "i love", "i prefer", "my favorite", "my favourite",
            "i'm into", "i am into", "i enjoy"
        ],
        read: [
            "what programming language do i prefer", "which programming language do i prefer",
            "what language do i prefer", "which language do i prefer",
            "what's my favorite programming language", "what is my favorite language",
            "what do i prefer", "what do i like", "what language do i like"
        ]
        // Note: DefaultMemoryQueryClassifier additionally requires the query
        // to mention "programming"/"coding"/"language" before attributing a
        // bare "I like ..." to this topic rather than "liked-countries" —
        // see the domain-gating logic below.
    },
    {
        type: "preference",
        key: "liked-countries",
        write: ["i like", "i love", "i prefer", "my favorite", "my favourite", "i enjoy", "i've been to", "i visited"],
        read: [
            "what countries do i like", "which countries do i like",
            "what countries do i prefer", "which countries do i prefer",
            "where have i been", "where have i traveled"
        ]
    },
    {
        type: "preference",
        key: "dietary-preference",
        write: ["i'm vegetarian", "i am vegetarian", "i'm vegan", "i am vegan", "i'm allergic to", "i am allergic to", "i don't eat", "i can't eat"],
        read: ["what can i eat", "am i allergic to anything", "what's my diet", "what is my diet"]
    },
    {
        type: "personal-info",
        key: "contact-email",
        write: ["my email is", "you can reach me at", "email me at"],
        read: ["what's my email", "what is my email", "what email do you have for me"]
    },
    {
        type: "personal-info",
        key: "location",
        write: ["i live in", "i'm based in", "i am based in", "i'm from", "i am from"],
        read: ["where do i live", "where am i based", "where am i from"]
    },
    {
        type: "personal-info",
        key: "occupation",
        write: ["i work as", "i work at", "my job is", "i'm a ", "i am a "],
        read: ["what do i do for work", "what's my job", "what is my job", "where do i work"]
    },
    {
        type: "project",
        mentions: ["current project", "working on", "building", "my project", "our project"]
    },
    {
        type: "goal",
        mentions: ["my goal", "current goal", "what am i trying to achieve", "what do i want to achieve", "trying to learn"]
    }
];

/**
 * Drop-in, zero-config classifier (`new DefaultMemoryQueryClassifier()`
 * behaves like before) that now also accepts application-specific topics:
 *
 * ```ts
 * const classifier = new DefaultMemoryQueryClassifier({
 *   topics: [
 *     { type: "support-ticket", key: "account-id",
 *       write: ["my account id is", "my account number is"],
 *       read: ["what's my account id", "what is my account number"] }
 *   ]
 * });
 * ```
 *
 * The programming-language and country preference topics additionally
 * require the query to mention the relevant domain word ("programming" /
 * "language" / "country" / "countries") before a bare "I like ..." is
 * attributed to them — otherwise "I like TypeScript" and "I like Italy"
 * would both loosely match every preference topic.
 */
export class DefaultMemoryQueryClassifier implements MemoryQueryClassifier {
    private readonly inner: RuleBasedMemoryQueryClassifier;

    constructor(options: { topics?: MemoryTopicRule[] } = {}) {
        this.inner = new RuleBasedMemoryQueryClassifier([
            ...DEFAULT_MEMORY_TOPICS,
            ...(options.topics ?? [])
        ]);
    }

    async classify(query: string): Promise<MemoryQueryClassification> {
        const normalized = normalize(query);

        // Fast path: an unambiguous name statement/question always wins,
        // regardless of domain-word gating below.
        if (looksLikeNameStatement(query) || /\b(what is|what's|who am i)\b.*\bname\b/.test(normalized)) {
            const isQuestion = /\?|\bwhat is\b|\bwhat's\b|\bwho am i\b/.test(normalized);
            return {
                intent: isQuestion ? "read" : "write",
                metadata: { type: "personal-info", key: "user-name" },
                confidence: 1
            };
        }

        const isLanguageDomain = /\b(programming|coding)\b|\blanguage\b/.test(normalized);
        const isCountryDomain = /\bcountr(?:y|ies)\b|\btravel(?:ed|led)?\b/.test(normalized);

        const result = await this.inner.classify(query);

        if (result.metadata?.key === "preferred-programming-language" && !isLanguageDomain) {
            return { intent: "read" };
        }
        if (result.metadata?.key === "liked-countries" && !isCountryDomain) {
            return { intent: "read" };
        }

        return result;
    }
}

const VALID_INTENTS = new Set(["read", "write"]);

/**
 * LLM-backed classifier for teams that need to generalize beyond
 * hand-written patterns — arbitrary phrasing, other languages, or memory
 * domains that are impractical to enumerate as regexes. Mirrors the
 * prompting/parsing conventions used by {@link LLMMemoryExtractor} elsewhere
 * in this SDK: strict JSON output, defensive parsing, and a safe fallback
 * (never throws — an unparseable or failed response just yields a neutral
 * "read" classification, or delegates to `fallback` if provided).
 *
 * This is deliberately not the default: it costs one model call per turn.
 * Use {@link CompositeMemoryQueryClassifier} to only pay that cost when the
 * fast rule-based classifier can't confidently classify the query.
 */
export class LLMMemoryQueryClassifier implements MemoryQueryClassifier {
    private logger: Logger;

    constructor(
        private model: IModel,
        private fallback?: MemoryQueryClassifier,
        logger?: Logger
    ) {
        this.logger = logger ?? noopLogger;
    }

    async classify(query: string): Promise<MemoryQueryClassification> {
        const request = {
            system: `
You are a memory-query routing system for an AI agent's long-term memory.

Given a single user message, decide:
- "intent": "write" if the user is TELLING the agent something worth
  remembering about themselves (a fact, preference, identity detail, goal,
  etc). "read" if the user is ASKING the agent to recall something it
  should already know. null if neither applies (e.g. small talk, a question
  about something unrelated to the user).
- "type": a short lowercase category such as "personal-info", "preference",
  "project", "goal", "fact", or another concise category you invent if none
  of those fit. null if intent is null.
- "key": a short, stable, lowercase, hyphenated identifier for the specific
  piece of information (e.g. "user-name", "preferred-programming-language",
  "dietary-preference"). Use the same key you'd expect this concept to
  always use, regardless of exact wording. null if there isn't one stable
  key (e.g. broad topics like "project").

Return ONLY a single JSON object, no markdown, no explanation:
{"intent": "write" | "read" | null, "type": string | null, "key": string | null}

Examples:
"My name is Priya" -> {"intent":"write","type":"personal-info","key":"user-name"}
"What's my name?" -> {"intent":"read","type":"personal-info","key":"user-name"}
"I don't eat pork" -> {"intent":"write","type":"preference","key":"dietary-preference"}
"What's the weather like?" -> {"intent":null,"type":null,"key":null}
`.trim(),
            messages: [{ role: "user" as const, content: query }]
        };

        try {
            const response = await this.model.generate(request);
            if (!response.text) {
                return this.fallbackOrDefault(query);
            }

            const parsed = JSON.parse(response.text);
            const intent = VALID_INTENTS.has(parsed?.intent) ? (parsed.intent as "read" | "write") : undefined;
            const type = typeof parsed?.type === "string" && parsed.type.length > 0 ? parsed.type : undefined;
            const key = typeof parsed?.key === "string" && parsed.key.length > 0 ? parsed.key : undefined;

            if (!intent && !type) {
                return { intent: "read", confidence: 0.5 };
            }

            return {
                ...(intent && { intent }),
                ...(type && { metadata: { type, ...(key && { key }) } }),
                confidence: 0.8
            };
        } catch (cause) {
            this.logger.warn("LLM memory-query classification failed; falling back", { cause });
            return this.fallbackOrDefault(query);
        }
    }

    private async fallbackOrDefault(query: string): Promise<MemoryQueryClassification> {
        if (this.fallback) {
            return this.fallback.classify(query);
        }
        return { intent: "read" };
    }
}

/**
 * Tries a fast, cheap classifier first (typically {@link RuleBasedMemoryQueryClassifier}
 * / {@link DefaultMemoryQueryClassifier}) and only calls a slower, more
 * powerful one (typically {@link LLMMemoryQueryClassifier}) when the first
 * pass is inconclusive — i.e. it found neither an intent nor a metadata
 * hint. This keeps the common case (well-phrased, expected queries) at
 * near-zero added latency while still giving real-world/long-tail phrasing
 * a shot at being classified correctly.
 */
export class CompositeMemoryQueryClassifier implements MemoryQueryClassifier {
    constructor(
        private primary: MemoryQueryClassifier,
        private secondary: MemoryQueryClassifier
    ) {}

    async classify(query: string): Promise<MemoryQueryClassification> {
        const primaryResult = await this.primary.classify(query);

        // A bare `{ intent: "read" }` with no metadata and no confidence is
        // the classifiers' universal "I don't recognize this" fallback —
        // NOT a confident classification — so it's the one case that should
        // still escalate to the secondary classifier. Anything with
        // metadata, or an explicit confidence score, is treated as decided.
        const isConclusive =
            primaryResult.metadata !== undefined ||
            (primaryResult.confidence !== undefined && primaryResult.confidence > 0);

        if (isConclusive) {
            return primaryResult;
        }

        return this.secondary.classify(query);
    }
}