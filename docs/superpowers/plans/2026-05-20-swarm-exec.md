# swarm-exec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `issue-flow:swarm-exec`, a harness-driven alternative to `/swarm` where Python drives the Navigator→Crewmate→Quartermaster loop via `claude -p` subprocesses, keeping the main agent context flat.

**Architecture:** A thin `SKILL.md` bootstraps the worktree and state (Steps 0–4 from `/swarm`), then blocks on `python3 swarm_executor.py`. The executor is a pure Python state machine that dispatches agents via `claude -p` subprocesses, schedules independent tasks in parallel with `ThreadPoolExecutor`, and enforces the retry cap + commit discipline in code rather than in model working memory.

**Tech Stack:** Python 3.10+, `pyyaml`, `pytest` (tests only), `claude` CLI (`-p` mode), existing bash helper scripts from `skills/swarm/scripts/`.

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `plugins/issue-flow/skills/swarm-exec/SKILL.md` | Bootstrap (Steps 0–4) + python call + voyage log |
| Create | `plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py` | Full Python state machine |
| Create | `tests/issue-flow/test_swarm_executor.py` | Unit tests (pytest) |
| Modify | `plugins/issue-flow/agents/navigator.md` | Add `depends_on` to PLAN task schema |
| Modify | `plugins/issue-flow/skills/swarm/templates/state-schema.json` | Add `depends_on` to task properties |
| Modify | `plugins/issue-flow/.claude-plugin/plugin.json` | Version bump to 1.6.0, register swarm-exec |
| Modify | `.claude-plugin/marketplace.json` | Version bump to 1.6.0 |

---

## Task 1: Add `depends_on` to Navigator agent and state schema

**Files:**
- Modify: `plugins/issue-flow/agents/navigator.md`
- Modify: `plugins/issue-flow/skills/swarm/templates/state-schema.json`

No automated test: these are prompt/schema text changes.

- [ ] **Step 1: Update the PLAN task format in navigator.md**

In `plugins/issue-flow/agents/navigator.md`, find the task format block inside the `### PLAN` example:

```
  - id: T1
    desc: <one-line description of what this task accomplishes>
    files: [path/one, path/two]
    acceptance: <how the Crewmate knows it's done>
```

Replace with:

```
  - id: T1
    desc: <one-line description of what this task accomplishes>
    files: [path/one, path/two]
    acceptance: <how the Crewmate knows it's done>
    depends_on: []
```

Then add a paragraph before the sanity-check bullet list explaining the field:

```
`depends_on` lists the ids of tasks that must be completed before this task can start. Tasks with no dependencies get `depends_on: []` and may run concurrently with other zero-dep tasks. Declare dependencies conservatively — only when a task genuinely needs a prior task's output to exist.
```

- [ ] **Step 2: Add `depends_on` to the task schema in state-schema.json**

In `plugins/issue-flow/skills/swarm/templates/state-schema.json`, find the task `properties` object (inside `plan.tasks.items.properties`) and add after `"acceptance"`:

```json
"depends_on": {
  "type": "array",
  "items": { "type": "string" },
  "default": []
}
```

- [ ] **Step 3: Commit**

```bash
git add plugins/issue-flow/agents/navigator.md \
        plugins/issue-flow/skills/swarm/templates/state-schema.json
git commit -m "feat(issue-flow): add depends_on field to Navigator plan schema

Enables the swarm-exec harness to schedule independent tasks in parallel.
Navigator emits depends_on: [] for tasks with no prerequisites.

Refs: swarm-exec design spec.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Create `swarm_executor.py` skeleton — arg parsing + state loading

**Files:**
- Create: `plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py`
- Create: `tests/issue-flow/test_swarm_executor.py`

Install test deps first: `pip install pytest pyyaml`

- [ ] **Step 1: Write failing tests for arg parsing and state loading**

Create `tests/issue-flow/test_swarm_executor.py`:

```python
"""Unit tests for swarm_executor.py"""
import json
import subprocess
import sys
import threading
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest
import yaml

# Add the executor to the path
sys.path.insert(0, str(Path(__file__).parent.parent.parent /
                        "plugins/issue-flow/skills/swarm-exec/scripts"))
import swarm_executor as sut


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def state_file(tmp_path):
    state = {
        "issue": 42,
        "repo": "owner/repo",
        "title": "Fix the thing",
        "branch": "claude/issue-42-fix-thing",
        "started_at": "2026-01-01T00:00:00Z",
        "phase": "planning",
        "plan": None,
        "current_task": None,
        "quartermaster_attempts": {},
        "handoff_log": []
    }
    f = tmp_path / "issue-42.json"
    f.write_text(json.dumps(state))
    return f


@pytest.fixture
def state_file_with_inprogress(tmp_path):
    state = {
        "issue": 42,
        "repo": "owner/repo",
        "title": "Fix the thing",
        "branch": "claude/issue-42-fix-thing",
        "started_at": "2026-01-01T00:00:00Z",
        "phase": "building",
        "plan": {
            "tasks": [
                {"id": "T1", "desc": "do T1", "status": "completed", "depends_on": []},
                {"id": "T2", "desc": "do T2", "status": "in_progress", "depends_on": ["T1"]},
            ]
        },
        "current_task": "T2",
        "quartermaster_attempts": {},
        "handoff_log": []
    }
    f = tmp_path / "issue-42.json"
    f.write_text(json.dumps(state))
    return f


# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------

class TestParseArgs:
    def test_required_args(self, tmp_path):
        state_file = tmp_path / "state.json"
        state_file.touch()
        args = sut.parse_args([
            "--state", str(state_file),
            "--worktree", str(tmp_path),
            "--owner", "alice",
            "--repo", "myrepo",
            "--issue", "7",
            "--swarm-scripts", str(tmp_path),
            "--issue-body-file", str(state_file),
        ])
        assert args.issue == 7
        assert args.owner == "alice"
        assert args.repo == "myrepo"
        assert args.timeout == 300  # default

    def test_custom_timeout(self, tmp_path):
        state_file = tmp_path / "state.json"
        state_file.touch()
        args = sut.parse_args([
            "--state", str(state_file),
            "--worktree", str(tmp_path),
            "--owner", "alice",
            "--repo", "myrepo",
            "--issue", "7",
            "--swarm-scripts", str(tmp_path),
            "--issue-body-file", str(state_file),
            "--timeout", "600",
        ])
        assert args.timeout == 600


# ---------------------------------------------------------------------------
# State loading
# ---------------------------------------------------------------------------

