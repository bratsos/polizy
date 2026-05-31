---
title: Using the Skills
sidebar_position: 3
---

# Using the Skills

Once installed, the main `polizy` skill acts as an intelligent **router**. When you ask your AI agent about authorization, permissions, or access control, it automatically activates the router and delegates to the appropriate specialized skill.

You do not need to manually specify which skill file to read. The router's activation rules trigger based on the context of your questions.

## How the Router Delegates Tasks

The agent matching rules evaluate your prompt and redirect execution to the specialized guide that contains the ground truth for that specific domain.

Here is a mapping of example developer tasks to the specialized skills that handle them:

| When you ask the agent to... | ...the agent routes to | Why this happens |
| :--- | :--- | :--- |
| *"add polizy to my app"* or *"initialize the authorization system"* | `polizy-setup` | `polizy-setup` contains the step-by-step onboarding guide, Prisma or InMemory setup, and initial `AuthSystem` instantiation. |
| *"design a permissions schema for docs and teams"* or *"define our relations and actions"* | `polizy-schema` | `polizy-schema` outlines direct, group, and hierarchy relations, actions, action mappings, and propagation. |
| *"make files inherit folder permissions"* or *"give a team access to a project"* | `polizy-patterns` | `polizy-patterns` is loaded for complex scenarios like nested structures, temporary access, and revocation. |
| *"set up Prisma storage"* or *"configure the SQL adapter"* | `polizy-storage` | `polizy-storage` guides database setup, indexes, and performance tuning for specific storage adapters. |
| *"my check returns false unexpectedly"* or *"debug this failed check"* | `polizy-troubleshooting` | `polizy-troubleshooting` traces the check algorithm, evaluates rules, and highlights common anti-patterns. |
| *"upgrade polizy to the latest version"* | `polizy` (migrations) | The migrations folder inside `polizy` acts as a version-aware upgrade router to walk package upgrades step-by-step. |

## Tips for Getting the Best Results

To get the most out of your polizy-equipped agent, keep these tips in mind:

:::tip[Use Domain Terminology]

Use standard polizy vocabulary in your prompts (such as "schema", "relations", "actions", "tuples", and "adapters"). This helps the agent's router match the right skill immediately.

:::

:::note[Context Matters]

If a check isn't working as expected, paste the schema definition and the relevant relationship tuples directly into the chat session. This allows the `polizy-troubleshooting` skill to trace the exact resolution path.

:::

For further details on how to build specific authorization designs yourself, explore the **[Guides Overview](../guides/overview.md)**.
