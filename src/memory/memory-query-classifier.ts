import type { MemorySearchOptions } from "../agent/types.js";

export interface MemoryQueryClassification {
    metadata?: NonNullable<MemorySearchOptions["metadata"]>;
}

export interface MemoryQueryClassifier {
    classify(
        query: string
    ): Promise<MemoryQueryClassification>;
}

export class DefaultMemoryQueryClassifier
    implements MemoryQueryClassifier {

    async classify(
        query: string
    ): Promise<MemoryQueryClassification> {

        const normalized = query.toLowerCase();

        // ----------------------------------
        // Name / personal info
        // ----------------------------------

        const nameSignals = [
            "my name",
            "what is my name",
            "who am i"
        ];

        const isNameQuery =
            nameSignals.some(
                signal => normalized.includes(signal)
            );

        if (isNameQuery) {
            return {
                metadata: {
                    type: "personal-info",
                    key: "user-name"
                }
            };
        }


        // ----------------------------------
        // Programming language preference
        // ----------------------------------

        const preferenceSignals = [
            "like",
            "likes",
            "love",
            "prefer",
            "preference",
            "favorite",
            "favourite",
            "into",
            "enjoy"
        ];

        const languageSignals = [
            "programming language",
            "programming",
            "coding language"
        ];

        const isPreference =
            preferenceSignals.some(
                signal => normalized.includes(signal)
            );

        const isLanguage =
            languageSignals.some(
                signal => normalized.includes(signal)
            );

        if (isPreference && isLanguage) {
            return {
                metadata: {
                    type: "preference",
                    key: "preferred-programming-language"
                }
            };
        }


        // ----------------------------------
        // General preference
        // ----------------------------------

        const isCountry =
            normalized.includes("country") ||
            normalized.includes("countries");

        if (isPreference && isCountry) {
            return {
                metadata: {
                    type: "preference",
                    key: "liked-countries"
                }
            };
        }


        // ----------------------------------
        // Project
        // ----------------------------------

        const projectSignals = [
            "current project",
            "working on",
            "building",
            "project"
        ];

        const isProject =
            projectSignals.some(
                signal => normalized.includes(signal)
            );

        if (isProject) {
            return {
                metadata: {
                    type: "project"
                }
            };
        }


        // ----------------------------------
        // Goal
        // ----------------------------------

        const goalSignals = [
            "my goal",
            "current goal",
            "what am i trying to achieve",
            "what do i want to achieve"
        ];

        const isGoal =
            goalSignals.some(
                signal => normalized.includes(signal)
            );

        if (isGoal) {
            return {
                metadata: {
                    type: "goal"
                }
            };
        }


        // ----------------------------------
        // No classification
        // ----------------------------------

        return {};
    }
}