class TestLoadState:
    def test_loads_json(self, state_file):
        state = sut.load_state(state_file)
        assert state["issue"] == 42
        assert state["phase"] == "planning"

    def test_resets_in_progress_to_pending(self, state_file_with_inprogress):
        state = sut.load_state(state_file_with_inprogress)
        tasks = state["plan"]["tasks"]
        t2 = next(t for t in tasks if t["id"] == "T2")
        assert t2["status"] == "pending"

    def test_leaves_completed_unchanged(self, state_file_with_inprogress):
        state = sut.load_state(state_file_with_inprogress)
        tasks = state["plan"]["tasks"]
        t1 = next(t for t in tasks if t["id"] == "T1")
        assert t1["status"] == "completed"
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /path/to/claude-plugin-marketplace
pytest tests/issue-flow/test_swarm_executor.py -v
```

Expected: `ModuleNotFoundError: No module named 'swarm_executor'` (file doesn't exist yet).

- [ ] **Step 3: Create the executor skeleton**

Create `plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py`:

```python
#!/usr/bin/env python3
"""
Harness-driven orchestrator for issue-flow swarm.
Invoked by skills/swarm-exec/SKILL.md after worktree setup.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed, Future
from pathlib import Path
from typing import Optional

import yaml


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="issue-flow swarm executor")
    p.add_argument("--state", required=True, type=Path)
    p.add_argument("--worktree", required=True, type=Path)
    p.add_argument("--owner", required=True)
    p.add_argument("--repo", required=True)
    p.add_argument("--issue", required=True, type=int)
    p.add_argument("--swarm-scripts", required=True, type=Path)
    p.add_argument("--issue-body-file", required=True, type=Path)
    p.add_argument("--timeout", type=int, default=300)
    return p.parse_args(argv)


# ---------------------------------------------------------------------------
# State management
# ---------------------------------------------------------------------------

def load_state(state_file: Path) -> dict:
    """Load state JSON; reset any in_progress tasks to pending."""
    state = json.loads(state_file.read_text())
    if state.get("plan") and state["plan"].get("tasks"):
        for task in state["plan"]["tasks"]:
            if task.get("status") == "in_progress":
                task["status"] = "pending"
    return state


def save_state(state_file: Path, state: dict, lock: threading.Lock) -> None:
    with lock:
        tmp = state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, indent=2))
        tmp.replace(state_file)


def run_script(swarm_scripts: Path, script_name: str, *args: str) -> subprocess.CompletedProcess:
    script = swarm_scripts / script_name
    return subprocess.run(
        ["bash", str(script)] + list(args),
        capture_output=True, text=True, check=True
    )


# ---------------------------------------------------------------------------
# Main (placeholder — expanded in later tasks)
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    state_lock = threading.Lock()
    state = load_state(args.state)
    print(f"[swarm-exec] Loaded state: phase={state['phase']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestParseArgs \
       tests/issue-flow/test_swarm_executor.py::TestLoadState -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py \
        tests/issue-flow/test_swarm_executor.py
git commit -m "feat(swarm-exec): skeleton executor with arg parsing and state loading

Resets in_progress tasks to pending on load for safe parallel resume.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Dependency graph — cycle detection and ready-set computation

**Files:**
- Modify: `plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py`
- Modify: `tests/issue-flow/test_swarm_executor.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/issue-flow/test_swarm_executor.py`:

```python
# ---------------------------------------------------------------------------
# Dependency graph
# ---------------------------------------------------------------------------

class TestDetectCycles:
    def _tasks(self, specs):
        return [{"id": tid, "depends_on": deps, "status": "pending"}
                for tid, deps in specs]

    def test_no_deps_no_cycle(self):
        tasks = self._tasks([("T1", []), ("T2", [])])
        assert sut.detect_cycles(tasks) is None

    def test_linear_chain_no_cycle(self):
        tasks = self._tasks([("T1", []), ("T2", ["T1"]), ("T3", ["T2"])])
        assert sut.detect_cycles(tasks) is None

    def test_direct_cycle(self):
        tasks = self._tasks([("T1", ["T2"]), ("T2", ["T1"])])
        cycle = sut.detect_cycles(tasks)
        assert cycle is not None
        assert "T1" in cycle and "T2" in cycle

    def test_indirect_cycle(self):
        tasks = self._tasks([("T1", ["T3"]), ("T2", ["T1"]), ("T3", ["T2"])])
        cycle = sut.detect_cycles(tasks)
        assert cycle is not None


class TestComputeReadySet:
    def _tasks(self, specs):
        return [{"id": tid, "depends_on": deps, "status": st}
                for tid, deps, st in specs]

    def test_all_pending_no_deps(self):
        tasks = self._tasks([("T1", [], "pending"), ("T2", [], "pending")])
        ready = sut.compute_ready_set(tasks)
        assert {t["id"] for t in ready} == {"T1", "T2"}

    def test_dependent_blocked_until_dep_completes(self):
        tasks = self._tasks([
            ("T1", [], "completed"),
            ("T2", ["T1"], "pending"),
        ])
        ready = sut.compute_ready_set(tasks)
        assert [t["id"] for t in ready] == ["T2"]

    def test_dep_not_yet_done_blocks_task(self):
        tasks = self._tasks([
            ("T1", [], "pending"),
            ("T2", ["T1"], "pending"),
        ])
        ready = sut.compute_ready_set(tasks)
        assert [t["id"] for t in ready] == ["T1"]

    def test_in_progress_not_included(self):
        tasks = self._tasks([("T1", [], "in_progress")])
        assert sut.compute_ready_set(tasks) == []
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestDetectCycles \
       tests/issue-flow/test_swarm_executor.py::TestComputeReadySet -v
```

Expected: `AttributeError: module 'swarm_executor' has no attribute 'detect_cycles'`.

- [ ] **Step 3: Add `detect_cycles` and `compute_ready_set` to swarm_executor.py**

Add after `run_script`:

```python
# ---------------------------------------------------------------------------
# Dependency graph
# ---------------------------------------------------------------------------

def detect_cycles(tasks: list[dict]) -> list[str] | None:
    """Return a cycle as a list of task ids, or None if graph is acyclic."""
    task_ids = {t["id"] for t in tasks}
    deps = {t["id"]: set(t.get("depends_on") or []) for t in tasks}
    visited: set[str] = set()
    path: list[str] = []
    path_set: set[str] = set()

    def dfs(node: str) -> list[str] | None:
        if node in path_set:
            start = path.index(node)
            return path[start:] + [node]
        if node in visited:
            return None
        visited.add(node)
        path.append(node)
        path_set.add(node)
        for dep in deps.get(node, set()):
            if dep not in task_ids:
                continue
            result = dfs(dep)
            if result:
                return result
        path.pop()
        path_set.discard(node)
        return None

    for tid in task_ids:
        if tid not in visited:
            cycle = dfs(tid)
            if cycle:
                return cycle
    return None


def compute_ready_set(tasks: list[dict]) -> list[dict]:
    """Tasks eligible to start: pending and all depends_on are completed."""
    completed = {t["id"] for t in tasks if t["status"] == "completed"}
    return [
        t for t in tasks
        if t["status"] == "pending"
        and all(dep in completed for dep in (t.get("depends_on") or []))
    ]
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestDetectCycles \
       tests/issue-flow/test_swarm_executor.py::TestComputeReadySet -v
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py \
        tests/issue-flow/test_swarm_executor.py
git commit -m "feat(swarm-exec): dependency graph utilities

detect_cycles uses DFS; compute_ready_set returns tasks whose
depends_on are all completed.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Structured block parser and agent file utilities

**Files:**
- Modify: `plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py`
- Modify: `tests/issue-flow/test_swarm_executor.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/issue-flow/test_swarm_executor.py`:

```python
# ---------------------------------------------------------------------------
# Block parser and agent file utilities
# ---------------------------------------------------------------------------

class TestExtractBlock:
    def test_extracts_simple_block(self):
        output = "Some preamble\n### PLAN\nkey: value\n### END PLAN\nTrailing text"
        result = sut.extract_block(output, "PLAN")
        assert result == "key: value"

    def test_returns_none_on_miss(self):
        assert sut.extract_block("no block here", "PLAN") is None

    def test_multiline_content(self):
        output = "### CREW_REPORT\ntask_id: T1\nstatus: completed\n### END CREW_REPORT"
        result = sut.extract_block(output, "CREW_REPORT")
        assert "task_id: T1" in result
        assert "status: completed" in result

    def test_extracts_yaml_parseable_content(self):
        output = "### VERDICT\ntask_id: T1\nstatus: PASS\nfixes_needed: []\n### END VERDICT"
        raw = sut.extract_block(output, "VERDICT")
        parsed = yaml.safe_load(raw)
        assert parsed["status"] == "PASS"
        assert parsed["fixes_needed"] == []


class TestStripFrontmatter:
    def test_strips_yaml_header(self):
        text = "---\nname: navigator\ndescription: foo\n---\nActual content here"
        result = sut.strip_frontmatter(text)
        assert result == "Actual content here"

    def test_no_frontmatter_unchanged(self):
        text = "Just the content"
        assert sut.strip_frontmatter(text) == "Just the content"
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestExtractBlock \
       tests/issue-flow/test_swarm_executor.py::TestStripFrontmatter -v
```

Expected: `AttributeError: module 'swarm_executor' has no attribute 'extract_block'`.

- [ ] **Step 3: Add `extract_block` and `strip_frontmatter` to swarm_executor.py**

Add after `compute_ready_set`:

```python
# ---------------------------------------------------------------------------
# Structured block parsing and agent file utilities
# ---------------------------------------------------------------------------

def extract_block(output: str, tag: str) -> str | None:
    """Extract content between ### TAG and ### END TAG."""
    pattern = rf"### {re.escape(tag)}\n(.*?)\n### END {re.escape(tag)}"
    m = re.search(pattern, output, re.DOTALL)
    return m.group(1).strip() if m else None


