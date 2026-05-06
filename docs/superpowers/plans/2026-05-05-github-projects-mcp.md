# GitHub Projects MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub Projects v2 MCP server exposing `get_project_status_option` and `move_project_item`, publish it as a standalone npm package in its own GitHub repo, and wire it into this marketplace as a `github-projects` Claude Code plugin.

**Architecture:** A TypeScript stdio MCP server using `@modelcontextprotocol/sdk` and `@octokit/graphql` calls GitHub's Projects v2 GraphQL API. Both tools share a `getProjectStatusField` helper that resolves the project node ID and Status field options in one query, trying user-owned projects first then org-owned. The server lives in its own repository (`CoderCoco/github-projects-mcp`) and is published to npm as `@codercoco/github-projects-mcp` so the plugin can launch it via `npx`. The marketplace plugin at `plugins/github-projects/` declares the server in `plugin.json`; no compiled output needs to live in this repo.

**Tech Stack:** TypeScript 5, @modelcontextprotocol/sdk ^1.0, @octokit/graphql ^8, zod ^3, vitest ^1, Node.js ≥18

---

## Research findings (pre-completed)

The official `github/github-mcp-server` exposes `projects_write` but requires callers to know exact field/option IDs upfront — no name-based lookup. Three community servers (`Arclio/github-projects-mcp`, `kunwarVivek/mcp-github-project-manager`, `taylor-lindores-reeves/mcp-github-projects`) cover CRUD but none expose case-insensitive option-name resolution. **Build from scratch.**

---

## File map

**New repo `CoderCoco/github-projects-mcp`:**
```
package.json
tsconfig.json
vitest.config.ts
src/
  index.ts              — MCP server entry point, registers tools, starts stdio transport
  github.ts             — getProjectStatusField() shared helper (GraphQL + type definitions)
  tools/
    get-status-option.ts  — get_project_status_option tool handler
    move-item.ts          — move_project_item tool handler
  __tests__/
    github.test.ts        — unit tests for the shared helper
    get-status-option.test.ts
    move-item.test.ts
```

**This repo (`claude-plugin-marketplace`):**
```
plugins/github-projects/
  .claude-plugin/plugin.json   — declares the MCP server + plugin metadata
docs/superpowers/plans/2026-05-05-github-projects-mcp.md   — this file
```

---

## Task 1: Create the GitHub repository

> Manual steps — cannot be automated.

- [ ] **Step 1: Create repo on GitHub**

  Go to https://github.com/new:
  - Name: `github-projects-mcp`
  - Description: `MCP server for GitHub Projects v2 — status lookup and item moves`
  - Public, MIT license, Node .gitignore

- [ ] **Step 2: Clone locally (outside the marketplace repo)**

  ```bash
  gh repo clone CoderCoco/github-projects-mcp ~/code/github-projects-mcp
  cd ~/code/github-projects-mcp
  ```

---

## Task 2: Scaffold the TypeScript project

