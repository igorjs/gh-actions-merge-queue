# Merge Queue GitHub Action

This repository provides a GitHub composite action that implements a **merge queue** with an optional hot‑fix fastlane. The queue is FIFO (first‑in, first‑out) and works on GitHub Free and private repositories. Merges are staged on a temporary branch before reaching your protected branch, ensuring that only tested code lands on `master`/`main`.

## Features

* **FIFO merge queue** – Pull requests are merged in the order they were approved.
* **Hot‑fix fastlane** – Pull requests whose branch name or title matches a configurable regex (for example `hotfix/`) bypass the queue.
* **Auto‑update of stale branches** – Optionally update PR branches that have fallen behind your base by a specified number of commits.
* **Shadow vs. live mode** – Shadow mode tests your configuration without merging; live mode performs actual merges.
* **No additional services required** – Uses the built‑in `GITHUB_TOKEN` only; no enterprise features or external CI are required.

## How It Works

The merge queue action maintains a FIFO queue of approved pull requests and processes them sequentially:

1. **Queue Discovery**: Scans all open PRs and adds approved, non-draft PRs to the queue
2. **Candidate Selection**: Picks the next PR from the queue (or a fastlane PR if available)
3. **Staging**: Creates a temporary branch merging the PR with the current base branch
4. **Testing**: CI runs tests on the staged merge (via required status checks)
5. **Merging**: If tests pass and base hasn't moved, merges the PR (in live mode)
6. **Cleanup**: Removes PR from queue and deletes staging branch

**Key Benefit**: Every PR is tested against the latest base branch before merging, preventing integration issues without requiring "update branch before merge" in GitHub settings.

See [docs/ALGORITHM.md](docs/ALGORITHM.md) for detailed algorithm documentation.

## Installation

Add the action to your workflow by referencing the tag in your repository. Make sure your repository's **Settings → Branch protection** requires the custom status set in `status_context` (default `merge‑queue`) and disables **"Require branches to be up to date with base"**.

### Required Permissions

The action requires the following GitHub token permissions:

* **contents: write** – Create and update queue staging branches
* **pull-requests: write** – Update PR statuses and branches
* **statuses: write** – Set commit statuses for queue validation
* **issues: write** – Create/update dashboard issue, create labels, pin and lock dashboard

### Auto-Created Resources

On first run, the action automatically creates:

* **Labels** – `mq/dashboard`, `mq/queued`, `mq/staging`, `mq/testing`, `mq/conflict`, `mq/fastlane`, `mq/hold`, `mq/ready`, and `mq/failed`
* **Dashboard Issue** – A pinned and locked issue displaying the current queue state (when `enable_queue_tracking` is enabled)
* **State Branch** – A branch to persist queue state between workflow runs

### Example: shadow mode

```yaml
name: Merge Queue (shadow)
on:
  pull_request:
    types: [opened, reopened, ready_for_review, synchronize, converted_to_draft, review_requested]
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch: {}

permissions:
  contents: write
  pull-requests: write
  statuses: write
  issues: write

concurrency:
  group: merge-queue
  cancel-in-progress: true

jobs:
  queue:
    runs-on: ubuntu-latest
    steps:
      - uses: igorjs/gh-actions-merge-queue@v1
        with:
          base_branch: main
          mode: shadow
          merge_method: merge
          status_context: merge-queue
          behind_max_commits: "100"
          fastlane_matchers: "^(hotfix|critical|security)/,\\bhotfix\\b,^hotfix:"
```

### Example: live mode

To enable real merges, flip `mode` to `live` and adjust your branch protection accordingly.

```yaml
      - uses: igorjs/gh-actions-merge-queue@v1
        with:
          base_branch: main
          mode: live
          merge_method: merge
          status_context: merge-queue
          behind_max_commits: "100"
```

## Inputs

This action exposes a number of inputs to customise behaviour:

* **token** – Optional, defaults to `GITHUB_TOKEN`.
* **base_branch** – Base branch to merge into (default `master`).
* **queue_branch** – Temporary branch used to stage the merge (default `merge‑queue/staging`).
* **fastlane_branch** – Temporary branch for fastlane merges (default `merge‑queue/fastlane`).
* **state_branch** – Branch that stores the FIFO queue file (default `merge‑queue/state`).
* **queue_file** – Path to the queue JSON file inside the state branch (default `.github/merge‑queue‑queue.json`).
* **status_context** – Commit status context; must be required in branch protection (default `merge‑queue`).
* **mode** – `shadow` or `live` (default `shadow`).
* **fastlane_matchers** – Comma‑separated regex patterns used to detect fastlane PRs.
* **behind_max_commits** – Update PR branches if behind more than this number of commits (0 disables).
* **merge_method** – `merge` (preserves the tested tree) or `squash`.
* **clean_queue** – Whether to delete the temporary queue branches (default `true`).

## Branch Protection

Configure branch protection rules to work with the merge queue:

1. **Protect your base branch** (`master` or `main`) – Standard GitHub branch protection
2. **Require pull request reviews** – Use your normal review requirements (e.g., 1-2 approvals, CODEOWNERS)
3. **Add the status context as the only required status check** – Set `merge‑queue` (or your custom `status_context`) as required. This ensures PRs can only merge after passing queue staging.
4. **Turn OFF "Require branches to be up to date before merging"** – The queue handles this automatically by testing PRs against the latest base during staging. Enabling this setting would force unnecessary branch updates.
5. **Allow merge commits** (recommended) – Or configure your merge method to match your `merge_method` setting (squash/rebase)