def strip_frontmatter(text: str) -> str:
    """Remove YAML frontmatter (--- ... ---) from agent definition files."""
    return re.sub(r"^---\n.*?\n---\n", "", text, flags=re.DOTALL, count=1).strip()
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestExtractBlock \
       tests/issue-flow/test_swarm_executor.py::TestStripFrontmatter -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py \
        tests/issue-flow/test_swarm_executor.py
git commit -m "feat(swarm-exec): structured block parser and agent file utilities

extract_block uses regex with DOTALL; strip_frontmatter removes
YAML --- delimiters so agent files can be used as claude -p prompts.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Agent dispatch function

**Files:**
- Modify: `plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py`
- Modify: `tests/issue-flow/test_swarm_executor.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/issue-flow/test_swarm_executor.py`:

```python
# ---------------------------------------------------------------------------
# Agent dispatch
# ---------------------------------------------------------------------------

class TestDispatchAgent:
    GOOD_OUTPUT = "Some text\n### PLAN\ntasks: []\nsummary: ok\n### END PLAN\nDone."

    def _run(self, returncode=0, stdout=GOOD_OUTPUT, stderr="", timeout=False):
        if timeout:
            return patch("swarm_executor.subprocess.run",
                         side_effect=subprocess.TimeoutExpired("claude", 300))
        r = MagicMock()
        r.returncode = returncode
        r.stdout = stdout
        r.stderr = stderr
        return patch("swarm_executor.subprocess.run", return_value=r)

    def test_success_returns_parsed_yaml(self):
        with self._run():
            raw, parsed = sut.dispatch_agent(
                "navigator", "prompt", Path("/tmp"), 300, "PLAN"
            )
        assert parsed["tasks"] == []
        assert parsed["summary"] == "ok"

    def test_missing_block_retries_with_suffix(self):
        no_block = "No plan block here."
        good = "### PLAN\ntasks: []\nsummary: ok\n### END PLAN"
        calls = [
            MagicMock(returncode=0, stdout=no_block, stderr=""),
            MagicMock(returncode=0, stdout=good, stderr=""),
        ]
        with patch("swarm_executor.subprocess.run", side_effect=calls):
            raw, parsed = sut.dispatch_agent(
                "navigator", "prompt", Path("/tmp"), 300, "PLAN"
            )
        assert parsed["summary"] == "ok"

    def test_non_zero_exit_retries_once_then_raises(self):
        fail = MagicMock(returncode=1, stdout="", stderr="fatal error")
        with patch("swarm_executor.subprocess.run", return_value=fail):
            with pytest.raises(RuntimeError, match="exited 1"):
                sut.dispatch_agent("navigator", "prompt", Path("/tmp"), 300, "PLAN")

    def test_timeout_on_both_attempts_raises(self):
        with patch("swarm_executor.subprocess.run",
                   side_effect=subprocess.TimeoutExpired("claude", 300)):
            with pytest.raises(RuntimeError, match="timed out"):
                sut.dispatch_agent("navigator", "prompt", Path("/tmp"), 300, "PLAN")

    def test_two_consecutive_missing_blocks_raises(self):
        no_block = MagicMock(returncode=0, stdout="no block", stderr="")
        with patch("swarm_executor.subprocess.run", return_value=no_block):
            with pytest.raises(RuntimeError, match="Missing ### PLAN"):
                sut.dispatch_agent("navigator", "prompt", Path("/tmp"), 300, "PLAN")
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestDispatchAgent -v
```

Expected: `AttributeError: module 'swarm_executor' has no attribute 'dispatch_agent'`.

- [ ] **Step 3: Add `AGENT_TOOLS` constant and `dispatch_agent` to swarm_executor.py**

Add after `strip_frontmatter`:

