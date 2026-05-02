# Claude Plugin Marketplace

A community marketplace of [Claude Code](https://claude.ai/code) plugins.

## Repository structure

```
.claude-plugin/
└── marketplace.json          ← marketplace catalog (the entry point)

plugins/
└── hello-world/              ← example plugin
    ├── .claude-plugin/
    │   └── plugin.json       ← plugin manifest
    └── skills/
        └── hello-world/
            └── SKILL.md      ← the /hello-world skill
```

## Using this marketplace

### 1. Add the marketplace

```shell
/plugin marketplace add CoderCoco/claude-plugin-marketplace
```

### 2. Install a plugin

```shell
/plugin install hello-world@claude-plugin-marketplace
```

### 3. Use the skill

```shell
/hello-world
```

## Adding your own plugin

1. **Create your plugin directory** under `plugins/<your-plugin-name>/`.
2. **Add a manifest** at `plugins/<your-plugin-name>/.claude-plugin/plugin.json`:
   ```json
   {
     "name": "your-plugin-name",
     "description": "What your plugin does",
     "version": "1.0.0",
     "author": { "name": "Your Name" },
     "license": "MIT"
   }
   ```
3. **Add a skill** at `plugins/<your-plugin-name>/skills/<skill-name>/SKILL.md`:
   ```markdown
   ---
   description: One-line description shown in /help
   ---

   Instructions for Claude when this skill is invoked.
   ```
4. **Register it** in `.claude-plugin/marketplace.json` under `plugins`.
5. Open a pull request!

See the official docs at <https://code.claude.com/docs> for the full plugin reference.
