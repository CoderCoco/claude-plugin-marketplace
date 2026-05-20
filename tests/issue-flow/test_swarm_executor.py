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