```python
# ---------------------------------------------------------------------------
# Agent dispatch
# ---------------------------------------------------------------------------

AGENT_TOOLS = {
    "navigator": "Read,Grep,Glob,Bash,WebFetch",
    "crewmate": "Read,Write,Edit,Bash,Grep,Glob",
    "quartermaster": "Read,Grep,Glob,Bash",
}


def dispatch_agent(
    agent: str,
    prompt: str,
    worktree: Path,
    timeout: int,
    tag: str,
) -> tuple[str, dict]:
    """
    Call claude -p and extract the structured block.
    Retries once on non-zero exit or missing block.
    Returns (raw_output, parsed_yaml_dict).
    Raises RuntimeError if both attempts fail.
    """
    tools = AGENT_TOOLS[agent]

    for attempt in range(2):
        p = prompt if attempt == 0 else (
            prompt + f"\n\nIMPORTANT: Your previous response was missing the required "
            f"### {tag} block. You MUST include a ### {tag} ... ### END {tag} block."
        )
        try:
            result = subprocess.run(
                ["claude", "-p", p, "--allowedTools", tools],
                capture_output=True, text=True, timeout=timeout,
                cwd=str(worktree)
            )
        except subprocess.TimeoutExpired:
            if attempt == 0:
                continue
            raise RuntimeError(f"claude -p timed out after {timeout}s on both attempts")

        if result.returncode != 0:
            if attempt == 0:
                continue
            raise RuntimeError(f"claude -p exited {result.returncode}:\n{result.stderr}")

        block = extract_block(result.stdout, tag)
        if block is None:
            if attempt == 0:
                continue
            raise RuntimeError(
                f"Missing ### {tag} block after two attempts. Output:\n{result.stdout[:500]}"
            )

        parsed = yaml.safe_load(block)
        return result.stdout, parsed

    raise RuntimeError("Unreachable")
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestDispatchAgent -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py \
        tests/issue-flow/test_swarm_executor.py
git commit -m "feat(swarm-exec): agent dispatch via claude -p subprocess

Retries once on non-zero exit or missing structured block.
Timeout treated as non-zero exit. Both attempts failing raises RuntimeError.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Planning phase (Navigator dispatch + plan validation)

**Files:**
- Modify: `plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py`
- Modify: `tests/issue-flow/test_swarm_executor.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/issue-flow/test_swarm_executor.py`:

```python
# ---------------------------------------------------------------------------
# Planning phase
# ---------------------------------------------------------------------------

class TestBuildNavigatorPrompt:
    def test_strips_frontmatter_and_appends_issue(self, tmp_path):
        agent_dir = tmp_path / "agents"
        agent_dir.mkdir()
        (agent_dir / "navigator.md").write_text(
            "---\nname: navigator\n---\nNavigator instructions here."
        )
        prompt = sut.build_navigator_prompt(agent_dir, 42, "The issue body text.")
        assert "Navigator instructions here." in prompt
        assert "Issue #42" in prompt
        assert "The issue body text." in prompt
        assert "---\nname: navigator" not in prompt


class TestValidatePlan:
    def test_valid_plan_passes(self):
        tasks = [
            {"id": "T1", "desc": "x", "depends_on": []},
            {"id": "T2", "desc": "y", "depends_on": ["T1"]},
        ]
        sut.validate_plan({}, tasks)  # should not raise

    def test_unknown_depends_on_raises(self):
        tasks = [{"id": "T1", "desc": "x", "depends_on": ["T99"]}]
        with pytest.raises(ValueError, match="unknown depends_on: T99"):
            sut.validate_plan({}, tasks)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestBuildNavigatorPrompt \
       tests/issue-flow/test_swarm_executor.py::TestValidatePlan -v
```

Expected: `AttributeError: module 'swarm_executor' has no attribute 'build_navigator_prompt'`.

- [ ] **Step 3: Add planning phase functions to swarm_executor.py**

Add after `dispatch_agent`:

```python
# ---------------------------------------------------------------------------
# Planning phase
# ---------------------------------------------------------------------------

def build_navigator_prompt(agent_dir: Path, issue_number: int, issue_body: str) -> str:
    raw = (agent_dir / "navigator.md").read_text()
    instructions = strip_frontmatter(raw)
    return f"{instructions}\n\n---\n\nIssue #{issue_number}:\n\n{issue_body}"


def validate_plan(plan: dict, tasks: list[dict]) -> None:
    """Raise ValueError if any depends_on references an unknown task id."""
    task_ids = {t["id"] for t in tasks}
    for t in tasks:
        for dep in (t.get("depends_on") or []):
            if dep not in task_ids:
                raise ValueError(f"Task {t['id']} has unknown depends_on: {dep}")


def run_planning_phase(
    args: argparse.Namespace,
    state: dict,
    state_lock: threading.Lock,
) -> None:
    agent_dir = args.swarm_scripts.parent.parent.parent / "agents"
    issue_body = args.issue_body_file.read_text()

    run_script(args.swarm_scripts, "append-handoff.sh",
               str(args.state), "Captain", "Navigator",
               f"chart course for issue #{args.issue}", "dispatched")

    prompt = build_navigator_prompt(agent_dir, args.issue, issue_body)
    _stdout, plan_yaml = dispatch_agent(
        "navigator", prompt, args.worktree, args.timeout, "PLAN"
    )

    tasks = plan_yaml.get("tasks") or []
    for t in tasks:
        t.setdefault("status", "pending")
        t.setdefault("depends_on", [])
    plan_yaml["tasks"] = tasks

    validate_plan(plan_yaml, tasks)

    cycle = detect_cycles(tasks)
    if cycle:
        raise RuntimeError(f"Circular dependency in plan: {' -> '.join(cycle)}")

    plan_file = args.state.parent / f"plan-{args.issue}.json"
    plan_file.write_text(json.dumps(plan_yaml, indent=2))
    run_script(args.swarm_scripts, "set-plan.sh", str(args.state), str(plan_file))

    updated = load_state(args.state)
    state.update(updated)

    run_script(args.swarm_scripts, "append-handoff.sh",
               str(args.state), "Navigator", "Captain",
               f"{len(tasks)} tasks, revision {plan_yaml.get('revision', 1)}", "ok")

    open_qs = plan_yaml.get("open_questions") or []
    if open_qs:
        print("\nNavigator has open questions for you:")
        for q in open_qs:
            print(f"  ? {q}")
        input("Press Enter when ready to continue...")
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestBuildNavigatorPrompt \
       tests/issue-flow/test_swarm_executor.py::TestValidatePlan -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py \
        tests/issue-flow/test_swarm_executor.py
git commit -m "feat(swarm-exec): planning phase with Navigator dispatch and plan validation

Validates depends_on refs and detects cycles before any Crewmate is
dispatched. Pauses for user input if Navigator emits open_questions.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Per-task execution — Crewmate, Quartermaster, commit, escalation

**Files:**
- Modify: `plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py`
- Modify: `tests/issue-flow/test_swarm_executor.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/issue-flow/test_swarm_executor.py`:

