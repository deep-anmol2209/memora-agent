import {
    Pinecone,
    type Index,
    type RecordMetadata
} from "@pinecone-database/pinecone";

import type {
    VectorRecord,
    VectorSearchOptions,
    VectorSearchResult,
    VectorStore
} from "../../src/agent/types.js";


export interface PineconeVectorStoreOptions {

    /**
     * Pinecone API key.
     * Falls back to PINECONE_API_KEY.
     */
    apiKey?: string;

    /**
     * Pinecone index name.
     */
    indexName: string;

    /**
     * Optional namespace.
     */
    namespace?: string;

    /**
     * Optional index host.
     *
     * Recommended for production.
     */
    host?: string;
}


export class PineconeVectorStore
    implements VectorStore {

    private readonly index:
        Index<RecordMetadata>;

    /*
     * Do NOT make this namespace?: string.
     *
     * exactOptionalPropertyTypes can complain when
     * assigning undefined to an optional property.
     */
    private readonly namespace:
        string | undefined;


    constructor(
        options: PineconeVectorStoreOptions
    ) {

        const apiKey =
            options.apiKey ??
            process.env.PINECONE_API_KEY;

        if (!apiKey) {
            throw new Error(
                "PineconeVectorStore requires a apiKey " +
                "or PINECONE_API_KEY environment variable."
            );
        }

        if (!options.indexName) {
            throw new Error(
                "PineconeVectorStore requires an indexName."
            );
        }


        const pinecone =
            new Pinecone({
                apiKey
            });


        /*
         * Current Pinecone SDK supports targeting an index
         * by name or host.
         */
        this.index =
            options.host
                ? pinecone.index<RecordMetadata>({
                    host: options.host
                })
                : pinecone.index<RecordMetadata>({
                    name: options.indexName
                });


        this.namespace =
            options.namespace;
    }


    // ==================================================
    // UPSERT
    // ==================================================

    async upsert(
        record: VectorRecord
    ): Promise<void> {
// console.log("upsering in vector store ", record);

        await this.index.upsert({

            records: [
                {
                    id: record.id,

                    values:
                        record.vector,

                    ...(record.metadata !== undefined && {
                        metadata:
                            record.metadata as RecordMetadata
                    })
                }
            ],

            ...(this.namespace !== undefined && {
                namespace:
                    this.namespace
            })
        });
    }


    // ==================================================
    // SEARCH
    // ==================================================

    async search(
        vector: number[],
        options: VectorSearchOptions = {
            limit: 10
        }
    ): Promise<VectorSearchResult[]> {

        const filter: Record<string, unknown> = {};


        if (
            options.userId !== undefined
        ) {

            filter.userId = {
                $eq:
                    options.userId
            };
        }


        if (
            options.sessionId !== undefined
        ) {

            filter.sessionId = {
                $eq:
                    options.sessionId
            };
        }

  const start = Date.now();
        const response =
            await this.index.query({

                vector,

                topK:
                    options.limit,

                includeMetadata:
                    true,

                ...(Object.keys(filter).length > 0 && {
                    filter
                }),

                ...(this.namespace !== undefined && {
                    namespace:
                        this.namespace
                })
            });

            console.log("pinecone query:", Date.now() - start, "ms")
            


        return response.matches.map(
            match => ({

                id:
                    match.id,

                score:
                    match.score ?? 0,

                ...(match.metadata !== undefined && {
                    metadata:
                        match.metadata
                })
            })
        );
    }


    // ==================================================
    // DELETE
    // ==================================================

    async delete(
        id: string
    ): Promise<void> {

        await this.index.deleteOne({

            id,

            ...(this.namespace !== undefined && {
                namespace:
                    this.namespace
            })
        });
    }


    // ==================================================
    // CLEAR
    // ==================================================

    async clear(): Promise<void> {

        /*
         * Deletes all vectors from ONLY the configured
         * namespace.
         *
         * It does not delete the Pinecone index.
         */
        await this.index.deleteAll({

            ...(this.namespace !== undefined && {
                namespace:
                    this.namespace
            })
        });
    }
}