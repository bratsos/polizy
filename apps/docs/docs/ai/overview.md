---
title: AI Agents
sidebar_position: 1
---

# AI Agents

When building applications with **polizy**, you do not have to code alone. polizy ships with a set of agent **skills** designed to make AI coding assistants (like Claude Code and other agents supporting the `SKILL.md` format) fully fluent in the library.

Instead of the AI guessing the API, generating outdated code, or misunderstanding how to structure relationship tuples, these skills provide immediate, high-fidelity guidance. They route the AI agent directly to verified setup instructions, schema designs, implementation patterns, and debugging steps.

## The 6 Agent Skills

The skills are standard `SKILL.md` bundles. A skill consists of a directory containing a `SKILL.md` file (which includes YAML frontmatter describing its name and purpose) along with optional reference documentation.

Here is the suite of skills included with polizy:

| Skill Name | Purpose |
| :--- | :--- |
| `polizy` | The primary entrypoint and router. Activates on authorization, permissions, access control, RBAC, ReBAC, Zanzibar, or "who can do what" questions. Routes upgrades through migrations. |
| `polizy-setup` | Setup and installation helper. Guide for adding authorization to a project, installing polizy, choosing storage adapters, and constructing `AuthSystem`. |
| `polizy-schema` | Schema design guide. Covers defining relations, actions, action mappings, hierarchy propagation, and relation types (direct, group, hierarchy). |
| `polizy-patterns` | Implementation patterns. Guides the agent on team access, folder inheritance, field-level permissions, temporary access, revocation, and other specific authorization scenarios. |
| `polizy-storage` | Storage adapter configuration. Setup guide for `InMemory`, `Prisma`, or custom storage adapters, database schema configuration, and performance optimization. |
| `polizy-troubleshooting` | Debugging and troubleshooting. Used when permission checks fail unexpectedly or return confusing results. Covers the check algorithm and common anti-patterns. |

### Version-Aware Upgrade Router

In addition to the core routing capabilities, the main `polizy` skill bundles a **version-aware upgrade router** in its `migrations/` folder (`node_modules/polizy/skills/polizy/migrations/` once installed). Every published release of polizy includes its complete migration history. This allows an AI agent to safely walk a project step by step from its currently installed version to the newest version (e.g., from `0.2` to `0.3` to `0.4`), resolving schema migrations and API changes without breaking your application.

## How It Works

These skills are bundled directly inside the npm package. When you install polizy, the skill files are placed in your `node_modules` directory under `node_modules/polizy/skills/`.

To get started with using these skills in your development workflow:

1. First, make sure you have polizy installed in your project. See the **[Installation Guide](../getting-started/installation.md)**.
2. Next, install the skills into your AI agent's environment. See **[Installing the Skills](./install-skills.md)**.
3. Learn how to prompt and interact with your equipped agent. See **[Using the Skills](./using-skills.md)**.