```python
# ---------------------------------------------------------------------------
# Per-task execution
# ---------------------------------------------------------------------------

class TestBuildCrewmatePrompt:
    def test_includes_task_spec(self, tmp_path):
        agent_dir = tmp_path / "agents"
        agent_dir.mkdir()
        (agent_dir / "crewmate.md").write_text("---\nname: crewmate\n---\nDo the work.")
        task = {"id": "T1", "desc": "Add foo", "files": ["src/foo.py"], "acceptance": "foo exists"}
        prompt = sut.build_crewmate_prompt(agent_dir, task, fixes_needed=None)
        assert "Do the work." in prompt
        assert "T1" in prompt
        assert "Add foo" in prompt

    def test_includes_fixes_needed_when_present(self, tmp_path):
        agent_dir = tmp_path / "agents"
        agent_dir.mkdir()
        (agent_dir / "crewmate.md").write_text("---\nname: crewmate\n---\nInstructions.")
        task = {"id": "T1", "desc": "x", "files": [], "acceptance": "y"}
        prompt = sut.build_crewmate_prompt(agent_dir, task, fixes_needed=["Fix the null case"])
        assert "Fix the null case" in prompt


class TestCommitTask:
    def test_calls_git_add_and_commit(self, tmp_path):
        task = {"id": "T2", "desc": "Implement the feature", "depends_on": []}
        files_changed = [{"path": "src/foo.py"}, {"path": "tests/test_foo.py"}]
        git_lock = threading.Lock()
        calls = []
        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            r = MagicMock()
            r.returncode = 0
            return r
        with patch("swarm_executor.subprocess.run", side_effect=fake_run):
            sut.commit_task(task, files_changed, 42, tmp_path, git_lock)
        assert calls[0] == ["git", "add", "src/foo.py", "tests/test_foo.py"]
        assert calls[1][0:2] == ["git", "commit"]
        commit_msg = calls[1][calls[1].index("-m") + 1]
        assert "T2" in commit_msg
        assert "Refs #42" in commit_msg
        assert "Co-Authored-By" in commit_msg


class TestRunTask:
    def _make_args(self, tmp_path):
        state_file = tmp_path / "state.json"
        state = {
            "issue": 42, "repo": "o/r", "title": "t", "branch": "b",
            "started_at": "2026-01-01T00:00:00Z",
            "phase": "building",
            "plan": {"tasks": [{"id": "T1", "desc": "do it", "files": [], "acceptance": "done",
                                 "status": "pending", "depends_on": []}]},
            "current_task": "T1",
            "quartermaster_attempts": {},
            "handoff_log": []
        }
        state_file.write_text(json.dumps(state))
        args = MagicMock()
        args.state = state_file
        args.worktree = tmp_path
        args.timeout = 30
        args.issue = 42
        args.swarm_scripts = tmp_path / "scripts"
        (tmp_path / "scripts").mkdir()
        # Create stub bash scripts that do nothing
        for name in ["append-handoff.sh", "update-state.sh"]:
            script = tmp_path / "scripts" / name
            script.write_text("#!/usr/bin/env bash\nexit 0\n")
            script.chmod(0o755)
        # Create stub agent files
        agents_dir = tmp_path / "agents"
        agents_dir.mkdir()
        (agents_dir / "crewmate.md").write_text("---\nname: crewmate\n---\nDo the task.")
        (agents_dir / "quartermaster.md").write_text("---\nname: qm\n---\nReview the task.")
        # Patch agent_dir resolution: swarm_scripts.parent.parent.parent / "agents"
        args.swarm_scripts.parent.parent.parent  # evaluates on MagicMock
        return args, json.loads(state_file.read_text())

    def _crew_output(self, status="completed", plan_problem=None):
        body = f"task_id: T1\nstatus: {status}\nfiles_changed:\n  - path: src/foo.py\n    action: modified\n    summary: did it\nnotes: ''"
        if plan_problem:
            body += f"\nplan_problem: {plan_problem}"
        return f"### CREW_REPORT\n{body}\n### END CREW_REPORT"

    def _qm_output(self, status="PASS"):
        return (f"### VERDICT\ntask_id: T1\nstatus: {status}\n"
                f"checks: []\nfixes_needed: []\nnotes: ''\n### END VERDICT")

    def test_pass_flow_returns_completed(self, tmp_path):
        args, state = self._make_args(tmp_path)
        state_lock = threading.Lock()
        git_lock = threading.Lock()
        task = state["plan"]["tasks"][0]
        crew_report = {"status": "completed", "files_changed": [{"path": "src/foo.py"}], "notes": ""}
        verdict = {"status": "PASS", "fixes_needed": [], "checks": []}
        with patch("swarm_executor.dispatch_agent", side_effect=[
                       ("raw", crew_report), ("raw", verdict)]), \
             patch("swarm_executor.build_crewmate_prompt", return_value="crewmate prompt"), \
             patch("swarm_executor.build_quartermaster_prompt", return_value="qm prompt"), \
             patch("swarm_executor.run_script"), \
             patch("swarm_executor.commit_task"), \
             patch("swarm_executor.save_state"):
            result = sut.run_task(task, args, state, state_lock, git_lock)
        assert result == "completed"

    def test_plan_problem_returns_replan(self, tmp_path):
        args, state = self._make_args(tmp_path)
        state_lock = threading.Lock()
        git_lock = threading.Lock()
        task = state["plan"]["tasks"][0]
        crew_report = {"status": "plan_problem", "plan_problem": "file missing",
                       "files_changed": [], "notes": ""}
        with patch("swarm_executor.dispatch_agent", return_value=("raw", crew_report)), \
             patch("swarm_executor.build_crewmate_prompt", return_value="crewmate prompt"), \
             patch("swarm_executor.run_script"), \
             patch("swarm_executor.save_state"):
            result = sut.run_task(task, args, state, state_lock, git_lock)
        assert result.startswith("replan:")
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestBuildCrewmatePrompt \
       tests/issue-flow/test_swarm_executor.py::TestCommitTask \
       tests/issue-flow/test_swarm_executor.py::TestRunTask -v
```

Expected: `AttributeError: module 'swarm_executor' has no attribute 'build_crewmate_prompt'`.

- [ ] **Step 3: Add per-task execution functions to swarm_executor.py**

Add after `run_planning_phase`:

