# Architecture

## Overview

The merge queue GitHub Action is built as a TypeScript application that runs in GitHub Actions. It uses the `gh` CLI for all GitHub API interactions and maintains state in a dedicated git branch.

## Components

### Core Modules

#### `src/index.ts`
Main entry point and orchestration logic:
- Configuration parsing and validation
- Workflow orchestration (`executeQueueWorkflow`)
- PR processing lifecycle (`processCandidate`)
- Operation factories (branch, queue, PR, dashboard)
- Handler functions for different outcomes

**Key Functions:**
- `run()` - Entry point, error handling
- `readConfig()` - Configuration parsing with validation
- `executeQueueWorkflow()` - Main workflow orchestration
- `processCandidate()` - PR processing lifecycle
- `handleConflict()`, `handleBaseMoved()`, `handleSuccess()` - Outcome handlers
- `mergePR()` - Live mode merge operation

#### `src/github-cli.ts`
GitHub API abstraction layer:
- Wraps `gh` CLI commands with type-safe TypeScript interfaces
- Provides operations for labels, issues, PRs, refs, content
- Error handling and response parsing

**Key Functions:**
- Label operations: `listLabels`, `createLabel`
- Issue operations: `createIssue`, `updateIssue`, `lockIssue`, `pinIssue`, `commentOnIssue`
- PR operations: `getPullRequest`, `updatePullRequestBranch`, `mergePullRequest`, `fetchOpenPRs`
- Git ref operations: `getRef`, `createRef`, `updateRef`, `deleteRef`
- Repository operations: `compareCommits`, `createCommitStatus`, `mergeBranches`
- Content operations: `getFileContents`, `putFileContents`

### State Management

**Queue State File** (`.github/merge-queue-queue.json`):
```json
{
  "version": 1,
  "queue": [123, 456, 789]
}
```
- Stored on dedicated state branch
- Persists between workflow runs
- Uses file SHA for optimistic locking

### Branches

1. **Base Branch** (`main`/`master`): Protected branch where PRs merge
2. **Queue Branch** (`merge-queue/staging`): Temporary staging for regular PRs
3. **Fastlane Branch** (`merge-queue/fastlane`): Temporary staging for priority PRs
4. **State Branch** (`merge-queue/state`): Persistent storage for queue file

### Labels

Auto-created labels for tracking (all with `mq/` prefix):
- `mq/dashboard`: Identifies dashboard issue
- `mq/queued`: PR is in queue
- `mq/staging`: PR being staged
- `mq/testing`: PR being tested
- `mq/conflict`: PR has conflicts
- `mq/fastlane`: PR on fastlane track
- `mq/hold`: Hold PR from queue
- `mq/ready`: PR ready for queue
- `mq/failed`: PR failed tests

## Data Flow

```
GitHub Event → Workflow Trigger
      ↓
Configuration Loading & Validation
      ↓
Label Initialization
      ↓
Queue State Read (state branch)
      ↓
PR Discovery & Filtering
      ↓
Queue Update & Candidate Selection
      ↓
Branch Update (if needed)
      ↓
Staging (create merge on temp branch)
      ↓
Status Update (pending/success/failure)
      ↓
Merge Decision (shadow vs live)
      ↓
Queue State Write
      ↓
Dashboard Update
```

## Operation Factories

The codebase uses a factory pattern to create operation objects with closure-scoped dependencies.

### `createBranchOperations(owner, repo)`
Returns operations for branch management:
- `getBranchSha(branch)`: Fetch current SHA for a branch
- `ensureBranch(branch, sha)`: Create or update branch to specific SHA
- `deleteBranch(branch)`: Remove a branch reference

### `createQueueOperations(owner, repo, stateBranch, queueFile, baseBranch, branchOps)`
Returns operations for queue state management:
- `readQueue()`: Read and parse queue file from state branch
- `writeQueue(queue, sha)`: Write updated queue to state branch

Internal helpers:
- `ensureStateBranch()`: Create state branch if doesn't exist
- `fetchQueueFile()`: Fetch queue JSON from state branch
- `initializeQueueFile()`: Initialize new queue file

