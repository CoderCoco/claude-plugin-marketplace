# Halt-and-Ask Protocol

When a phase cannot continue autonomously, print this exact shape and exit.

```
🚨 ABORT SEQUENCE — <phase-name> halted

  Reason: <plain-English explanation — one or two sentences>

  Where we are:
    <one-line state summary, e.g. "Issue #42, liftoff phase, task Drake failed 3 times">

  Your options:
    [1] <plain-English option>          (recommended)
    [2] <plain-English option>
    [3] Abort mission (state preserved — run /mission <N> to resume)

  Enter a number, or describe what you want.
```

Rules:
- The REASON line is plain English. No space jargon in the options.
- Always include an "Abort mission" option as the last numbered option.
- Space flavour is confined to the banner (`🚨 ABORT SEQUENCE`) only.
- Number options so the user can reply with "1" without paraphrasing.
- Do NOT proceed after printing this. Exit the skill and wait for the next
  `/mission <N>` invocation.
- When the user responds, resume by re-running the appropriate phase skill or
  `/mission <N>` — the workflow resumes from the saved runId in
  `$CLAUDE_PLUGIN_DATA/mission-runs/issue-<N>/`. If the plan itself is wrong,
  fix it with `/pre-launch <N> --replan`.
