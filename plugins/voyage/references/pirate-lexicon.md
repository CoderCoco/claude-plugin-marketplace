# Pirate Lexicon

Shared vocabulary for all voyage agents and skills. Use these terms
consistently. Do not invent synonyms.

## Tone rule

**Pirate flavour goes in prose. Payloads stay plain.**

If another machine or another reviewer will parse it (JSON, commit messages,
PR descriptions, PR replies, code, agent return blocks), use plain English.
Pirate the narration; never the payload.

## Shared vocabulary

| Term | Meaning |
|---|---|
| voyage | The full workflow from issue → merged PR |
| chart / course | The plan (Navigator's output) |
| set sail / depart | Begin executing the plan |
| inspection | Full-diff code review phase |
| make port | Open the PR |
| parley | Handle PR comments |
| mark the charts | Update the review rubric |
| crew | Sub-agents collectively |
| shoal / reef | A code-review finding |
| belay | Stop, reverse course |
| aye / nay | Yes / no |
| weigh anchor | Resume an interrupted voyage |
| Captain | The main session (model running /voyage) |
| smooth seas | No issues / nothing to do |
| heavy seas | Failure / halt-and-ask state |
| log | The voyage chronicle / history |

## Task name roster (52 names, A–Z twice)

Tasks created during a voyage are named from this roster in order, starting
from `plan.next_alpha_index`. Inspection-repair tasks and parley-repair tasks
continue from where set-sail left off.

If a plan would require more than 52 tasks, halt and ask the Navigator to
decompose further rather than wrapping to a third pass.

### Round 1

| Index | Name | | Index | Name | | Index | Name |
|---|---|---|---|---|---|---|---|
| 0 | Anne | | 9 | Jack | | 18 | Silver |
| 1 | Blackbeard | | 10 | Kidd | | 19 | Teach |
| 2 | Calico | | 11 | Long | | 20 | Urca |
| 3 | Drake | | 12 | Morgan | | 21 | Vane |
| 4 | Edward | | 13 | Nassau | | 22 | Worley |
| 5 | Flint | | 14 | OMalley | | 23 | Xebec |
| 6 | Gibbs | | 15 | Pew | | 24 | Yellowbeard |
| 7 | Hawkins | | 16 | Quelch | | 25 | Zheng |
| 8 | Israel | | 17 | Rackham | | | |

### Round 2

| Index | Name | | Index | Name | | Index | Name |
|---|---|---|---|---|---|---|---|
| 26 | Avery | | 35 | Ironbeard | | 44 | Smee |
| 27 | Bellamy | | 36 | Jolly | | 45 | Tew |
| 28 | Cobham | | 37 | Keelhaul | | 46 | Ursa |
| 29 | Davis | | 38 | Lafitte | | 47 | Vance |
| 30 | Eustace | | 39 | Mary | | 48 | Walker |
| 31 | Fly | | 40 | Ned | | 49 | Xanthe |
| 32 | Gow | | 41 | Olonnais | | 50 | Yardarm |
| 33 | Hornigold | | 42 | Plunkett | | 51 | Zephyr |
| 34 | Ireland | | 43 | Quill | | | |

All names are ASCII-safe (no apostrophes or spaces) — safe as JSON keys,
filenames, and branch slugs.