**Files:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`

- [ ] **Step 1: Write `package.json`**

  ```json
  {
    "name": "@codercoco/github-projects-mcp",
    "version": "1.0.0",
    "description": "MCP server for GitHub Projects v2 — status option lookup and item moves",
    "type": "module",
    "bin": {
      "github-projects-mcp": "./dist/index.js"
    },
    "files": ["dist"],
    "scripts": {
      "build": "tsc",
      "test": "vitest run",
      "test:watch": "vitest",
      "prepublishOnly": "npm run build && npm test"
    },
    "dependencies": {
      "@modelcontextprotocol/sdk": "^1.0.0",
      "@octokit/graphql": "^8.0.0",
      "zod": "^3.22.0"
    },
    "devDependencies": {
      "@types/node": "^20.0.0",
      "typescript": "^5.3.0",
      "vitest": "^1.6.0"
    },
    "engines": { "node": ">=18" },
    "license": "MIT",
    "repository": {
      "type": "git",
      "url": "https://github.com/CoderCoco/github-projects-mcp.git"
    }
  }
  ```

- [ ] **Step 2: Write `tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "outDir": "./dist",
      "rootDir": "./src",
      "strict": true,
      "declaration": true,
      "skipLibCheck": true
    },
    "include": ["src/**/*"],
    "exclude": ["src/**/*.test.ts", "node_modules", "dist"]
  }
  ```

- [ ] **Step 3: Write `vitest.config.ts`**

  ```typescript
  import { defineConfig } from "vitest/config";
  export default defineConfig({
    test: { environment: "node" }
  });
  ```

- [ ] **Step 4: Write `.gitignore`**

  ```
  node_modules/
  dist/
  *.tsbuildinfo
  ```

- [ ] **Step 5: Install dependencies**

  ```bash
  npm install
  ```

  Expected: `node_modules/` populated, no errors.

- [ ] **Step 6: Commit scaffold**

  ```bash
  git add .
  git commit -m "chore: initial TypeScript MCP server scaffold"
  ```

---

## Task 3: Implement the shared GitHub helper

**Files:** `src/github.ts`, `src/__tests__/github.test.ts`

The helper calls GitHub's GraphQL API to return the project node ID, the Status field ID, and all its options. It tries the user-owned project query first; if that returns null it retries as an org-owned project. Both tools depend on this.

- [ ] **Step 1: Write the failing test `src/__tests__/github.test.ts`**

  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { getProjectStatusField } from "../github.js";
  import type { GraphQLClient } from "../github.js";

  const mockClient = vi.fn() as unknown as GraphQLClient;

  const USER_RESPONSE = {
    user: {
      projectV2: {
        id: "PVT_user123",
        fields: {
          nodes: [
            { __typename: "ProjectV2SingleSelectField", id: "PVTSSF_abc", name: "Status",
              options: [
                { id: "opt_todo", name: "Todo" },
                { id: "opt_wip",  name: "In Progress" },
                { id: "opt_done", name: "Done" }
              ]
            }
          ]
        }
      }
    }
  };

  const ORG_RESPONSE = {
    organization: {
      projectV2: {
        id: "PVT_org456",
        fields: { nodes: [
          { __typename: "ProjectV2SingleSelectField", id: "PVTSSF_org", name: "Status",
            options: [{ id: "opt_ip", name: "In Progress" }] }
        ]}
      }
    }
  };

  beforeEach(() => { vi.clearAllMocks(); });

  describe("getProjectStatusField", () => {
    it("returns project id, field id, and options from user-owned project", async () => {
      vi.mocked(mockClient).mockResolvedValueOnce(USER_RESPONSE);
      const result = await getProjectStatusField(mockClient, "alice", 1);
      expect(result.projectId).toBe("PVT_user123");
      expect(result.fieldId).toBe("PVTSSF_abc");
      expect(result.options).toHaveLength(3);
      expect(result.options[1]).toEqual({ id: "opt_wip", name: "In Progress" });
    });

    it("falls back to org query when user project is null", async () => {
      vi.mocked(mockClient)
        .mockResolvedValueOnce({ user: null })
        .mockResolvedValueOnce(ORG_RESPONSE);
      const result = await getProjectStatusField(mockClient, "myorg", 2);
      expect(result.projectId).toBe("PVT_org456");
      expect(result.fieldId).toBe("PVTSSF_org");
    });

    it("throws when neither user nor org project found", async () => {
      vi.mocked(mockClient)
        .mockResolvedValueOnce({ user: null })
        .mockResolvedValueOnce({ organization: null });
      await expect(getProjectStatusField(mockClient, "nobody", 99))
        .rejects.toThrow("Project #99 not found");
    });

    it("throws when Status field is missing from the project", async () => {
      vi.mocked(mockClient).mockResolvedValueOnce({
        user: { projectV2: { id: "PVT_x", fields: { nodes: [] } } }
      });
      await expect(getProjectStatusField(mockClient, "alice", 1))
        .rejects.toThrow("No Status field found");
    });
  });
  ```

- [ ] **Step 2: Run test — verify it fails**

  ```bash
  npm test
  ```

  Expected: `Cannot find module '../github.js'`

