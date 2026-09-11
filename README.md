# Memora-agent

A TypeScript SDK for building AI agents that can use tools, remember information, and retrieve relevant memories when needed.

It provides the building blocks for creating agents that can:

- Talk with users
- Call tools and use their results
- Remember important information across conversations
- Search memories using meaning and keywords
- Store memories in databases and vector stores
- Handle changing or conflicting information
- Keep memories separated between users and sessions
- Use graph relationships when connected information matters

## What can you build with it?

You can use the SDK to build things like:

- AI assistants that remember users
- Customer support agents
- Personal AI assistants
- Coding agents
- Business automation agents
- Agents that work with your own tools and data

# Install
```text
npm i memora-agent
```
## 1. Create an Agent

The Agent is the main part of the SDK. It connects the AI model with instructions, tools, memory, and other features.

Use it when you want to create an AI agent that can understand a user's message and respond to it.

### Example

```ts
import {Agent} from "memora-agent"
import {GroqModel} from "memora-agent/groq"

const model= new GroqModel({
   apiKey: "your api key",
   model: "model_name"
})

const agent = new Agent({
    model,
    instructions: "You are a helpful assistant."
});

const response = await agent.run(
    "Hello, how are you?"
);
```

## 2. Tools

Tools allow an agent to perform actions instead of only generating text.

You can give an agent functions for things like getting weather, performing calculations, searching data, calling an API, or doing any other task your application needs.

### Example

```ts
import {defineTool} from "memora-agent"

const addTool = tool({
    name: "add",
    description: "Add two numbers",

    inputSchema: z.object({
        a: z.number(),
        b: z.number()
    }),

    outputSchema: z.object({
        sum: z.number()
   }),
    execute: async ({ a, b }) => {
        return {
           sum: a+b
        };
    }
});

const agent = new Agent({
    model,
    instructions: "You are a helpful assistant with tools use that 
    tools to ansswer users query if needed.",
    tools: [addTool],
    maxToolIterations: 2  // default value is 5 
});
```


# Structured Output

Structured Output allows an agent to return responses that follow a predefined schema instead of returning free-form text.

You can define the expected output using a Zod schema. The agent can then generate structured, predictable data that can be safely consumed by your application.

## Example

```ts
import { Agent } from "memora-agent";
import {GroqModel} from "memora-agent/groq"
import { z } from "zod";
import "dotenv/config";

const model = new GroqModel({
    model: "openai/gpt-oss-20b",
    apiKey: "your api key"
});

// Define the expected output structure
const TicketSchema = z.object({
    category: z.enum([
        "billing",
        "technical",
        "account",
        "shipping",
        "other"
    ]),
    priority: z.enum([
        "low",
        "medium",
        "high",
        "urgent"
    ]),
    summary: z.string(),
    sentiment: z.enum([
        "positive",
        "neutral",
        "negative"
    ]),
    requiresHuman: z.boolean()
});

const agent = new Agent({
    model,

    instructions: `
        You are a customer support assistant.
        Analyze the user's support request and classify it
        according to the provided structured output schema.
    `,
    structuredOutput: TicketSchema
});

const result = await agent.run(
    "My payment was charged twice and I need a refund."
);

console.log(result);
```

## 3. Sessions

Sessions allow an agent to keep track of a conversation between multiple messages.

A session represents a single conversation, while the user ID can be used to keep a user's data separate from other users.

### Example

```ts
const chat = agent.session(
    "session-1",
    "user-1"
);

await chat.run(
    "My name is Anmol."
);

const response = await chat.run(
    "What is my name?"
);

console.log(response);
```
The agent can use the previous message from the same session to understand the second message.

You can create another session for a different conversation:
```ts
const newChat = agent.session(
    "session-2",
    "user-1"
);
```
This keeps the conversation history of session-1 separate from session-2.

Sessions are useful when you want the agent to maintain separate conversations for the same or different users.

## 4. Short-Term Memory

Short-term memory allows the agent to remember the conversation while the current session is active.

It is useful when the agent needs to understand previous messages instead of treating every message as a new conversation.

### Example

```ts
import { InMemoryStore } from "memora-agent";

const shortTermMemory = new InMemoryStore();

const agent = new Agent({

    memory{
      shortTerm: shortTermMemory
   }
})
const chat = agent.session(
    "session-1",
    "user-1"
);

await chat.run(
    "My name is Anmol."
);

const response = await chat.run(
    "What is my name?"
);
```




## 5  . Long-Term Memory

Long-term memory allows the agent to remember important information even after a conversation ends.

It is useful for information that should be available in future conversations, such as a user's name, preferences, goals, or projects.

### Example

