# Droid-New parallel stream A — primary implementation

- Stream: `stream-a`
- Branch: `agent/stream-a-primary`
- Shared starting point: `95d22ba9d06439f6d502e1e6cdf6d03a9b96b28d`
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
# Droid-New parallel stream B — independent alternative and test

- Stream: `stream-b`
- Branch: `agent/stream-b-alternative`
- Shared starting point: `ec247916c0e0bb169930244cc8ce0e95a6fd1eb7`
- Role: independent tester and alternative-method builder

## Assignment

Start from the shared base commit, not from stream A's working tree. Independently inspect the task and existing tests. First build a test plan and identify likely failure cases while stream A implements. When stream A publishes a candidate diff, test it independently on this branch or in an isolated worktree. Do not blindly copy its implementation.

## Required attempt policy

1. Establish baseline behavior and write/run independent tests.
2. When a candidate arrives, inspect the diff and challenge assumptions, boundary cases, concurrency, cancellation, persistence, and failure handling.
3. If tests fail, preserve exact logs, reproduction steps, and the failing diff as artifacts.
4. Retry the same test or repair method once if the failure is plausibly transient or narrowly fixable.
5. If still failing, try a materially different method: alternate design, independent reproduction, different test strategy, or a smaller isolated implementation.
6. If the primary implementation is structurally wrong, implement a separate alternative on this branch rather than patching A's branch.
7. Cross-reference every useful finding back to stream A and any reviewer tabs. Include evidence and exact artifact IDs/paths.
8. Preserve any passing test harness or working alternative even if a later experiment fails.

## Handoff contract

Report the base commit, branch head, test commands, test outcomes, failures reproduced, alternate method attempted, changed files, and the exact primary-branch commit/diff tested. Do not merge automatically. A reviewer compares both streams and may cherry-pick or combine only the verified changes.

## Safety

Testing must not interfere with a live user's desktop session. Any physical input remains serialized by Droid-New's single input-authority lease.