- [ ] **Step 3: Write `src/github.ts`**

  ```typescript
  import { graphql as createGraphQL } from "@octokit/graphql";

  export type GraphQLClient = ReturnType<typeof createGraphQL.defaults>;

  export interface StatusOption { id: string; name: string; }

  export interface ProjectStatusField {
    projectId: string;
    fieldId:   string;
    options:   StatusOption[];
  }

  const FIELDS_QUERY = `
    query GetProjectFields($login: String!, $number: Int!, $owner: String!) {
      user(login: $login) {
        projectV2(number: $number) {
          id
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                __typename id name
                options { id name }
              }
            }
          }
        }
      }
    }
  `;

  const ORG_FIELDS_QUERY = `
    query GetOrgProjectFields($login: String!, $number: Int!) {
      organization(login: $login) {
        projectV2(number: $number) {
          id
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                __typename id name
                options { id name }
              }
            }
          }
        }
      }
    }
  `;

  type FieldNode = {
    __typename: "ProjectV2SingleSelectField";
    id: string; name: string;
    options: StatusOption[];
  } | Record<string, never>;

  interface ProjectPayload {
    id: string;
    fields: { nodes: FieldNode[] };
  }

  export async function getProjectStatusField(
    client: GraphQLClient,
    owner: string,
    projectNumber: number
  ): Promise<ProjectStatusField> {
    // Try user-owned project first
    const userResp = await client<{ user: { projectV2: ProjectPayload } | null }>(
      FIELDS_QUERY, { login: owner, number: projectNumber }
    );

    let project = userResp.user?.projectV2 ?? null;

    if (!project) {
      const orgResp = await client<{ organization: { projectV2: ProjectPayload } | null }>(
        ORG_FIELDS_QUERY, { login: owner, number: projectNumber }
      );
      project = orgResp.organization?.projectV2 ?? null;
    }

    if (!project) {
      throw new Error(`Project #${projectNumber} not found for owner "${owner}"`);
    }

    const statusField = project.fields.nodes.find(
      (n): n is FieldNode & { __typename: "ProjectV2SingleSelectField" } =>
        "__typename" in n && n.__typename === "ProjectV2SingleSelectField" && n.name === "Status"
    );

    if (!statusField) {
      throw new Error(`No Status field found on project #${projectNumber}`);
    }

    return { projectId: project.id, fieldId: statusField.id, options: statusField.options };
  }

  export function createClient(token: string): GraphQLClient {
    return createGraphQL.defaults({ headers: { authorization: `token ${token}` } });
  }
  ```

- [ ] **Step 4: Run tests — verify they pass**

  ```bash
  npm test
  ```

  Expected: 4 passing tests in `github.test.ts`.

- [ ] **Step 5: Commit**

  ```bash
  git add src/github.ts src/__tests__/github.test.ts
  git commit -m "feat: add getProjectStatusField helper with user/org fallback"
  ```

---

## Task 4: Implement `get_project_status_option` tool

**Files:** `src/tools/get-status-option.ts`, `src/__tests__/get-status-option.test.ts`

- [ ] **Step 1: Write the failing test `src/__tests__/get-status-option.test.ts`**

  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { getStatusOptionHandler } from "../tools/get-status-option.js";
  import * as github from "../github.js";

  vi.mock("../github.js", () => ({
    getProjectStatusField: vi.fn()
  }));

  const FIELD_DATA = {
    projectId: "PVT_abc",
    fieldId:   "PVTSSF_xyz",
    options: [
      { id: "opt_todo", name: "Todo" },
      { id: "opt_wip",  name: "In Progress" },
      { id: "opt_done", name: "Done" }
    ]
  };

  const mockClient = {} as unknown as github.GraphQLClient;

  beforeEach(() => { vi.clearAllMocks(); });

  describe("getStatusOptionHandler", () => {
    it("returns field_id and option_id for exact match", async () => {
      vi.mocked(github.getProjectStatusField).mockResolvedValue(FIELD_DATA);
      const result = await getStatusOptionHandler(mockClient, {
        owner: "alice", project_number: 1, status_name: "In Progress"
      });
      expect(result).toEqual({ field_id: "PVTSSF_xyz", option_id: "opt_wip" });
    });

    it("matches case-insensitively ('in progress' finds 'In Progress')", async () => {
      vi.mocked(github.getProjectStatusField).mockResolvedValue(FIELD_DATA);
      const result = await getStatusOptionHandler(mockClient, {
        owner: "alice", project_number: 1, status_name: "in progress"
      });
      expect(result.option_id).toBe("opt_wip");
    });

    it("throws when status name not found", async () => {
      vi.mocked(github.getProjectStatusField).mockResolvedValue(FIELD_DATA);
      await expect(
        getStatusOptionHandler(mockClient, { owner: "alice", project_number: 1, status_name: "Backlog" })
      ).rejects.toThrow('No status option matching "Backlog"');
    });
  });
  ```

