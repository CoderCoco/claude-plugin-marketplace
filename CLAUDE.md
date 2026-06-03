# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A community marketplace of Claude Code plugins, served as a GitHub Pages site. There is no build system or test suite — the repo is pure content (JSON manifests, Markdown skill files, and a static `index.html`).

## Repository layout

```
.claude-plugin/marketplace.json   ← marketplace catalog (the entry point)
plugins/<plugin-name>/
  .claude-plugin/plugin.json      ← plugin manifest
  skills/<skill-name>/SKILL.md    ← skill definition (invoked via /skill-name)
index.html                        ← GitHub Pages UI, reads marketplace.json at runtime
```

## Adding or updating a plugin

1. Create `plugins/<plugin-name>/.claude-plugin/plugin.json` with `name`, `description`, `version`, `author`, `license`.
2. Create one or more `plugins/<plugin-name>/skills/<skill-name>/SKILL.md` files. Each must have YAML frontmatter with at minimum a `description` field (shown in `/help`).
3. Register the plugin in `.claude-plugin/marketplace.json` under the `plugins` array. The `source` field must be the relative path `./plugins/<plugin-name>`.

**Version bump required on every change:** Any modification to a plugin's skills or manifest must be accompanied by a patch or minor version bump in `plugins/<plugin-name>/.claude-plugin/plugin.json`. The version does not need to be duplicated in `marketplace.json`.

## Skill file conventions

- Frontmatter fields: `name` (optional, defaults to directory name), `description` (required), and any trigger keywords.
- The body of the file is the instruction set Claude follows when the skill is invoked — write it as imperative steps.
- Skills in this repo use numbered `## Step N` headings; new skills should follow that pattern.

## Installing from this marketplace (for users)

```shell
/plugin marketplace add CoderCoco/claude-plugin-marketplace
/plugin install <plugin-name>@codercoco-custom-plugin-marketplace
```
