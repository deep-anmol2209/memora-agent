import { MongoClient, type Collection, type Db } from "mongodb";

import type {
    LongTermMemoryStore,
    MemoryRecord,
    MemorySearchOptions
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

    const start = Date.now();

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
    // GET MANY
    // ============================================

    async getMany(ids: string[]): Promise<MemoryRecord[]> {
        const start = Date.now();

        try {
            const records = await this.collection
                .find({ id: { $in: ids } })
                .toArray();

        

            return records;

        } catch (cause) {
         
            throw new MemoryOperationError("getMany", cause);
        }
    }

async searchByMetadata(
    metadata: MemorySearchOptions["metadata"],
    options: Pick<
        MemorySearchOptions,
        "userId" | "sessionId" | "limit"
    > = {}
): Promise<MemoryRecord[]> {

    try {

        const filter: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(metadata ?? {})) {

            if (value === undefined) {
                continue;
            }

            if (key === "key") {
                filter.key = value;
            } else {
                filter[`metadata.${key}`] = value;
            }
        }

        if (options.userId !== undefined) {
            filter["metadata.userId"] = options.userId;
        }

        if (options.sessionId !== undefined) {
            filter["metadata.sessionId"] = options.sessionId;
        }

        const limit = options.limit ?? 10;

        let results = await this.collection
            .find(filter)
            .limit(limit)
            .toArray();

        if (results.length === 0 && filter.key && metadata?.type) {
            const fallbackFilter = { ...filter };
            delete fallbackFilter.key;
            results = await this.collection
                .find(fallbackFilter)
                .limit(limit)
                .toArray();
        }

        return results;

    } catch (cause) {

        throw new MemoryOperationError(
            "searchByMetadata",
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