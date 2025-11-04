# Merge Queue Algorithm

## Overview

The merge queue implements a FIFO (First-In-First-Out) queue system with an optional fastlane for high-priority PRs. It ensures that all PRs are tested against the latest base branch before merging, preventing broken code from landing on protected branches.

## Core Concepts

### Queue State
- Persisted in a JSON file on a dedicated state branch (`merge-queue/state`)
- Contains array of PR numbers in FIFO order
- Uses file SHA for optimistic locking to prevent race conditions

### Staging Branches
- **Queue Branch** (`merge-queue/staging`): Tests regular PRs
- **Fastlane Branch** (`merge-queue/fastlane`): Tests high-priority PRs
- Temporary branches are created by merging base + PR head
- Allows CI to run tests on the merged result

### PR Eligibility Criteria
A PR is eligible for the queue if it meets ALL of:
1. Not a draft PR
2. Review decision is "APPROVED"
3. Mergeable state is not "CONFLICTING"
4. Open and targeting the base branch

## Algorithm Flow

### 1. Queue Discovery Phase
```
1. Read current queue state from state branch
2. Fetch all open PRs targeting base branch
3. Filter PRs by eligibility criteria
4. Identify fastlane candidates (match configured patterns)
5. Separate normal and fastlane PRs
```

### 2. Queue Update Phase
```
1. Remove PRs from queue that are no longer eligible
2. Add newly eligible PRs to end of queue (maintain FIFO)
3. If queue changed, persist to state branch
```

### 3. Candidate Selection Phase
```
Priority order:
1. If fastlane PR exists → select it (bypasses queue)
2. Else if queue not empty → select head of queue
3. Else → no candidate, exit
```

### 4. PR Processing Phase
```
For selected candidate:

1. Branch Update (optional):
   - Check if PR is behind base by > behind_max_commits
   - If yes, trigger GitHub's "update branch" operation
   - Wait for update to complete, get new SHA

2. Staging:
   - Set commit status to "pending" (queued)
   - Create/update staging branch = base branch SHA
   - Attempt merge of PR head onto staging branch

3. Conflict Handling:
   - If merge conflicts → comment on PR, set status "failure", exit
   - If base moved during test → set status "pending", defer to next run
   - If success → proceed to merge or success status

4. Merge Decision:
   - Shadow mode: Set status "success", don't merge
   - Live mode: Merge PR, set status "success"

5. Cleanup:
   - If clean_queue=true: Delete staging branch
   - If merged and not fastlane: Remove from queue
```

### 5. Dashboard Update Phase
```
1. Fetch details for all PRs in queue
2. Render markdown table with queue positions
3. Update/create dashboard issue
4. Write to job summary
```

## Key Properties

### FIFO Guarantee
- Normal PRs are processed strictly in order of approval
- Fastlane PRs can jump the queue but don't disrupt order

### Race Condition Prevention
- Queue file uses SHA-based optimistic locking
- Only one workflow instance runs at a time (concurrency group)
- Base branch movement detected and handled

### Test Accuracy
- Every PR is tested on a merge with current base
- If base moves during test, PR is re-queued
- No "require branches to be up to date" needed

## Edge Cases

### Concurrent Workflows
- Concurrency group ensures only one instance runs
- If triggered during run, previous run is cancelled

### Queue File Conflicts
- Uses file SHA for optimistic locking
- If state branch updated elsewhere, next run detects and reconciles

### Stale PRs
- PRs behind by > behind_max_commits are auto-updated
- If update fails, PR continues with current state

### Failed CI on Staging Branch
- Action sets commit status based on staging success
- External CI tests run on staging branch
- Branch protection requires status check to pass

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Triggered                        │
│           (schedule, PR event, manual dispatch)              │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Read Queue State & Fetch Open PRs               │
│  • Load queue.json from state branch                         │
│  • Fetch all open PRs for base branch                        │
│  • Filter by eligibility (approved, not draft, no conflicts) │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  Update Queue (FIFO)                         │
│  • Remove PRs no longer eligible                             │
│  • Add newly eligible PRs to end of queue                    │
│  • Persist queue if changed                                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│               Select Next Candidate                          │
│  Priority:                                                   │
│  1. Fastlane PR (if exists)                                  │
│  2. Head of queue (if not empty)                             │
│  3. None → Exit                                              │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
         ┌────────────┴────────────┐
         │   Has Candidate?        │
         └────┬───────────────┬────┘
              │ No            │ Yes
              ▼               ▼
         ┌────────┐    ┌──────────────────────┐
         │  Exit  │    │ Update Branch (opt)  │
         └────────┘    │ if > behind_max      │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │  Set Status Pending  │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │    Stage on Branch   │
                       │  (merge base + PR)   │
                       └──────────┬───────────┘
                                  │
                  ┌───────────────┼───────────────┐
                  │               │               │
                  ▼               ▼               ▼
           ┌──────────┐    ┌──────────┐   ┌──────────┐
           │ Conflict │    │Base Moved│   │ Success  │
           └────┬─────┘    └────┬─────┘   └────┬─────┘
                │               │              │
                ▼               ▼              ▼
         ┌──────────┐    ┌──────────┐   ┌──────────┐
         │ Comment  │    │Set Pending│   │  Merge?  │
         │Set Failed│    │Will Retry │   │(or mark) │
         └──────────┘    └──────────┘   └────┬─────┘
                                              │
                                              ▼
                                      ┌──────────────┐
                                      │Set Success   │
                                      │Remove from Q │
                                      └──────────────┘
```

## Implementation Details

### Queue File Format
```json
{
  "version": 1,
  "queue": [123, 456, 789]
}
```

### Commit Status Context
- Default: `merge-queue`
- Must be required in branch protection
- States: `pending`, `success`, `failure`, `error`

### Branch Naming
- Base: User-configured (e.g., `main`, `master`)
- Queue: `merge-queue/staging` (configurable)
- Fastlane: `merge-queue/fastlane` (configurable)
- State: `merge-queue/state` (configurable)

### Optimistic Locking
When writing queue updates:
1. Read queue file and get SHA
2. Process queue operations
3. Write queue file with original SHA
4. If SHA changed (concurrent update), GitHub rejects write
5. Next workflow run will reconcile

This prevents race conditions when multiple workflow instances run.
