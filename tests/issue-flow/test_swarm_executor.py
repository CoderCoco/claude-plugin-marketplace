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
