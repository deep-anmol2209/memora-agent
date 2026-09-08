import neo4j, { type Driver } from "neo4j-driver";
import type { LongTermMemoryStore, MemoryRecord, MemoryGraphReference, MemoryGraphSearchOptions, GraphStore, MemorySearchOptions } from "../../src/agent/types.js";
import { noopLogger, type Logger } from "../../src/logger.js";
import { MemoryOperationError } from "../../src/error.js";
import { getCurrentTracer } from "../../src/tracing/context.js";

export interface Neo4jLongTermMemoryStoreOptions {
    /** Provide an existing driver (recommended — lets you share/pool connections and makes testing easy). */
    driver?: Driver;
    /** Falls back to NEO4J_URI/NEO4J_USERNAME/NEO4J_PASSWORD env vars if no driver is provided. */
    uri?: string;
    username?: string;
    password?: string;
    logger?: Logger;
}

export class Neo4jLongTermMemoryStore implements LongTermMemoryStore, GraphStore {

    private driver: Driver;
    private logger: Logger;

    constructor(options: Neo4jLongTermMemoryStoreOptions = {}) {
        this.logger = options.logger ?? noopLogger;

        if (options.driver) {
            this.driver = options.driver;
            return;
        }

        const uri = options.uri ?? process.env.NEO4J_URI;
        const username = options.username ?? process.env.NEO4J_USERNAME;
        const password = options.password ?? process.env.NEO4J_PASSWORD;

        if (!uri || !username || !password) {
            throw new Error(
                "Neo4jLongTermMemoryStore needs a `driver`, or `uri`/`username`/`password` " +
                "(directly or via NEO4J_URI/NEO4J_USERNAME/NEO4J_PASSWORD env vars)."
            );
        }

        this.driver = neo4j.driver(
            uri,
            neo4j.auth.basic(
                username,
                password
            ),{
                maxConnectionPoolSize: 50,
                connectionAcquisitionTimeout: 300000
            }
        );
    }

async set(record: MemoryRecord): Promise<void> {

    const session = this.driver.session();
    const tracer = getCurrentTracer();

    try {

        // ----------------------------------
        // 1. Store Memory node
        // ----------------------------------

        const memorySetSpan =
            tracer?.startSpan("neo4j.memory.set");

        try {

            await session.run(
                `
                MERGE (m:Memory {id: $id})

                SET
                    m.content = $content,
                    m.key = $key,
                    m.strategy = $strategy,
                    m.type = $type,
                    m.userId = $userId,
                    m.sessionId = $sessionId,
                    m.createdAt = $createdAt,
                    m.updatedAt = $updatedAt
                `,
                {
                    id: record.id,
                    content: record.content,
                    key: record.key ?? null,
                    strategy: record.strategy ?? null,

                    type: record.metadata?.type ?? null,
                    userId: record.metadata?.userId ?? null,
                    sessionId: record.metadata?.sessionId ?? null,

                    createdAt:
                        record.createdAt?.toISOString()
                        ?? new Date().toISOString(),

                    updatedAt:
                        record.updatedAt?.toISOString()
                        ?? new Date().toISOString()
                }
            );


        
        } catch (error) {
            memorySetSpan?.recordError(error);
            throw error;
        } finally {
            memorySetSpan?.end();
        }


        // ----------------------------------
        // 2. Store explicit graph references
        // ----------------------------------

        if (record.graph) {

            for (const reference of record.graph) {

                // Prevent invalid Cypher identifiers
                const validName =
                    /^[A-Za-z_][A-Za-z0-9_]*$/;

                if (
                    !validName.test(reference.entityType) ||
                    !validName.test(reference.relation)
                ) {
                    throw new Error(
                        `Invalid graph entity type or relation`
                    );
                }

                const graphReferenceSpan =
                    tracer?.startSpan("neo4j.graph.reference.set");

                try {
                    await session.run(
                        `
                        MERGE (e:${reference.entityType} {
                            id: $entityId
                        })

                        MATCH (m:Memory {
                            id: $memoryId
                        })

                        MERGE (e)-[:${reference.relation}]->(m)
                        `,
                        {
                            entityId: reference.entityId,
                            memoryId: record.id
                        }
                    );

                    graphReferenceSpan?.setAttribute(
                        "graph.entityType",
                        reference.entityType
                    );

                    graphReferenceSpan?.setAttribute(
                        "graph.relation",
                        reference.relation
                    );
                } catch (error) {
                    graphReferenceSpan?.recordError(error);
                    throw error;
                } finally {
                    graphReferenceSpan?.end();
                }
            }
        }


        // ----------------------------------
        // 3. Default User -> Memory relation
        // ----------------------------------

        const userId = record.metadata?.userId;

        if (userId) {

            const userRelationSpan =
                tracer?.startSpan("neo4j.user.relation.set");

            try {
                await session.run(
                    `
                    MERGE (u:User {
                        id: $userId
                    })

                    MATCH (m:Memory {
                        id: $memoryId
                    })

                    MERGE (u)-[:HAS_MEMORY]->(m)
                    `,
                    {
                        userId,
                        memoryId: record.id
                    }
                );
            } catch (error) {
                userRelationSpan?.recordError(error);
                throw error;
            } finally {
                userRelationSpan?.end();
            }
        }

    } catch (cause) {

        if (
            cause instanceof Error &&
            cause.message.startsWith("Invalid graph")
        ) {
            throw cause;
        }

        throw new MemoryOperationError("set", cause);

    } finally {
        await session.close();
    }
}

async get(
    id: string
): Promise<MemoryRecord | undefined> {

    const session = this.driver.session();

    try {

        const result = await session.run(
            `
            MATCH (m:Memory {id: $id})
            RETURN m
            `,
            { id }
        );

        if (result.records.length === 0) {
            return undefined;
        }

        const node =
            result.records[0]!.get("m");

        const properties = node.properties;

        return {
            id: properties.id,
            content: properties.content,
            key: properties.key ?? undefined,
            strategy: properties.strategy ?? undefined,

            metadata: {
                type: properties.type ?? undefined,
                userId: properties.userId ?? undefined,
                sessionId: properties.sessionId ?? undefined
            },

            createdAt: new Date(properties.createdAt),
                    

            updatedAt: new Date(properties.updatedAt)
       
        };

    } catch (cause) {
        throw new MemoryOperationError("get", cause);
    } finally {

        await session.close();
    }
}

async getAll(): Promise<MemoryRecord[]> {

    const session = this.driver.session();

    try {

        const result = await session.run(
            `
            MATCH (m:Memory)
            RETURN m
            ORDER BY m.createdAt ASC
            `
        );

        return result.records.map(record => {

            const node =
                record.get("m");

            const properties =
                node.properties;

            return {
                id: properties.id,
                content: properties.content,
                key: properties.key ?? undefined,
                strategy: properties.strategy ?? undefined,

                metadata: {
                    type: properties.type ?? undefined,
                    userId: properties.userId ?? undefined,
                    sessionId: properties.sessionId ?? undefined
                },

                createdAt:
                    new Date(properties.createdAt),

                updatedAt:
                    new Date(properties.updatedAt)
            };
        });

    } catch (cause) {
        throw new MemoryOperationError("getAll", cause);
    } finally {

        await session.close();
    }
}

async searchByMetadata(
    metadata: MemorySearchOptions["metadata"],
    options: Pick<
        MemorySearchOptions,
        "userId" | "sessionId" | "limit"
    > = {}
): Promise<MemoryRecord[]> {

    const session = this.driver.session();

    try {

        const conditions: string[] = [];
        const params: Record<string, unknown> = {};

        if (metadata?.type !== undefined) {
            conditions.push("m.type = $type");
            params.type = metadata.type;
        }

        if (metadata?.key !== undefined) {
            conditions.push("m.key = $key");
            params.key = metadata.key;
        }

        if (options.userId !== undefined) {
            conditions.push("m.userId = $userId");
            params.userId = options.userId;
        }

        if (options.sessionId !== undefined) {
            conditions.push("m.sessionId = $sessionId");
            params.sessionId = options.sessionId;
        }

        for (const [key, value] of Object.entries(metadata ?? {})) {

            if (
                key === "type" ||
                key === "key" ||
                value === undefined
            ) {
                continue;
            }

            const validName =
                /^[A-Za-z_][A-Za-z0-9_]*$/;

            if (!validName.test(key)) {
                throw new Error(
                    `Invalid metadata key: ${key}`
                );
            }

            conditions.push(`m.${key} = $metadata_${key}`);
            params[`metadata_${key}`] = value;
        }

        const where =
            conditions.length > 0
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

        const result = await session.run(
            `
            MATCH (m:Memory)
            ${where}
            RETURN m
            LIMIT $limit
            `,
            {
                ...params,
                limit: options.limit ?? 10
            }
        );

        return result.records.map(record => {

            const properties =
                record.get("m").properties;

            return {
                id: properties.id,
                content: properties.content,
                key: properties.key ?? undefined,
                strategy: properties.strategy ?? undefined,

                metadata: {
                    type: properties.type ?? undefined,
                    userId: properties.userId ?? undefined,
                    sessionId: properties.sessionId ?? undefined
                },

                createdAt:
                    new Date(properties.createdAt),

                updatedAt:
                    new Date(properties.updatedAt)
            };
        });

    } catch (cause) {

        throw new MemoryOperationError(
            "searchByMetadata",
            cause
        );

    } finally {

        await session.close();
    }
}
async clear(): Promise<void> {

    const session = this.driver.session();

    try {

        await session.run(
            `
            MATCH (m:Memory)
            DETACH DELETE m
            `
        );

    } catch (cause) {
        throw new MemoryOperationError("clear", cause);
    } finally {

        await session.close();
    }
}


async delete(id: string): Promise<void> {

    const session = this.driver.session();

    try {

        await session.run(
            `
            MATCH (m:Memory {id: $id})
            DETACH DELETE m
            `,
            { id }
        );

    } catch (cause) {
        throw new MemoryOperationError("delete", cause);
    } finally {

        await session.close();
    }
}
async verifyConnection(): Promise<void> {
  await this.driver.verifyConnectivity();

  // Extra: ek simple query chala ke query path bhi warm-up ho jaye
  const session = this.driver.session();
  try {
    await session.run(`RETURN 1`);
  } finally {
    await session.close();
  }

  this.logger.info("Neo4j connection successful");
}

