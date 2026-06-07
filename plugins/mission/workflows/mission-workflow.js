// This file has been superseded by three focused workflows:
//   liftoff-workflow.js       — Liftoff phase (Astronauts + Flight Controllers)
//   systems-check-workflow.js — Systems Check (returns status for skill to handle interactively)
//   docking-workflow.js       — Docking (push branch + open PR)
//
// The /mission skill now orchestrates these directly, owning all user
// interaction (Flight Director open_questions, SC exhaustion prompts) in the
// main conversation context rather than inside a headless workflow.