```ts
import {InMemoryLongTermMemory} from "memora-agent"
import { MongoLongTermMemoryStore } from "memora-agent/mongodb";


const mongodbStore= new MongoLongTermMemoryStore({
    uri: process.env.MONGO_DB_URI,    //mongodb connection string
    database: process.env.MONGO_DB    //your db name
})

const longtermMemory= new InMemoryLongTermMemory({
    store: mongodbStore, 
})

const agent = new Agent({
    model,
    instructions: "You are a helpful assistant.",
    memory: {
        longTerm: longtermMemory
    }
});
```

## 6. Memory Extraction

Memory extraction finds important information from a conversation and turns it into a memory that can be saved for later.

For example, if a user says:

```text
"My name is Anmol and I prefer TypeScript."
```
The extractor can turn this into memories like: 

```text
User's name is Anmol
User prefers TypeScript
```
These memories can then be stored in long-term memory.

### Example

```ts
import {LLMMemoryExtractor} from "memora-agent"
import {GroqModel} from "memora-agent/groq"

const model= new GroqModel({
    apiKey: process.env.GROQ_API_KEY,
    model: "openai/gpt-oss-20b"
})
const extractor = new LLMMemoryExtractor(model);

const agent = new Agent({
    model,
    instructions: "You are a helpful assistant.",
    memory: {
        longTerm,
        extractor
    }
});
```

The extractor is important when you want to automatically decide what information from a conversation is worth remembering.

## 7. Memory Storage

The SDK can store long-term memories using different storage systems.

This allows you to choose where your agent's memories should be saved based on your application's needs.


**Note:** We are currently supporting MongoDb and Neo4j only.

### Example

#### Mongodb

```ts
import {InMemoryLongTermMemory} from "memora-agent"
import { MongoLongTermMemoryStore } from "memora-agent/mongodb";

const mongoStore= new MongoLongTermMemoryStore({
    uri: process.env.MONGO_DB_URI,    //mongodb connection string
    database: process.env.MONGO_DB    //your db name
})
const longTerm = new InMemoryLongTermMemory({
    store: mongoStore
});
```

#### Neo4j

```ts
import {InMemoryLongTermMemory} from "memora-agent"
import { Neo4jLongTermMemoryStore } from "memora-agent/neo4j";

const neo4j= new Neo4jLongTermMemoryStore({
    uri: process.env.NEO4J_URI!,
    username: process.env.NEO4J_USERNAME!,
    password: process.env.NEO4J_PASSWORD!
})
const longTerm = new InMemoryLongTermMemory({
    store: neo4j
});
```
The storage layer keeps the actual memory data, such as:
```text
User's name is Anmol
User prefers TypeScript
User is building an AI SDK
```
This is useful when you want memories to remain available after the application restarts.

## 8. Embeddings

Embeddings convert text into numbers that represent its meaning.

The SDK uses embeddings to find memories that are similar in meaning, even when the words are different.

### Example

A user previously says:

```text
"I really enjoy TypeScript."
```
Later they ask:
```text
"Which programming language do I like?"
```
The wording is different, but their meaning is similar. An embedding model can help the SDK find the correct memory.

#### Setup
```ts
import { OllamaEmbeddingProvider, EmbeddingMemorySimilarity } from "memora-agent";

const embedding = new OllamaEmbeddingProvider({
    model: "nomic-embed-text"
});

const similarity = new EmbeddingMemorySimilarity(embedding)

const longtermMemory = new InMemoryLongTermMemory({
    store: neo4j,
    similarity: similarity,
    options:{
        semanticSimilarityThreshold: 0.85
       }
})
```
**Note**: currently this SDK supports embedding model from ollama ("nomic-embed-text")       run it locally on your machine and use it   

Embeddings are useful when you want your agent to find relevant memories based on meaning rather than exact words.

## 9. Vector Store

A vector store saves embeddings and helps the agent quickly find memories that are similar to a user's query.

The SDK supports vector stores such as Pinecone and can also work with an in-memory vector store.

### Example

```ts
import {PineconeVectorStore} from "memora-agent/pinecone"
import { OllamaEmbeddingProvider} from "memora-agent";
const embeddings = new OllamaEmbeddingProvider({
    model: "nomic-embed-text"
});
const pineconeStore = new PineconeVectorStore({
    apiKey: "your pinecone api key",
    indexName: "your index name"
});

const longtermMemory = new InMemoryLongTermMemory({
    store: "your db",
    embedding: embeddings,
    vectorStore: pineconeStore
})
```
When a memory is saved:
```
                            User prefers TypeScript
                                      ↓
                                   Embedding
                                      ↓
                                    Vector
                                      ↓
                                   VectorDb
```