```python
# ---------------------------------------------------------------------------
# Building phase — per-task execution
# ---------------------------------------------------------------------------

def build_crewmate_prompt(agent_dir: Path, task: dict, fixes_needed: list | None) -> str:
    raw = (agent_dir / "crewmate.md").read_text()
    instructions = strip_frontmatter(raw)
    ctx = (
        f"Task:\n  id: {task['id']}\n  desc: {task['desc']}\n"
        f"  files: {task.get('files', [])}\n  acceptance: {task.get('acceptance', '')}"
    )
    if fixes_needed:
        fixes = "\n".join(f"  - {f}" for f in fixes_needed)
        ctx += f"\n\nQuartermaster fixes required:\n{fixes}"
    return f"{instructions}\n\n---\n\n{ctx}"


def build_quartermaster_prompt(agent_dir: Path, task: dict, crew_report: dict) -> str:
    raw = (agent_dir / "quartermaster.md").read_text()
    instructions = strip_frontmatter(raw)
    ctx = (
        f"Task spec:\n  id: {task['id']}\n  desc: {task['desc']}\n"
        f"  acceptance: {task.get('acceptance', '')}\n\n"
        f"Crewmate report:\n  status: {crew_report.get('status')}\n"
        f"  files_changed: {crew_report.get('files_changed', [])}\n"
        f"  notes: {crew_report.get('notes', '')}"
    )
    return f"{instructions}\n\n---\n\n{ctx}"


def commit_task(
    task: dict,
    files_changed: list,
    issue_number: int,
    worktree: Path,
    git_lock: threading.Lock,
) -> None:
    task_id = task["id"]
    desc = task["desc"][:60]
    msg = (
        f"feat(issue-{issue_number}): {task_id} - {desc}\n\n"
        f"Refs #{issue_number}.\n\n"
        f"Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
    )
    paths = [fc["path"] for fc in files_changed if isinstance(fc, dict) and fc.get("path")]
    with git_lock:
        subprocess.run(["git", "add"] + paths, cwd=str(worktree), check=True)
        subprocess.run(["git", "commit", "-m", msg], cwd=str(worktree), check=True)


def escalate_to_user(task_id: str) -> str:
    """Print escalation menu; return 'skip' | 'replan' | 'handoff'."""
    print(f"\nQuartermaster has rejected task {task_id} on all 3 Crewmate attempts.")
    print("  1. Hand back to you (user) for direct help.")
    print("  2. Skip this task and continue.")
    print("  3. Re-plan via the Navigator with the failure context.")
    while True:
        choice = input("Choice [1/2/3]: ").strip()
        if choice == "1":
            return "handoff"
        if choice == "2":
            return "skip"
        if choice == "3":
            return "replan"
        print("Please enter 1, 2, or 3.")


def run_task(
    task: dict,
    args: argparse.Namespace,
    state: dict,
    state_lock: threading.Lock,
    git_lock: threading.Lock,
) -> str:
    """
    Run one task through Crewmate → Quartermaster.
    Returns: 'completed' | 'skipped' | 'replan:<reason>' | 'handoff'
    """
    agent_dir = args.swarm_scripts.parent.parent.parent / "agents"
    task_id = task["id"]
    fixes_needed: list[str] | None = None

    for attempt in range(1, 4):
        with state_lock:
            for t in state["plan"]["tasks"]:
                if t["id"] == task_id:
                    t["status"] = "in_progress"
            save_state(args.state, state, state_lock)

        run_script(args.swarm_scripts, "append-handoff.sh",
                   str(args.state), "Captain", f"Crewmate({task_id})",
                   task["desc"], "dispatched")

        crewmate_prompt = build_crewmate_prompt(agent_dir, task, fixes_needed)
        try:
            _out, crew_report = dispatch_agent(
                "crewmate", crewmate_prompt, args.worktree, args.timeout, "CREW_REPORT"
            )
        except RuntimeError as e:
            print(f"[ERROR] Crewmate dispatch failed for {task_id}: {e}", file=sys.stderr)
            return "handoff"

        if crew_report.get("status") == "plan_problem":
            reason = crew_report.get("plan_problem", "unspecified plan problem")
            return f"replan:{reason}"

        run_script(args.swarm_scripts, "append-handoff.sh",
                   str(args.state), f"Crewmate({task_id})", "Captain",
                   "files changed", "ok")

        run_script(args.swarm_scripts, "update-state.sh", str(args.state),
                   f'.quartermaster_attempts["{task_id}"] = '
                   f'((.quartermaster_attempts["{task_id}"] // 0) + 1)')

        run_script(args.swarm_scripts, "append-handoff.sh",
                   str(args.state), f"Crewmate({task_id})", "Quartermaster",
                   f"review task {task_id}", "dispatched")

        qm_prompt = build_quartermaster_prompt(agent_dir, task, crew_report)
        try:
            _out, verdict = dispatch_agent(
                "quartermaster", qm_prompt, args.worktree, args.timeout, "VERDICT"
            )
        except RuntimeError as e:
            print(f"[ERROR] Quartermaster dispatch failed for {task_id}: {e}", file=sys.stderr)
            return "handoff"

        qm_status = verdict.get("status", "FAIL")
        run_script(args.swarm_scripts, "append-handoff.sh",
                   str(args.state), "Quartermaster", "Captain",
                   f"verdict on {task_id}", qm_status)

        if qm_status == "PASS":
            files_changed = crew_report.get("files_changed") or []
            commit_task(task, files_changed, args.issue, args.worktree, git_lock)
            with state_lock:
                for t in state["plan"]["tasks"]:
                    if t["id"] == task_id:
                        t["status"] = "completed"
                save_state(args.state, state, state_lock)
            run_script(args.swarm_scripts, "append-handoff.sh",
                       str(args.state), "Captain", "git",
                       f"commit {task_id}", "ok")
            return "completed"

        fixes_needed = verdict.get("fixes_needed") or []
        if attempt < 3:
            run_script(args.swarm_scripts, "append-handoff.sh",
                       str(args.state), "Captain", f"Crewmate({task_id})",
                       f"retry {task_id} attempt {attempt + 1}", "dispatched")

    choice = escalate_to_user(task_id)
    if choice == "skip":
        with state_lock:
            for t in state["plan"]["tasks"]:
                if t["id"] == task_id:
                    t["status"] = "failed"
            save_state(args.state, state, state_lock)
        return "skipped"
    if choice == "replan":
        return f"replan:3 consecutive failures on {task_id}"
    return "handoff"
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestBuildCrewmatePrompt \
       tests/issue-flow/test_swarm_executor.py::TestCommitTask \
       tests/issue-flow/test_swarm_executor.py::TestRunTask -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py \
        tests/issue-flow/test_swarm_executor.py
git commit -m "feat(swarm-exec): per-task Crewmate/Quartermaster cycle

Retry cap enforced in code (3 attempts max). PASS triggers git commit
via threading.Lock. plan_problem short-circuits to re-plan signal.
3x FAIL escalates to user via stdin menu.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Parallel building phase scheduler

**Files:**
- Modify: `plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py`
- Modify: `tests/issue-flow/test_swarm_executor.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/issue-flow/test_swarm_executor.py`:

```python
# ---------------------------------------------------------------------------
# Parallel building phase
# ---------------------------------------------------------------------------

