import type { LongTermMemoryStore, MemoryRecord, MemorySearchOptions  } from "../agent/types.js";

export class InMemoryLongTermMemoryStore implements LongTermMemoryStore {

    private records = new Map<string, MemoryRecord>();

    async get(sessionId: string): Promise<MemoryRecord | undefined> {
        return this.records.get(sessionId);
    }

    async getAll(): Promise<MemoryRecord[]> {
        return Array.from(this.records.values());
    }

    async getMany(ids: string[]): Promise<MemoryRecord[]> {
        const out: MemoryRecord[] = [];
        for (const id of ids) {
            const r = this.records.get(id);
            if (r) out.push(r);
        }
        return out;
    }

async searchByMetadata(
    metadata: MemorySearchOptions["metadata"],
    options: Pick<
        MemorySearchOptions,
        "userId" | "sessionId" | "limit"
    > = {}
): Promise<MemoryRecord[]> {

    const results = Array.from(
        this.records.values()
    ).filter(memory => {

        if (
            options.userId !== undefined &&
            memory.metadata?.userId !== options.userId
        ) {
            return false;
        }

        if (
            options.sessionId !== undefined &&
            memory.metadata?.sessionId !== options.sessionId
        ) {
            return false;
        }

        if (
            metadata?.type !== undefined &&
            memory.metadata?.type !== metadata.type
        ) {
            return false;
        }

        if (
            metadata?.key !== undefined &&
            memory.key !== metadata.key
        ) {
            return false;
        }

        for (const [key, value] of Object.entries(metadata ?? {})) {

            if (
                key === "type" ||
                key === "key" ||
                value === undefined
            ) {
                continue;
            }

            if (memory.metadata?.[key] !== value) {
                return false;
            }
        }

        return true;
    });

    return results.slice(
        0,
        options.limit ?? 10
    );
}

    async set(record: MemoryRecord): Promise<void> {
        this.records.set(record.id, record);
    }

    async delete(id: string): Promise<void> {
        this.records.delete(id);
    }

    async clear(): Promise<void> {
        this.records.clear();
    }
}