### `createPROperations(owner, repo, baseBranch, statusContext, behindMaxCommits)`
Returns operations for pull request management:
- `fetchOpenPRs()`: Get all open PRs for base branch
- `maybeUpdateBranch(prNumber, currentSha)`: Auto-update stale PR branches
- `setStatus(sha, state, description)`: Set commit status on SHA
- `stageOnBranch(trainBranch, headSha, baseSha, branchOps)`: Merge PR onto staging branch
- `fetchPrDetails(numbers)`: Get detailed info for dashboard

### `createDashboardOperations(owner, repo, dashboardTitle, dashboardLabel, dashboardPin, dashboardScanOpenIssues)`
Returns operations for dashboard management:
- `upsertDashboard(body)`: Create or update dashboard issue

Internal helpers:
- `findExistingIssue()`: Search for existing dashboard issue
- `createNewIssue(body, labels)`: Create new dashboard issue
- `updateExistingIssue(issueNumber, body)`: Update existing dashboard
- `pinIssue(issueNumber)`: Pin dashboard issue
- `lockIssue(issueNumber)`: Lock dashboard issue

## Configuration

Configuration is read from GitHub Actions inputs and validated:

```typescript
interface Config {
  token: string;
  baseBranch: string;
  queueBranch: string;
  fastlaneBranch: string;
  stateBranch: string;
  queueFile: string;
  statusContext: string;
  mode: 'shadow' | 'live';
  fastlaneMatchersInput: string;
  behindMaxCommits: number;
  mergeMethod: 'merge' | 'squash' | 'rebase';
  cleanQueue: boolean;
  enableQueueTracking: boolean;
  dashboardTitle: string;
  dashboardLabel: string;
  dashboardPin: boolean;
  dashboardScanOpenIssues: number;
  projectMode: string;
  projectOwnerInput: string;
  projectNumber: number | null;
  projectTitle: string;
  projectStatusFieldName: string;
  projectQueuePosFieldName: string;
}
```

Validation includes:
- Token format and placeholder detection
- Branch name Git compatibility
- Enum value validation (mode, mergeMethod)
- Numeric range validation
- Regex pattern compilation
- Branch name conflict detection

## Error Handling

### Validation Errors
- Thrown early in `readConfig()`
- Clear, actionable error messages
- Examples provided for correct formats

### Runtime Errors
- Caught in main `run()` function
- Logged with full stack trace
- Action marked as failed via `core.setFailed()`

### API Errors
- Handled at `gh` CLI layer
- 404 errors ignored for branch deletions
- 409 conflicts detected for merge operations
- Detailed error messages preserved

## Dependencies

### Production Dependencies
- `@actions/core`: GitHub Actions toolkit for logging and inputs
- `@actions/exec`: Execute shell commands (gh CLI)
- `@actions/github`: GitHub context and event information

### Build Dependencies
- `@vercel/ncc`: Compile TypeScript to single file
- `typescript`: TypeScript compiler
- `vitest`: Testing framework (for future tests)

## Build Process

1. TypeScript compilation with strict type checking
2. Bundle with `@vercel/ncc` into single `dist/index.js`
3. Minification and tree-shaking
4. License extraction to `dist/licenses.txt`

Output: `dist/index.js` (~611KB, self-contained)

## Execution Environment

- Runs in GitHub Actions
- Requires `ubuntu-latest` runner
- Uses system-installed `gh` CLI
- Requires `GITHUB_TOKEN` with appropriate permissions:
  - `contents: write` - Branch operations
  - `pull-requests: write` - PR updates
  - `statuses: write` - Commit status updates
  - `issues: write` - Dashboard issue management

## Concurrency Control

```yaml
concurrency:
  group: merge-queue
  cancel-in-progress: true
```

Ensures only one workflow instance runs at a time:
- Prevents race conditions
- Cancels stale runs when new event triggers
- Works with optimistic locking for additional safety

## Performance Considerations

- **Batch Operations**: Fetch all PRs in single call
- **Lazy Processing**: Only process one candidate per run
- **Selective Updates**: Only write queue if changed
- **Clean Branches**: Optional cleanup of staging branches
- **Scan Limits**: Configurable dashboard issue scan limit

## Security

- **No Secret Logging**: Tokens never logged
- **Input Validation**: All inputs validated before use
- **Safe Branch Names**: Git naming rules enforced
- **SHA Verification**: Optimistic locking with SHAs
- **Least Privilege**: Only required permissions requested
