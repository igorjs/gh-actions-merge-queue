# Frequently Asked Questions

## General

### Q: What's the difference between shadow and live mode?

**Shadow mode**: Tests the queue workflow without actually merging PRs. Sets commit status to "success" when staging succeeds, but doesn't perform the merge. Use this to validate your configuration before going live.

**Live mode**: Performs actual merges when PRs pass staging tests. This is the production mode.

### Q: Do I need GitHub Enterprise for this action?

No! This action works on GitHub Free, Team, and Enterprise. It uses only standard GitHub features and doesn't require merge queue features from GitHub Enterprise.

### Q: How is this different from GitHub's native merge queue?

GitHub's native merge queue requires GitHub Enterprise. This action:
- Works on all GitHub plans (Free, Team, Enterprise)
- Uses standard GitHub Actions and API
- Provides more flexibility in configuration
- Supports custom fastlane logic

### Q: Can I use this with private repositories?

Yes! The action works identically for public and private repositories.

## Queue Behavior

### Q: What happens if a PR in the queue is updated?

The PR remains in its position in the queue. When it reaches the front, the latest SHA is tested. If the PR has fallen too far behind the base (based on `behind_max_commits`), it's automatically updated before testing.

### Q: Can I manually reorder the queue?

Yes, edit the queue file (`.github/merge-queue-queue.json`) on the state branch to change the order. However, this is not recommended as it breaks the FIFO guarantee.

### Q: How do fastlane PRs affect the queue?

Fastlane PRs:
- Jump to the front of the queue
- Are processed immediately when detected
- Don't remove normal PRs from the queue
- Don't get added to the queue themselves

### Q: What if two PRs are approved at the same time?

They're added to the queue in the order discovered (based on creation time). The queue is FIFO, so the older PR is processed first.

### Q: Why is my PR not entering the queue?

Check that the PR meets ALL eligibility criteria:
1. Not a draft
2. Has review decision "APPROVED"
3. Mergeable state is not "CONFLICTING"
4. Targets the correct base branch

## Configuration

### Q: How often should I run the workflow?

Recommended schedule:
- **Shadow mode**: Every 5-10 minutes (`*/5 * * * *`)
- **Live mode**: Every 3-5 minutes (`*/3 * * * *`)

More frequent runs = faster queue processing but more CI resource usage.

### Q: Can I run merge queues for multiple base branches?

Yes! Create separate workflows for each base branch with different:
- Workflow names
- Concurrency groups
- Branch configurations (queue_branch, state_branch)

### Q: What merge methods are supported?

- `merge`: Standard merge commit (recommended, preserves tested tree)
- `squash`: Squash all commits into one
- `rebase`: Rebases and merges

Note: Rebase changes the tested commits, so merge or squash are preferred.

### Q: Can I customize the commit status context name?

Yes, use the `status_context` input. Make sure to update your branch protection rules to require the same context name.

### Q: How do I temporarily pause the queue?

1. Disable the workflow in GitHub Actions settings, or
2. Remove the schedule trigger from the workflow file, or
3. Add a manual approval step before the action runs

## Troubleshooting

### Q: "No eligible PR found to process"

This is normal when:
- No PRs are approved yet
- All approved PRs are drafts
- All approved PRs have conflicts

This is an info message, not an error.

### Q: My PR shows "pending" status indefinitely

**Possible causes**:
- Workflow not triggering frequently enough (check schedule)
- Concurrency group blocking runs
- PR doesn't meet eligibility criteria

**Solutions**:
1. Check workflow runs in Actions tab for errors
2. Verify branch protection requires the correct status context
3. Manually trigger workflow via workflow_dispatch
4. Check PR is approved and not draft

### Q: "Merge queue could not stage this PR due to conflicts"

**Cause**: PR branch conflicts with current base branch

**Solutions**:
1. Rebase PR branch on latest base: `git rebase origin/main`
2. Or merge base into PR: `git merge origin/main`
3. Push updated branch to trigger re-queueing

### Q: "Base moved during test; will retry"

**Cause**: Another PR merged while this PR was being staged/tested

**Solution**: Wait for next workflow run (PR will be re-tested automatically). This ensures PRs are always tested against the very latest base.

### Q: Stale branches are not auto-updating

**Possible causes**:
- `behind_max_commits` is 0 or not configured
- PR branch is from a fork (update requires write access)

**Solutions**:
1. Set `behind_max_commits: "100"` in workflow (or desired threshold)
2. For forks, maintainer must update manually or require contributors to rebase

### Q: Dashboard issue not created

**Possible causes**:
- Missing `issues: write` permission
- `enable_queue_tracking` is false
- Dashboard label doesn't exist

**Solutions**:
1. Add `issues: write` to workflow permissions
2. Set `enable_queue_tracking: true`
3. The action creates labels automatically on first run

### Q: The queue seems stuck on a failing PR

The action doesn't automatically skip failing PRs. If a PR fails CI tests on the staging branch:
1. The PR author should fix the tests
2. Or the PR should be closed/removed from queue
3. Or manually remove from queue by editing the queue file

### Q: Can I see the queue status without checking the action logs?

Yes! If `enable_queue_tracking: true` (default), the action creates/updates a dashboard issue showing the current queue state. Look for an issue titled "Merge Queue Dashboard" (or your custom `dashboard_title`).

## Advanced

### Q: Can I integrate this with GitHub Projects?

Yes! Use the `project_*` inputs to sync queue status to a GitHub Project (v2). Set:
- `project_mode: sync`
- `project_owner`: Organization or user name
- `project_number`: Project number
- Configure field names for status and position tracking

### Q: What happens if the state branch is deleted?

The action will recreate it and initialize a new empty queue on the next run. Any PRs previously in the queue will need to be re-approved to re-enter.

### Q: Can I use this with monorepos?

Yes! The action works with any repository structure. You can:
- Use path filters in PR triggers to only run on relevant changes
- Configure separate queues for different base branches
- Use fastlane patterns to prioritize certain types of changes

### Q: How does this handle GitHub API rate limiting?

The action uses the `gh` CLI which handles rate limiting automatically. For most repositories, the default rate limits are sufficient. If you hit limits:
- Reduce workflow frequency
- Reduce `dashboard_scan_open_issues` value
- Consider using a GitHub App token with higher limits

### Q: Can I run custom checks before allowing a PR into the queue?

Currently, the eligibility criteria are fixed (approved, not draft, no conflicts). For custom logic:
- Use required status checks in branch protection (only those that pass will be eligible)
- Use label-based holds (add `mq/hold` label to pause a PR)
- Modify the source code to add custom filters

### Q: What happens if a PR is force-pushed while in the queue?

The PR stays in the queue at its current position. On next processing:
- The latest SHA is tested
- If behind threshold exceeded, branch is auto-updated first
- If conflicts arise, PR is marked as failed

### Q: Can I use this with required reviewers from a CODEOWNERS file?

Yes! GitHub's review requirements (including CODEOWNERS) work normally. PRs won't be eligible for the queue until all required reviews are approved.