- [ ] **Step 2: Run test — verify it fails**

  ```bash
  npm test
  ```

  Expected: `Cannot find module '../tools/get-status-option.js'`

- [ ] **Step 3: Write `src/tools/get-status-option.ts`**

  ```typescript
  import type { GraphQLClient, ProjectStatusField } from "../github.js";
  import { getProjectStatusField } from "../github.js";

  export interface GetStatusOptionArgs {
    owner:          string;
    project_number: number;
    status_name:    string;
  }

  export interface GetStatusOptionResult {
    field_id:  string;
    option_id: string;
  }

  export async function getStatusOptionHandler(
    client: GraphQLClient,
    args: GetStatusOptionArgs
  ): Promise<GetStatusOptionResult> {
    const { owner, project_number, status_name } = args;
    const field = await getProjectStatusField(client, owner, project_number);

    const match = field.options.find(
      o => o.name.toLowerCase() === status_name.toLowerCase()
    );

    if (!match) {
      const available = field.options.map(o => `"${o.name}"`).join(", ");
      throw new Error(
        `No status option matching "${status_name}" on project #${project_number}. Available: ${available}`
      );
    }

    return { field_id: field.fieldId, option_id: match.id };
  }
  ```

- [ ] **Step 4: Run tests — verify they pass**

  ```bash
  npm test
  ```

  Expected: 3 passing tests in `get-status-option.test.ts`, 4 in `github.test.ts`.

- [ ] **Step 5: Commit**

  ```bash
  git add src/tools/get-status-option.ts src/__tests__/get-status-option.test.ts
  git commit -m "feat: implement get_project_status_option tool handler"
  ```

---

## Task 5: Implement `move_project_item` tool

**Files:** `src/tools/move-item.ts`, `src/__tests__/move-item.test.ts`

- [ ] **Step 1: Write the failing test `src/__tests__/move-item.test.ts`**

  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { moveItemHandler } from "../tools/move-item.js";
  import * as github from "../github.js";

  vi.mock("../github.js", () => ({
    getProjectStatusField: vi.fn()
  }));

  const FIELD_DATA = {
    projectId: "PVT_abc",
    fieldId:   "PVTSSF_xyz",
    options: [
      { id: "opt_wip",  name: "In Progress" },
      { id: "opt_done", name: "Done" }
    ]
  };

  const mockClient = vi.fn() as unknown as github.GraphQLClient;

  beforeEach(() => { vi.clearAllMocks(); });

  describe("moveItemHandler", () => {
    it("calls the mutation and returns success message", async () => {
      vi.mocked(github.getProjectStatusField).mockResolvedValue(FIELD_DATA);
      vi.mocked(mockClient).mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_item99" } }
      });

      const result = await moveItemHandler(mockClient, {
        owner: "alice", project_number: 1, item_id: "PVTI_item99", status_name: "Done"
      });

      expect(result).toContain("PVTI_item99");
      expect(result).toContain("Done");

      const mutationCall = vi.mocked(mockClient).mock.calls[0];
      expect(mutationCall[1]).toMatchObject({
        projectId: "PVT_abc",
        itemId:    "PVTI_item99",
        fieldId:   "PVTSSF_xyz",
        optionId:  "opt_done"
      });
    });

    it("throws when status name not found", async () => {
      vi.mocked(github.getProjectStatusField).mockResolvedValue(FIELD_DATA);
      await expect(
        moveItemHandler(mockClient, {
          owner: "alice", project_number: 1, item_id: "PVTI_item99", status_name: "Backlog"
        })
      ).rejects.toThrow("No status option");
    });
  });
  ```

- [ ] **Step 2: Run test — verify it fails**

  ```bash
  npm test
  ```

  Expected: `Cannot find module '../tools/move-item.js'`