class TestRunBuildingPhase:
    def _state_with_tasks(self, tmp_path, task_specs):
        """task_specs: list of (id, depends_on, status)"""
        tasks = [
            {"id": tid, "desc": f"do {tid}", "files": [], "acceptance": "done",
             "status": st, "depends_on": deps}
            for tid, deps, st in task_specs
        ]
        state = {
            "issue": 1, "repo": "o/r", "title": "t", "branch": "b",
            "started_at": "2026-01-01T00:00:00Z",
            "phase": "building",
            "plan": {"tasks": tasks, "revision": 1},
            "current_task": tasks[0]["id"] if tasks else None,
            "quartermaster_attempts": {},
            "handoff_log": []
        }
        sf = tmp_path / "state.json"
        sf.write_text(json.dumps(state))
        return sf, state

    def test_single_task_completes_and_marks_done(self, tmp_path):
        sf, state = self._state_with_tasks(tmp_path, [("T1", [], "pending")])
        args = MagicMock()
        args.state = sf
        args.swarm_scripts = tmp_path / "scripts"
        (tmp_path / "scripts").mkdir()
        state_lock = threading.Lock()

        with patch("swarm_executor.run_task", return_value="completed"), \
             patch("swarm_executor.run_script"), \
             patch("swarm_executor.load_state", side_effect=[
                 {**state, "plan": {**state["plan"],
                  "tasks": [{**state["plan"]["tasks"][0], "status": "completed"}]}},
             ]):
            sut.run_building_phase(args, state, state_lock)

        assert state["phase"] == "done"

    def test_two_independent_tasks_run_concurrently(self, tmp_path):
        sf, state = self._state_with_tasks(tmp_path, [
            ("T1", [], "pending"), ("T2", [], "pending")
        ])
        args = MagicMock()
        args.state = sf
        args.swarm_scripts = tmp_path / "scripts"
        (tmp_path / "scripts").mkdir()
        state_lock = threading.Lock()
        dispatch_order = []

        def fake_run_task(task, *a, **kw):
            dispatch_order.append(task["id"])
            for t in state["plan"]["tasks"]:
                if t["id"] == task["id"]:
                    t["status"] = "completed"
            return "completed"

        completed_state = {**state, "plan": {**state["plan"],
            "tasks": [{"id": "T1", "desc": "x", "depends_on": [], "status": "completed"},
                      {"id": "T2", "desc": "y", "depends_on": [], "status": "completed"}]}}

        with patch("swarm_executor.run_task", side_effect=fake_run_task), \
             patch("swarm_executor.run_script"), \
             patch("swarm_executor.load_state", return_value=completed_state):
            sut.run_building_phase(args, state, state_lock)

        assert set(dispatch_order) == {"T1", "T2"}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/issue-flow/test_swarm_executor.py::TestRunBuildingPhase -v
```

Expected: `AttributeError: module 'swarm_executor' has no attribute 'run_building_phase'`.

- [ ] **Step 3: Add `_replan` and `run_building_phase` to swarm_executor.py**

Add after `run_task`:

```python
# ---------------------------------------------------------------------------
# Building phase — parallel scheduler
# ---------------------------------------------------------------------------

def _replan(
    args: argparse.Namespace,
    state: dict,
    state_lock: threading.Lock,
    reason: str,
) -> None:
    """Re-dispatch Navigator with failure context and update state."""
    agent_dir = args.swarm_scripts.parent.parent.parent / "agents"
    completed_ids = [t["id"] for t in state["plan"]["tasks"] if t["status"] == "completed"]
    prev_plan = json.dumps(state["plan"], indent=2)
    issue_body = args.issue_body_file.read_text()

    raw = (agent_dir / "navigator.md").read_text()
    instructions = strip_frontmatter(raw)
    prompt = (
        f"{instructions}\n\n---\n\n"
        f"Issue #{args.issue}:\n\n{issue_body}\n\n"
        f"REVISION REQUIRED. Previous plan:\n{prev_plan}\n\n"
        f"Failure context: {reason}\n\n"
        f"Already completed (preserve, do not redo): {completed_ids}\n"
        f"Produce a revised plan (revision: {state['plan'].get('revision', 1) + 1})."
    )

    run_script(args.swarm_scripts, "append-handoff.sh",
               str(args.state), "Captain", "Navigator",
               f"re-plan: {reason[:60]}", "dispatched")

    _out, plan_yaml = dispatch_agent(
        "navigator", prompt, args.worktree, args.timeout, "PLAN"
    )

    tasks = plan_yaml.get("tasks") or []
    for t in tasks:
        t.setdefault("status", "pending")
        t.setdefault("depends_on", [])
        if t["id"] in completed_ids:
            t["status"] = "completed"
    plan_yaml["tasks"] = tasks

    plan_file = args.state.parent / f"plan-{args.issue}.json"
    plan_file.write_text(json.dumps(plan_yaml, indent=2))
    run_script(args.swarm_scripts, "set-plan.sh", str(args.state), str(plan_file))

    updated = load_state(args.state)
    state.update(updated)

    run_script(args.swarm_scripts, "append-handoff.sh",
               str(args.state), "Navigator", "Captain",
               f"revised plan, revision {plan_yaml.get('revision', '?')}", "ok")


def run_building_phase(
    args: argparse.Namespace,
    state: dict,
    state_lock: threading.Lock,
) -> None:
    git_lock = threading.Lock()

    while True:
        tasks = state["plan"]["tasks"]
        all_done = all(t["status"] in ("completed", "failed") for t in tasks)
        if all_done:
            break

        ready = compute_ready_set(tasks)

        if not ready:
            failed_ids = [t["id"] for t in tasks if t["status"] == "failed"]
            raise RuntimeError(
                f"No tasks ready but work remains. Failed deps may be blocking: {failed_ids}"
            )

        replan_reason: str | None = None

        with ThreadPoolExecutor(max_workers=len(ready)) as pool:
            futures: dict[Future, dict] = {
                pool.submit(run_task, task, args, state, state_lock, git_lock): task
                for task in ready
            }
            for future in as_completed(futures):
                task = futures[future]
                try:
                    result = future.result()
                except Exception as e:
                    raise RuntimeError(f"Task {task['id']} raised: {e}") from e

                if result == "handoff":
                    print(f"\nTask {task['id']} handed off to user. Halting.", file=sys.stderr)
                    sys.exit(1)

                if result.startswith("replan:") and replan_reason is None:
                    replan_reason = result[len("replan:"):]

        if replan_reason:
            _replan(args, state, state_lock, replan_reason)

        updated = load_state(args.state)
        state.update(updated)

    run_script(args.swarm_scripts, "update-state.sh", str(args.state),
               '.phase = "done" | .current_task = null')
    state["phase"] = "done"
```

- [ ] **Step 4: Update `main()` to wire up the full flow**

Replace the existing `main()` stub:

```python
# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    state_lock = threading.Lock()
    state = load_state(args.state)

    if state["phase"] == "planning":
        run_planning_phase(args, state, state_lock)
        state = load_state(args.state)

    if state["phase"] == "building":
        run_building_phase(args, state, state_lock)
        state = load_state(args.state)

    if state["phase"] == "done":
        print("[swarm-exec] Voyage complete.", file=sys.stderr)
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run all tests**

```bash
pytest tests/issue-flow/ -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/issue-flow/skills/swarm-exec/scripts/swarm_executor.py \
        tests/issue-flow/test_swarm_executor.py
git commit -m "feat(swarm-exec): parallel building phase with ThreadPoolExecutor

Independent tasks (empty depends_on or all deps completed) run
concurrently. State writes serialised via threading.Lock. Git commits
serialised via separate git_lock. Re-plan waits for in-flight tasks.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Write SKILL.md and register plugin

**Files:**
- Create: `plugins/issue-flow/skills/swarm-exec/SKILL.md`
- Modify: `plugins/issue-flow/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

No automated tests for skill prose.

- [ ] **Step 1: Create `plugins/issue-flow/skills/swarm-exec/SKILL.md`**