Later, when the user asks:
```
"Which programming language do I prefer?"
```
the SDK creates an embedding for the query and searches the vector store for similar memories.

Vector stores are useful when you have many memories and need to find relevant ones efficiently.

#### Tuning vector candidate size

By default the SDK asks the vector store for a modest number of candidates per search to balance recall and latency. You can tune the per-search multiplier with `vectorTopKMultiplier` on `MemorySearchOptions`:

```ts
const memories = await longTermMemory.search(
    "Which programming language do I like?",
    { limit: 5, vectorTopKMultiplier: 3 }
);
```

The SDK computes `topK = Math.max(limit * vectorTopKMultiplier, 20)`. Lowering the multiplier reduces vector and DB work; raising it increases recall at the cost of latency.

## 10. Semantic Search

Semantic search finds memories based on their meaning instead of requiring the exact same words.

It works together with embeddings and a vector store to find the most relevant memories for a query.

### Example

A stored memory says:

```text
"I enjoy working with TypeScript."
```
The user later asks:
```text
"What programming language do I like?"
```
Even though the wording is different, semantic search can find the stored memory because both sentences have a similar meaning.

#### Example
```ts
const memories = await longTermMemory.search(
    "What programming language do I like?",
    {
        userId: "user-1",
        limit: 5
    }
);
```
Semantic search is useful when the user's query and the stored memory use different words but have the same meaning.

## 11. Hybrid Search

Hybrid search combines different ways of finding memories to improve the results.

The SDK can use:

- Keyword matching
- Semantic similarity
- Metadata matching

The results are combined and ranked to find the most relevant memories.

### Example

```ts
import { DefaultMemoryQueryClassifier } from "memora-agent";

const queryClassifier= new DefaultMemoryQueryClassifier()

const longTerm = new InMemoryLongTermMemory({
    store: mongoStore,
    embedding,
    vectorStore,
    queryClassifier
});

const memories = await longTerm.search(
    "What programming language do I prefer?",
    {
        userId: "user-1",
        limit: 5,
        metadata: {
            type: "preference",
            key: "preferred-programming-language"
        }
    }
);

console.log(memories);
```
Here, the search uses the query's meaning, matching words, and the provided metadata to find relevant memories.

Metadata can be used to narrow the search to a specific type or key.
Hybrid search is useful when one search method alone may not be enough to find the best memory.

And separately, your QueryClassifier can automatically provide that metadata, so the developer doesn't always have to manually pass it

## 12. Query Classification

Query classification helps the SDK understand what type of memory a user is asking for.

It can identify useful information from a query and use it as a filter when searching memories.

### Example

```ts
const queryClassifier =
    new DefaultMemoryQueryClassifier();

const longTerm = new InMemoryLongTermMemory({
    store: mongoStore,
    embedding,
    vectorStore,
    queryClassifier
});

const memories = await longTerm.search(
    "What is my name?",
    {
        userId: "user-1",
        limit: 5
    }
);

console.log(memories);
```
For example, the classifier can turn:
```text
"What is my name?"
```
into:
```ts
{
    metadata: {
        type: "personal-info",
        key: "user-name"
    }
}
```
The search can then focus on memories that match this information.
Query classification is useful when you want the SDK to automatically narrow memory searches based on what the user is asking.

## 13. Memory Similarity

Memory similarity compares a query with stored memories and gives them a similarity score.

It is useful as an alternative when a vector store is not being used.

### Example

```ts
const longTerm = new InMemoryLongTermMemory({
    store: memoryStore,
    similarity: new YourMemorySimilarity()
});

const memories = await longTerm.search(
    "What programming language do I like?",
    {
        userId: "user-1",
        limit: 5
    }
);

console.log(memories);
```
The SDK compares the query with stored memories and uses the similarity score to rank the results.

Memory similarity is useful when you want meaning-based memory search without using a separate vector store

## 14. Memory Deduplication and Contradictions

When a new memory is created, the SDK checks whether similar information is already stored.

This helps prevent duplicate memories and handles situations where new information conflicts with an existing memory.

### Semantic Similarity Threshold

The semanticSimilarityThreshold controls how similar two memories must be before they are treated as duplicates.

For example, these memories have almost the same meaning:

```text
"I like TypeScript."

"I really enjoy using TypeScript."
```
A similarity threshold can help the SDK recognize them as the same information instead of storing both.
### Example
```ts
const longTerm = new InMemoryLongTermMemory({
    store: mongoStore,
    embedding,
    vectorStore,
    options: {
        semanticSimilarityThreshold: 0.85
    }
});
```
A higher threshold means the memories need to be more similar to be considered duplicates.
A lower threshold makes the check more relaxed, so memories that are somewhat similar may also be treated as duplicates.

