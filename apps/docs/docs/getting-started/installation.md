---
title: Installation
sidebar_position: 2
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Installation

Getting started with **polizy** is straightforward. Because it is built from the ground up for modern Node.js and TypeScript, it has zero external runtime dependencies and requires no complex compilation steps.

Let's add it to your project!

## 1. Install the Package

Install `polizy` using your package manager of choice:

<Tabs>
  <TabItem value="npm" label="npm" default>

```bash
npm install polizy
```

  </TabItem>
  <TabItem value="pnpm" label="pnpm">

```bash
pnpm add polizy
```

  </TabItem>
  <TabItem value="yarn" label="yarn">

```bash
yarn add polizy
```

  </TabItem>
</Tabs>

## Requirements & Compatibility

To use polizy, ensure your environment meets the following conditions:

- **Node.js**: Version `22.11.0` or higher.
- **ES Modules (ESM)**: polizy is published as a pure ESM package. Your project must be configured as an ESM project (e.g., containing `"type": "module"` in your `package.json`, or using `.mts`/`.mjs` extensions).
- **TypeScript**: polizy ships with its own TypeScript types built-in. No additional `@types/` packages or extra compiler configurations are required.

## Pick a Storage Adapter

All the relationship tuples that polizy manages—such as who is an owner or editor of a document—are stored in a **Storage Adapter**. 

For local development, testing, and learning in this tutorial, we will use the built-in **In-Memory Storage Adapter**. This adapter stores all relationships in memory, meaning data is reset every time your application restarts—which is perfect for experimenting!

```typescript
import { InMemoryStorageAdapter } from "polizy";

const storage = new InMemoryStorageAdapter();
```

:::tip Production Storage
For production environments where you want to persist relationships in a database, check out the [Storage Overview](../storage/overview.md) guide.
:::

## Verify Your Installation

To verify that polizy has been successfully installed and can be imported, create a test file (e.g., `test.ts` or `test.js`) and run the following code:

```typescript
import { defineSchema } from "polizy";

// If this prints without error, you're ready!
console.log("polizy is installed and ready to go!");
```

Now that you have polizy installed, let's build your first authorization check!

**Next: [Head to the Quickstart](./quickstart.md)**