**Why this configuration?** The merge queue replaces GitHub's "require branches to be up to date" feature with a more efficient approach. Instead of forcing every PR to update its branch before merge (which can cause a cascade of updates), the queue tests each PR's merge result on a staging branch. This provides the same safety guarantee (no untested code reaches main) with fewer branch updates and faster throughput.

## Common Use Cases

### 1. Hotfix Fast Lane
Use the fastlane to bypass the queue for urgent fixes:

```yaml
fastlane_matchers: "^hotfix/,^security/,\\bURGENT\\b"
```

PRs with branches like `hotfix/critical-bug` or titles containing "URGENT" will be processed immediately, jumping ahead of the regular queue.

### 2. Auto-Update Stale Branches
Automatically update PR branches that have fallen behind:

```yaml
behind_max_commits: "50"
```

When a PR is more than 50 commits behind the base branch, the action will trigger GitHub's "update branch" operation before staging. Set to `0` to disable.

### 3. Squash Merge Strategy
Use squash commits for a linear history:

```yaml
merge_method: squash
mode: live
```

All commits in the PR will be squashed into a single commit when merged. Note that squash changes the commit SHA, but the queue has already tested the merge result.

### 4. Multiple Base Branches
Run separate queues for different branches (e.g., `main` and `develop`):

```yaml
# .github/workflows/merge-queue-main.yml
- uses: igorjs/gh-actions-merge-queue@v1
  with:
    base_branch: main
    queue_branch: merge-queue/main-staging
    state_branch: merge-queue/main-state

# .github/workflows/merge-queue-develop.yml
- uses: igorjs/gh-actions-merge-queue@v1
  with:
    base_branch: develop
    queue_branch: merge-queue/develop-staging
    state_branch: merge-queue/develop-state
```

Each workflow manages its own queue independently with separate concurrency groups.

### 5. Shadow Mode Testing
Test your merge queue configuration without actually merging PRs:

```yaml
mode: shadow
```

The action will stage PRs and set commit statuses, but won't perform actual merges. Use this to validate your setup before going live.

### 6. High-Frequency Queue Processing
Process the queue more frequently for faster turnaround:

```yaml
on:
  schedule:
    - cron: "*/3 * * * *"  # Every 3 minutes
```

More frequent runs mean shorter wait times, but higher CI resource usage. Balance based on your team's needs.

### 7. Monorepo with Path Filters
Only trigger the queue for changes to specific paths:

```yaml
on:
  pull_request:
    types: [opened, reopened, ready_for_review, synchronize]
    paths:
      - 'services/api/**'
      - 'shared/**'
```

Combine with GitHub's path filtering to run separate queues for different parts of a monorepo.

## Troubleshooting

### Queue Not Processing PRs

**Symptom**: Approved PRs remain in "pending" status

**Common causes**:
- Workflow not triggering frequently enough (check `schedule` cron)
- Concurrency group blocking new runs (check Actions tab)
- PR doesn't meet eligibility criteria (not approved, is draft, or has conflicts)
- Branch protection not configured correctly (missing required status check)

**Solution**: Check workflow runs in the Actions tab for errors, verify the PR is approved and not a draft, and ensure branch protection requires the `merge-queue` status check.

### Merge Conflicts

**Symptom**: PR shows "merge-queue: failure" with conflict comment

**Cause**: PR branch conflicts with current base branch

**Solution**: Rebase or merge the base branch into your PR branch:
```bash
git fetch origin
git rebase origin/main  # or: git merge origin/main
git push --force-with-lease
```

### Base Moved During Test

**Symptom**: PR status shows "pending" with "Base moved during test; will retry"

**Cause**: Another PR merged while this PR was being staged/tested

**Solution**: Wait for the next workflow run (usually 3-5 minutes). The PR will be automatically re-tested against the new base. This ensures all PRs are tested against the very latest code.

### Stale Branches Not Auto-Updating

**Symptom**: PRs far behind base aren't being updated automatically

**Common causes**:
- `behind_max_commits` is set to `0` (disabled)
- PR is from a fork (requires maintainer to update)
- Insufficient permissions

**Solution**: Set `behind_max_commits: "100"` (or desired threshold) in your workflow. For fork PRs, maintainers must update manually or ask contributors to rebase.

### Dashboard Issue Not Created

**Symptom**: No dashboard issue appears

**Common causes**:
- Missing `issues: write` permission in workflow
- `enable_queue_tracking` is `false`

**Solution**: Add `issues: write` to workflow permissions and ensure `enable_queue_tracking: true` (default).

### Queue Stuck on Failing PR

**Symptom**: Queue won't progress because the first PR keeps failing CI

**Cause**: The action doesn't automatically skip failing PRs

**Solution**:
1. PR author should fix the failing tests and push updates
2. Or close/un-approve the PR to remove it from the queue
3. Or manually edit the queue file on the state branch to remove the PR number

For more detailed troubleshooting, see [docs/FAQ.md](docs/FAQ.md).

## License

MIT License - see [LICENSE](LICENSE) file.

## Security

To report a security vulnerability, see [SECURITY.md](SECURITY.md).