    async close(): Promise<void> {
        await this.driver.close();
    }

    async search(
    options: MemoryGraphSearchOptions
): Promise<MemoryRecord[]> {

    const session = this.driver.session();

    try {

        const validName =
    /^[A-Za-z_][A-Za-z0-9_]*$/;

if (!validName.test(options.entityType)) {
    throw new Error(
        `Invalid graph entity type: ${options.entityType}`
    );
}

if (
    options.relation &&
    !validName.test(options.relation)
) {
    throw new Error(
        `Invalid graph relation: ${options.relation}`
    );
}

        const relationPattern = options.relation
            ? `-[r:${options.relation}]->`
            : `-[r]->`;

        const result = await session.run(
            `
            MATCH (e:${options.entityType} {id: $entityId})
                  ${relationPattern}
                  (m:Memory)

            RETURN m
            `,
            {
                entityId: options.entityId
            }
        );

        return result.records.map(record => {

            const m = record.get("m").properties;

            return {
                id: m.id,
                content: m.content,
                key: m.key ?? undefined,
                strategy: m.strategy ?? undefined,

                metadata: {
                    type: m.type ?? undefined,
                    userId: m.userId ?? undefined,
                    sessionId: m.sessionId ?? undefined
                },

                createdAt: new Date(m.createdAt),
                        
                updatedAt: new Date(m.updatedAt)
                       
            };
        });

    } catch (cause) {
        if (cause instanceof Error && cause.message.startsWith("Invalid graph")) {
            throw cause;
        }
        throw new MemoryOperationError("search", cause);
    } finally {

        await session.close();
    }
}
}