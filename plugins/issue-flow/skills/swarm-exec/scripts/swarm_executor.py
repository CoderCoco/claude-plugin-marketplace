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
