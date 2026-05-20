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
