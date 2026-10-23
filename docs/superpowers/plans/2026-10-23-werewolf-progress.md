# SDD ledger — plan: docs/superpowers/plans/2026-10-23-werewolf-mvp.md

- Execution: native in current session; user approved product draft and explicitly requested implementation.
- Ruling: repository has no HEAD and existing staged design files; stay on existing non-main branch 1023, do not create worktree or commits — preserves the user's index and avoids inventing a baseline — cost if wrong: work is not isolated from concurrent edits.
- Ruling: no actual AppID/voice account exists in repository; real voice provider fails closed, dev readiness explicitly labelled simulation — preserves privacy and prevents false production claims — cost: real remote voice acceptance remains blocked on provider integration.
- Pre-flight Task 1→2: createGame/act/tick/snapshot/setConnected agree; room service owns identity and timestamps, never accepts role injection from clients.
- Pre-flight Task 2→3: RoomService owns user membership; network authenticates user before command and handles connection generation.
- Pre-flight Task 3→4/5: clients consume only personalized snapshots, request acknowledgments and stable errors; neither can push time or roles.
- Pre-flight Task 4→5: shared presentation CommonJS built into browser global and copied into miniprogram; same action candidate mapping.
- Task 1: in progress.
