# Droid-New parallel stream A — primary implementation

- Stream: `stream-a`
- Branch: `agent/stream-a-primary`
- Shared starting point: `ec247916c0e0bb169930244cc8ce0e95a6fd1eb7`
- Role: primary implementer

## Assignment

Continue the existing implementation on this branch. Do not write to `main` or the other stream's branch. Keep changes isolated so the independent stream can produce a genuinely different result.

## Required attempt policy

1. Try the clearest implementation based on the existing architecture.
2. Run focused type checks and tests.
3. If blocked or failing, preserve the complete error, logs, diff, and assumptions as an artifact.
4. Retry the same method once only when the failure may be transient or a narrowly fixable defect.
5. If it still fails, use a materially different implementation strategy. Do not merely rename the same approach.
6. Run the relevant tests again and report exact commands and outcomes.
7. Send the alternative stream a compact cross-reference packet: files changed, design decisions, failing tests, useful discoveries, and verified results.
8. Never replace a previously passing artifact with an untested candidate.

## Handoff contract

Report the base commit, branch head, changed-file list, test commands, test outcomes, remaining risks, and IDs/paths of saved artifacts. Do not merge automatically. A reviewer compares both streams before selecting or combining changes.

## Safety

This stream may plan, code, inspect, and test in parallel. It must not create a second physical mouse/keyboard controller. Any live PC input stays behind Droid-New's single input-authority lease.
