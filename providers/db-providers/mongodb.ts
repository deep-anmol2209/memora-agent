import { MongoClient, type Collection, type Db } from "mongodb";

import type {
    LongTermMemoryStore,
    MemoryRecord
} from "../../src/agent/types.js";

import { MemoryOperationError } from "../../src/error.js";

export interface MongoLongTermMemoryStoreOptions {
    uri?: string;
    database: string;
    collection?: string;
}

export class MongoLongTermMemoryStore
    implements LongTermMemoryStore {

    private client: MongoClient;
    private db: Db;
    private collection: Collection<MemoryRecord>;

    constructor(
        options: MongoLongTermMemoryStoreOptions
    ) {

        const uri =
            options.uri ??
            process.env.MONGODB_URI;

        if (!uri) {
            throw new Error(
                "MongoLongTermMemoryStore requires a MongoDB URI " +
                "or MONGODB_URI environment variable."
            );
        }

        this.client = new MongoClient(uri);

        this.db =
            this.client.db(options.database);

        this.collection =
            this.db.collection<MemoryRecord>(
                options.collection ?? "memories"
            );
    }

    // ============================================
    // CONNECT
    // ============================================

    async connect(): Promise<void> {

        await this.client.connect();
    }

    // ============================================
    // SET
    // ============================================

    async set(
        record: MemoryRecord
    ): Promise<void> {

        try {

            await this.collection.replaceOne(
                {
                    id: record.id
                },
                record,
                {
                    upsert: true
                }
            );

        } catch (cause) {

            throw new MemoryOperationError(
                "set",
                cause
            );
        }
    }

    // ============================================
    // GET
    // ============================================

    async get(
        id: string
    ): Promise<MemoryRecord | undefined> {

        try {

            const record =
                await this.collection.findOne({
                    id
                });

            return record ?? undefined;

        } catch (cause) {

            throw new MemoryOperationError(
                "get",
                cause
            );
        }
    }

    // ============================================
    // GET ALL
    // ============================================

    async getAll(): Promise<MemoryRecord[]> {

        try {

            return await this.collection
                .find({})
                .sort({
                    createdAt: 1
                })
                .toArray();

        } catch (cause) {

            throw new MemoryOperationError(
                "getAll",
                cause
            );
        }
    }

    // ============================================
    // DELETE
    // ============================================

    async delete(
        id: string
    ): Promise<void> {

        try {

            await this.collection.deleteOne({
                id
            });

        } catch (cause) {

            throw new MemoryOperationError(
                "delete",
                cause
            );
        }
    }

    // ============================================
    // CLEAR
    // ============================================

    async clear(): Promise<void> {

        try {

            await this.collection.deleteMany({});

        } catch (cause) {

            throw new MemoryOperationError(
                "clear",
                cause
            );
        }
    }

    // ============================================
    // CLOSE
    // ============================================

    async close(): Promise<void> {

        await this.client.close();
    }
}