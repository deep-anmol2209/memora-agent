import type { LongTermMemoryStore, MemoryRecord,  } from "../agent/types.js";

export class InMemoryLongTermMemoryStore implements LongTermMemoryStore {

    private records = new Map<string, MemoryRecord>();

    async get(sessionId: string): Promise<MemoryRecord | undefined> {
        return this.records.get(sessionId);
    }

    async getAll(): Promise<MemoryRecord[]> {
        return Array.from(this.records.values());
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