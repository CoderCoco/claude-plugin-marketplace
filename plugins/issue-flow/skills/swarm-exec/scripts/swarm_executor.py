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
