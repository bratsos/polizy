---
title: Installing the Skills
sidebar_position: 2
---

# Installing the Skills

To equip your AI coding assistant with the polizy skills, you must copy or link the skill folders from the installed `polizy` npm package into your agent's skills directory.

:::note SKILL.md Convention
These skills follow the standard `SKILL.md` design pattern. They are fully compatible with Claude Code and any other AI agent that supports `SKILL.md` skill discovery. There is no custom installer, CLI command, plugin marketplace, or postinstall script.
:::

## Prerequisites

Before installing the skills, you must first install the `polizy` package in your project. Refer to the **[Installation Guide](../getting-started/installation.md)** for details.

Once installed, the skill directories reside inside the npm package at:

```text
node_modules/polizy/skills/
```

---

## Method 1: Project-Level Installation (Recommended)

Installing skills at the project level ensures that any team member working on the repository will automatically have the polizy skills available when running their agent inside the project workspace. Project-level skills are committed to version control.

For Claude Code, project-level skills are loaded from the `.claude/skills/` folder at the root of your project.

### 1. Copy the Skills

Run the following command from your project root to copy the skills into your project:

```bash
mkdir -p .claude/skills
cp -R node_modules/polizy/skills/. .claude/skills/
```

### 2. Commit the Skills

Commit the copied skills so your entire team can benefit from them:

```bash
git add .claude/skills
git commit -m "docs: add polizy agent skills"
```

---

## Method 2: Symlinking the Skills (Keep in Sync)

If you prefer to always track the installed version of the skills without copying them again when you update the `polizy` package, symlink them instead. This is particularly useful because the version-aware upgrade guides inside the skills stay in sync with the installed version of `polizy`.

Run the following from your project root. It links each skill using an absolute path, so the links resolve correctly from inside `.claude/skills/`:

```bash
mkdir -p .claude/skills
for skill in "$PWD"/node_modules/polizy/skills/*/; do
  ln -s "$skill" .claude/skills/
done
```

:::warning
A relative symlink like `ln -s ../node_modules/...` will **not** work here — its target is resolved relative to the link's own location (`.claude/skills/`), not your project root. Use the absolute-path loop above.
:::

---

## Method 3: Personal (Global) Installation

If you want the polizy skills to be available across all of your projects on your local machine without adding them to each repository, you can install them to your personal global Claude directory (`~/.claude/skills/`).

Run the following command:

```bash
mkdir -p ~/.claude/skills
cp -R node_modules/polizy/skills/. ~/.claude/skills/
```

---

## After Installation: Reload Your Agent

Once the skills are copied or symlinked, make sure to reload or restart your AI agent so it discovers and loads the new skills.

For example, if you are using Claude Code, exit the session and start a new one:

```bash
# Exit active session (Ctrl+D or exit)
# Then restart
claude
```

**Next: [Learn how to use the skills](./using-skills.md)**