```markdown
---
name: swarm-exec
description: Harness-driven alternative to /swarm. A Python executor drives the Navigator→Crewmate→Quartermaster loop via claude -p subprocesses, keeping the main agent context flat. Same triggers as /swarm — use when token cost or reliability is a concern. Trigger on "swarm-exec issue #N", "/swarm-exec N", "harness swarm N".
allowed-tools: Bash(git:*) Bash(gh:*) Bash(bash *swarm/scripts/*) Bash(bash *swarm-exec/scripts/*) Bash(python3 *) Read
---

# Swarm-Exec

The Captain bootstraps the voyage, then Python drives the crew. The main agent's context stays flat — all orchestration happens in the executor subprocess.

## Environment

OWNER: !`gh repo view --json owner | jq -r .owner.login`
REPO: !`gh repo view --json name | jq -r .name`

`CLAUDE_SKILL_DIR` points at this skill's directory (`skills/swarm-exec/`).
Shared bash helpers live at `${CLAUDE_SKILL_DIR}/../swarm/scripts/`.

## Step 0: Find the issue number

Argument to the skill is the issue number. Strip any `#` or `gh-` prefix. If no argument:

1. Check the current branch — if it matches `claude/issue-<N>-`, use that N.
2. Else ask the user: "Which issue should the crew set sail on?"

Stop here if ye still don't have a number.

## Step 1: Read the issue

Prefer the GitHub MCP if available:

- Call `mcp__plugin_github_github__issue_read` with `method: "get"`, `owner`, `repo`, and `issue_number`.

CLI fallback:

```bash
gh issue view <N> --repo "$OWNER/$REPO" --json number,title,body,labels,projectItems
```

Capture `projectItems[0].id` and `projectItems[0].project.number` for Step 3. Save the issue body to a file:

```bash
BODY_FILE="${CLAUDE_PLUGIN_DATA}/swarm/${OWNER}/${REPO}/issue-${N}-body.txt"
mkdir -p "$(dirname "$BODY_FILE")"
gh issue view <N> --repo "$OWNER/$REPO" --json body --jq '.body' > "$BODY_FILE"
```

## Step 2: Create the worktree (off fresh origin default branch)

```bash
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD --short 2>/dev/null | sed 's|^origin/||')
```

If `$DEFAULT_BRANCH` is empty, HALT and surface the same error message as `/swarm` Step 2.

```bash
git fetch origin "$DEFAULT_BRANCH"
SLUG="<derived 3-5 word lowercase hyphenated slug from issue title>"
BRANCH="claude/issue-<N>-${SLUG}"
WORKTREE_PATH=".claude/worktrees/${BRANCH}"

if git show-ref --quiet "refs/heads/$BRANCH"; then
  git worktree add "$WORKTREE_PATH" "$BRANCH"
else
  git worktree add -b "$BRANCH" "$WORKTREE_PATH" "origin/$DEFAULT_BRANCH"
fi
```

Note: no `EnterWorktree` call — the Python executor runs agents with `cwd=worktree_path` directly.

## Step 3: Move the issue to "In Progress"

```bash
bash "${CLAUDE_SKILL_DIR}/../swarm/scripts/move-to-in-progress.sh" "$ITEM_ID" "$PROJECT_NUMBER" "$OWNER"
```

Same exit code semantics as `/swarm` Step 3.

## Step 4: Initialise state

```bash
STATE=$(bash "${CLAUDE_SKILL_DIR}/../swarm/scripts/init-state.sh" \
  <N> "$OWNER/$REPO" "<issue title>" "$BRANCH")
```

Exit code 2 means the state file already exists — resume flow. Read `$STATE` and tell the user: "Resumin' voyage on issue #N. Phase: <phase>."

## Step 5: Launch the executor

```bash
SWARM_SCRIPTS="${CLAUDE_SKILL_DIR}/../swarm/scripts"
python3 "${CLAUDE_SKILL_DIR}/scripts/swarm_executor.py" \
  --state "$STATE" \
  --worktree "$WORKTREE_PATH" \
  --owner "$OWNER" \
  --repo "$REPO" \
  --issue <N> \
  --swarm-scripts "$SWARM_SCRIPTS" \
  --issue-body-file "$BODY_FILE"
```

Block on this call. Do not interact with the executor unless it prompts you (open questions, escalation). When it exits 0, proceed to Step 6.

On non-zero exit: surface stderr verbatim and stop. Do not retry automatically.

## Step 6: Print the voyage log

```bash
bash "${CLAUDE_SKILL_DIR}/../swarm/scripts/print-voyage-log.sh" "$STATE"
```

Then grab the markdown version and paste it verbatim in your reply:

```bash
bash "${CLAUDE_SKILL_DIR}/../swarm/scripts/print-voyage-log.sh" --md "$STATE"
```

After the table, tell the user what to do next — typically `/open-pr` to ship.
```

- [ ] **Step 2: Bump version and register skill in plugin.json**

In `plugins/issue-flow/.claude-plugin/plugin.json`, update version to `"1.6.0"` and add `swarm-exec` to the skills list if present (if there is no skills list, just bump the version — the marketplace discovers skills by directory convention).

The file should look like:

```json
{
  "name": "issue-flow",
  "description": "Manage the full GitHub issue lifecycle — from picking up an issue through branch setup, implementation, and raising a PR. Includes an agentic /swarm flow that coordinates Navigator, Crewmate, and Quartermaster sub-agents, plus a harness-driven /swarm-exec alternative.",
  "version": "1.6.0",
  "author": {
    "name": "CoderCoco"
  },
  "license": "MIT",
  "repository": "https://github.com/CoderCoco/claude-plugin-marketplace"
}
```

- [ ] **Step 3: Bump version in marketplace.json**

In `.claude-plugin/marketplace.json`, update the `issue-flow` entry description to mention `swarm-exec` and note version 1.6.0 in the description field (the marketplace.json has no separate version field for plugins — just update the description string to keep it current with the plugin.json):

```json
"description": "Manage the full GitHub issue lifecycle — from picking up an issue through branch setup, implementation, and raising a PR. Includes /swarm (agent-driven) and /swarm-exec (harness-driven) agentic flows.",
```

- [ ] **Step 4: Smoke test the executor can be imported**

```bash
python3 -c "import sys; sys.path.insert(0, 'plugins/issue-flow/skills/swarm-exec/scripts'); import swarm_executor; print('OK')"
```

Expected output: `OK`

- [ ] **Step 5: Run full test suite one final time**

```bash
pytest tests/issue-flow/ -v
```

Expected: all tests PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add plugins/issue-flow/skills/swarm-exec/SKILL.md \
        plugins/issue-flow/.claude-plugin/plugin.json \
        .claude-plugin/marketplace.json
git commit -m "feat(issue-flow): add /swarm-exec skill (v1.6.0)

Harness-driven alternative to /swarm. Skill bootstraps worktree and
state, then delegates full orchestration to swarm_executor.py. Main
agent context stays flat across the entire loop.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