When should you use it?

Use semantic similarity when the same information can be written in different ways.
### For example:
```text
"I love TypeScript."
"I really enjoy TypeScript."
```
These are different sentences but express the same idea.
If you do not want repeated memories like these, enable semantic similarity checking.

#### Contradiction Detection

Semantic similarity and contradiction detection solve different problems.
Semantic similarity asks:
"Is this basically the same information?"
```text
"I like TypeScript."
"I really enjoy TypeScript."

→ Similar information
```
##### Contradiction detection asks:
"Does this new information conflict with the existing information?"
```text
"I prefer Python."
"I prefer TypeScript now."

→ Conflicting information
```
### Example
```ts
const longTerm = new InMemoryLongTermMemory({
    store: mongoStore,
    embedding,
    vectorStore,
    contradictionDetector,
    options: {
        semanticSimilarityThreshold: 0.85,
        contradictionStrategy: "replace"
    }
});
```
Here:
semanticSimilarityThreshold helps prevent duplicate memories.
contradictionDetector checks whether new information conflicts with existing information.

contradictionStrategy decides what to do when a contradiction is found.
Choosing a Contradiction Strategy

Use replace when the newest information should become the current value.
```text
"I prefer Python."
"I prefer TypeScript now."

→ Keep TypeScript
```
Use reject when existing information should not be automatically replaced.
```text
Existing: "User's account is verified."
New:      "User's account is not verified."

→ Keep the existing memory
```
Use keep-both when both versions may be useful.
```text
"User lived in Delhi."
"User later moved to Mumbai."

→ Keep both memories
```
Use semantic similarity when your main concern is duplicate information.
Use contradiction detection when your main concern is changing or conflicting information.

You can also use both together when your application needs to handle both duplicate and conflicting memories.

## 15. Guardrails

Guardrails allow you to check and control what goes into and comes out of the agent.

You can use them to block unwanted input, prevent unsafe responses, or enforce rules for your application.

The SDK supports two types of guardrails:

- *Input guardrails* — check the user's message before the agent processes it.
- *Output guardrails* — check the agent's response before it is returned.

### Example

```ts
const agent = new Agent({
    model,
    instructions: "You are a helpful assistant.",
     inputGuardrails,
     outputGuardrails,
});
```

### Input Guardrail

An input guardrail can check a user's message before it reaches the model.

For example, you can block messages that contain content your application does not allow.
```ts
import { Guardrails } from "memora-agent";

const inputGuardrails = [

    Guardrails.contentFilter({

        words: [
            "hack",
            "exploit"
        ],

        patterns: [
            /\bpassword\s*:\s*\S+/i
        ]
    })
];
```

If the guardrail blocks the inout, the agent stops before generating a response.

### Output Guardrail

An output guardrail checks the agent's response before sending it back to the user.

For example, you can prevent the agent from returning information that your application does not want to expose.
```ts
import {Guardrails } from "memora-agent";

const outputGuardrails = [

    Guardrails.contentFilter({

        words: [
            "confidential"
        ]
    })
];
```
Use input guardrails when you want to control what users can send to your agent.

use output guardrails when you want to control what your agent can return.

you can use both when your application needs to control both incomming requests and outgoing responses.

## 16. Graph Store

GraphStore is used to store and search relationships between memories.

For example:

```text
User ──BUILDING──> AI SDK
AI SDK ──USES──> TypeScript
User ──LIKES──> Pakistan
```
This is useful when the connection between different pieces of information is important.

```ts
GraphStore Interface
The SDK provides a GraphStore interface:
export interface GraphStore{
    set(record: MemoryRecord): Promise<void>;
    search(optios: MemoryGraphSearchOptions): Promise<MemoryRecord[]>;
    delete?(id: string): Promise<void>;
    clear?(): Promise<void>;
}
```
A developer can implement this interface using their own graph database.
Neo4j

The SDK provides Neo4jLongTermMemoryStore, which implements both LongTermMemoryStore and GraphStore.

```ts
import {Neo4jLongTermMemoryStore} from "memora-agent/neo4j"

const store = new Neo4jLongTermMemoryStore({
    uri: "neo4j://localhost:7687", // neo4j db uri
    username: "neo4j",
    password: "password"
});
```

It can then be configured as the graph store:
```ts
const memory = new InMemoryLongTermMemory({
    store: neo4jStore, // here mongodb can also be used
    graphStore: neo4jStore
});
```
Use GraphStore when your agent needs to understand connections between information, such as projects, technologies, people, products, or dependencies.