- [ ] **Step 3: Write `src/tools/move-item.ts`**

  ```typescript
  import type { GraphQLClient } from "../github.js";
  import { getProjectStatusField } from "../github.js";

  const MOVE_ITEM_MUTATION = `
    mutation MoveProjectItem(
      $projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!
    ) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId:    $itemId
        fieldId:   $fieldId
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item { id }
      }
    }
  `;

  export interface MoveItemArgs {
    owner:          string;
    project_number: number;
    item_id:        string;
    status_name:    string;
  }

  export async function moveItemHandler(
    client: GraphQLClient,
    args: MoveItemArgs
  ): Promise<string> {
    const { owner, project_number, item_id, status_name } = args;
    const field = await getProjectStatusField(client, owner, project_number);

    const match = field.options.find(
      o => o.name.toLowerCase() === status_name.toLowerCase()
    );

    if (!match) {
      const available = field.options.map(o => `"${o.name}"`).join(", ");
      throw new Error(
        `No status option matching "${status_name}" on project #${project_number}. Available: ${available}`
      );
    }

    await client(MOVE_ITEM_MUTATION, {
      projectId: field.projectId,
      itemId:    item_id,
      fieldId:   field.fieldId,
      optionId:  match.id
    });

    return `Moved item ${item_id} to "${match.name}" on project #${project_number}.`;
  }
  ```

- [ ] **Step 4: Run tests — verify all pass**

  ```bash
  npm test
  ```

  Expected: all tests in all 3 test files passing.

- [ ] **Step 5: Commit**

  ```bash
  git add src/tools/move-item.ts src/__tests__/move-item.test.ts
  git commit -m "feat: implement move_project_item tool handler"
  ```

---

## Task 6: Wire tools into the MCP server entry point

**Files:** `src/index.ts`

- [ ] **Step 1: Write `src/index.ts`**

  ```typescript
  #!/usr/bin/env node
  import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
  import { z } from "zod";
  import { createClient } from "./github.js";
  import { getStatusOptionHandler } from "./tools/get-status-option.js";
  import { moveItemHandler } from "./tools/move-item.js";

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN environment variable is required");
    process.exit(1);
  }

  const client = createClient(token);

  const server = new McpServer({
    name: "github-projects-mcp",
    version: "1.0.0"
  });

  server.tool(
    "get_project_status_option",
    "Find a GitHub Projects v2 Status column option by name (case-insensitive). Returns field_id and option_id needed for project item mutations.",
    {
      owner:          z.string().describe("Repository owner login (user or org)"),
      project_number: z.number().int().positive().describe("Project number"),
      status_name:    z.string().describe("Status option name to find, e.g. 'In Progress'")
    },
    async (args) => {
      const result = await getStatusOptionHandler(client, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "move_project_item",
    "Move a GitHub Projects v2 item to a named status column (case-insensitive). Resolves the option ID automatically.",
    {
      owner:          z.string().describe("Repository owner login (user or org)"),
      project_number: z.number().int().positive().describe("Project number"),
      item_id:        z.string().describe("Project item node ID (PVTI_…)"),
      status_name:    z.string().describe("Target status name, e.g. 'In Progress'")
    },
    async (args) => {
      const message = await moveItemHandler(client, args);
      return { content: [{ type: "text", text: message }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  ```

- [ ] **Step 2: Build**

  ```bash
  npm run build
  ```

  Expected: `dist/` populated with `index.js`, `github.js`, `tools/get-status-option.js`, `tools/move-item.js`. No TypeScript errors.

- [ ] **Step 3: Smoke test the binary (requires a real GITHUB_TOKEN)**

  ```bash
  GITHUB_TOKEN=<your-token> node dist/index.js
  ```

  Expected: process starts and waits (MCP stdio transport is listening). `Ctrl+C` to exit. If it exits with "GITHUB_TOKEN required", the env var wasn't set.

- [ ] **Step 4: Commit**

  ```bash
  git add src/index.ts
  git commit -m "feat: wire tools into MCP server entry point"
  ```

---

## Task 7: Publish to npm

> Manual steps requiring an npm account with publish rights to the `@codercoco` scope.

- [ ] **Step 1: Log in to npm**

  ```bash
  npm login
  ```

- [ ] **Step 2: Publish**

  ```bash
  npm publish --access public
  ```

  Expected: package appears at `https://www.npmjs.com/package/@codercoco/github-projects-mcp`.

- [ ] **Step 3: Verify `npx` install works**

  ```bash
  npx -y @codercoco/github-projects-mcp
  ```

  Expected: process starts (or exits with "GITHUB_TOKEN required" — that's correct behaviour with no token set).

- [ ] **Step 4: Tag the release on GitHub**

  ```bash
  git tag v1.0.0
  git push origin main --tags
  ```

---

## Task 8: Add the plugin to this marketplace

> Run these steps in the `claude-plugin-marketplace` repo.

**Files:**
- Create: `plugins/github-projects/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create plugin directory**

  ```bash
  mkdir -p plugins/github-projects/.claude-plugin
  ```

- [ ] **Step 2: Write `plugins/github-projects/.claude-plugin/plugin.json`**

  ```json
  {
    "name": "github-projects",
    "description": "MCP server for GitHub Projects v2 — resolves status option IDs by name and moves project items between columns.",
    "version": "1.0.0",
    "author": { "name": "CoderCoco" },
    "license": "MIT",
    "repository": "https://github.com/CoderCoco/github-projects-mcp",
    "mcpServers": {
      "github-projects": {
        "command": "npx",
        "args": ["-y", "@codercoco/github-projects-mcp"],
        "env": {
          "GITHUB_TOKEN": "${GITHUB_TOKEN}"
        }
      }
    }
  }
  ```

- [ ] **Step 3: Register in `.claude-plugin/marketplace.json`**

  Add to the `plugins` array:

  ```json
  {
    "name": "github-projects",
    "source": "./plugins/github-projects",
    "description": "MCP server for GitHub Projects v2 — resolves status option IDs by name and moves project items between columns.",
    "version": "1.0.0",
    "author": { "name": "CoderCoco" },
    "license": "MIT",
    "repository": "https://github.com/CoderCoco/github-projects-mcp",
    "keywords": ["github", "projects", "mcp", "project-board"],
    "category": "productivity"
  }
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add plugins/github-projects/ .claude-plugin/marketplace.json
  git commit -m "feat(github-projects): add GitHub Projects v2 MCP plugin to marketplace"
  git push
  ```

---

## Task 9: Update the issue-flow work-on skill to use MCP tools

> Optional — the bash scripts still work. Do this once the plugin is installed and verified.

**Files:** `plugins/issue-flow/skills/work-on/SKILL.md`

- [ ] **Step 1: Update Step 3 of the skill to prefer MCP over the bash script**

  Replace the Step 3 body with:

  ```markdown
  ## Step 3: Move to "In Progress" on the project board

  **MCP (preferred):** If the `github-projects` plugin is installed, call:
  - `move_project_item` with `owner`, `project_number` (from `projectItems[0].project.number`),
    `item_id` (from `projectItems[0].id`), and `status_name: "In Progress"`.

  **Script fallback:** If the MCP is not available, run the bundled script:
  ```bash
  bash "${CLAUDE_SKILL_DIR}/scripts/move-to-in-progress.sh" "$ITEM_ID" "$PROJECT_NUMBER" "$OWNER"
  ```

  If the issue isn't on any project board, mention it and continue.
  ```

- [ ] **Step 2: Bump issue-flow version and commit**

  ```bash
  # bump plugins/issue-flow/.claude-plugin/plugin.json to 1.3.6
  # bump .claude-plugin/marketplace.json issue-flow entry to 1.3.6
  git add plugins/issue-flow/
  git commit -m "feat(issue-flow): prefer github-projects MCP for board moves, keep script fallback"
  git push
  ```

---

## Self-review

**Spec coverage:**
- ✅ Research for existing servers (Task 1, pre-completed above)
- ✅ Separate GitHub repo (Tasks 1–7)
- ✅ `get_project_status_option` with case-insensitive lookup (Task 4)
- ✅ `move_project_item` (Task 5)
- ✅ Plugin in marketplace (Task 8)
- ✅ Issue-flow skill updated to prefer MCP (Task 9)

**Placeholder scan:** None found — all code blocks are complete.

**Type consistency:**
- `GraphQLClient` defined in `github.ts`, imported in both tools and `index.ts` ✅
- `getProjectStatusField` signature consistent across helper, tests, and tool imports ✅
- `field_id` / `option_id` keys consistent between `get-status-option.ts` and test assertions ✅
