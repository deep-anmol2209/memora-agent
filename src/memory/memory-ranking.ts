export interface MemoryScore {
    id: string;
    keywordScore: number;
    semanticScore: number;
    finalScore: number;
}

export function calculateMemoryScore(
    keywordScore: number,
    semanticScore: number,
    metadataScore: number,
    keywordWeight = 0.3,
    semanticWeight = 0.5,
    metadataWeight=0.2
): number {

    return (
        keywordScore * keywordWeight +
        semanticScore * semanticWeight +
        metadataScore * metadataWeight
    );
}

export function calculateKeywordScore(
    query: string,
    content: string
): number {

    const stopWords = new Set([
        "what",
        "which",
        "who",
        "whom",
        "where",
        "when",
        "why",
        "how",
        "do",
        "does",
        "did",
        "is",
        "are",
        "am",
        "was",
        "were",
        "the",
        "a",
        "an",
        "i",
        "me",
        "my",
        "you",
        "your",
        "we",
        "our",
        "to",
        "for",
        "of",
        "in",
        "on",
        "with",
        "and",
        "or",
        "can",
        "should"
    ]);

    const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .map(word =>
            word.replace(/[^\w-]/g, "")
        )
        .filter(word =>
            word.length > 0 &&
            !stopWords.has(word)
        );

    const contentWords = content
        .toLowerCase()
        .split(/\s+/)
        .map(word =>
            word.replace(/[^\w-]/g, "")
        )
        .filter(Boolean);

    if (queryWords.length === 0) {
        return 0;
    }

    const matchedWords =
        queryWords.filter(queryWord =>
            contentWords.some(contentWord =>
                contentWord === queryWord ||
                contentWord.includes(queryWord) ||
                queryWord.includes(contentWord)
            )
        );

    return (
        matchedWords.length /
        queryWords.length
    );
}