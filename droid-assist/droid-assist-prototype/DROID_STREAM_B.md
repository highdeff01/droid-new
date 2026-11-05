# Droid-New parallel stream B — independent alternative and test

- Stream: `stream-b`
- Branch: `agent/stream-b-alternative`
- Shared starting point: `67872b196d468aaa8d52533ca50f6ab67cd6f4fc`
- Role: independent tester and alternative-method builder

## Assignment

Start from the shared base commit, not from Stream A's working tree. Independently inspect the task and existing tests. First build a test plan and identify likely failure cases while Stream A implements. When Stream A publishes a candidate diff, test it independently on this branch or in an isolated worktree. Do not blindly copy its implementation.

## Required attempt policy

1. Establish baseline behavior and write/run independent tests.
2. When a candidate arrives, inspect the diff and challenge assumptions, boundary cases, concurrency, cancellation, persistence, and failure handling.
3. If tests fail, preserve exact logs, reproduction steps, and the failing diff as artifacts.
4. Retry the same test or repair method once if the failure is plausibly transient or narrowly fixable.
5. If still failing, try a materially different method: alternate design, independent reproduction, different test strategy, or a smaller isolated implementation.
6. If the primary implementation is structurally wrong, implement a separate alternative on this branch rather than patching A's branch.
7. Cross-reference every useful finding back to Stream A and any reviewer tabs. Include evidence and exact artifact IDs/paths.
8. Preserve any passing test harness or working alternative even if a later experiment fails.

## Handoff contract

Report the base commit, branch head, test commands, test outcomes, failures reproduced, alternate method attempted, changed files, and the exact primary-branch commit/diff tested. Do not merge automatically. A reviewer compares both streams and may cherry-pick or combine only the verified changes.

## Safety

Testing must not interfere with a live user's desktop session. Any physical input remains serialized by Droid-New's single input-authority lease.
