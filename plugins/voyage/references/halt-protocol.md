# Halt-and-Ask Protocol

When a phase cannot continue autonomously, print this exact shape and exit.

```
⚓ HEAVY SEAS — <phase-name> halted

  Reason: <plain-English explanation — one or two sentences>

  Where we are:
    <one-line state summary, e.g. "Issue #42, set-sail phase, task Drake failed 3 times">

  Yer options:
    [1] <plain-English option>          (recommended)
    [2] <plain-English option>
    [3] Abandon voyage (state preserved — run /voyage <N> to resume)

  Tell me a number, or describe what ye want.
```

Rules:
- The REASON line is plain English. No pirate prose in the options.
- Always include an "Abandon voyage" option as the last numbered option.
- Pirate flavour is confined to the banner (`⚓ HEAVY SEAS`) and the closing
  prompt verb only.
- Number options so the user can reply with "1" without paraphrasing.
- Do NOT proceed after printing this. Exit the skill and wait for the next
  `/voyage <N>` invocation.
- When the user responds, resume by updating `phase_status` appropriately
  (e.g., `pending` to retry, `deleted` to skip a task) before re-running.
