import type {
    MemoryManagerConfig,
    MemoryRecord,
    MemorySearchOptions,
    Message,
    MemoryContext
} from "../agent/types.js";

export class MemoryManager {

    constructor(
        private config: MemoryManagerConfig = {}
    ) {}

    get shortTerm() {
        return this.config.shortTerm;
    }

    get longTerm() {
        return this.config.longTerm;
    }

    get extractor() {
        return this.config.extractor;
    }

    get graph(){
        return this.config.graph;
    }

    async extractAndRemember(
        messages: Message[],
        context: MemoryContext
    ): Promise<void> {
    //    console.log("Extractor input:");
    //    console.dir(messages, {depth: null})
       
        if (
            !this.config.extractor ||
            !this.config.longTerm
        ) {
            return;
        }

        const memories =
            await this.config.extractor.extract(messages);
            // console.log("memory: ", memories);
            

        for (const memory of memories) {
            await this.config.longTerm.remember({
                ...memory,
                metadata:{
                    ...memory.metadata,

                    ...(context.userId !== undefined && {
                        userId: context.userId
                    }),

                    ...(context.sessionId !== undefined && {
                        sessionId: context.sessionId
                    })
                },

                  ...(context.userId !== undefined && {
                              
                graph: [
                    {
                        entityType: "User",
                        entityId: context.userId,
                        relation: "HAS_MEMORY"
                    }
                ]
                    }),
         
            })
        }
    }

    async remember(
    record: MemoryRecord
): Promise<void> {

    if (!this.config.longTerm) {
        throw new Error(
            "Long-term memory is not configured"
        );
    }

    await this.config.longTerm.remember(record);
}

async search(
    query: string,
    options?: MemorySearchOptions
): Promise<MemoryRecord[]> {

    if (!this.config.longTerm) {
        return [];
    }

    return this.config.longTerm.search(
        query,
        options
    );
}

async forget(
    id: string
): Promise<void> {

    if (!this.config.longTerm) {
        return;
    }

    await this.config.longTerm.forget(id);
}

async clearLongTerm(): Promise<void> {

    if (!this.config.longTerm) {
        return;
    }

    await this.config.longTerm.clear();
}
}