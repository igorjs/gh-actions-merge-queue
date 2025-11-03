# Branch Protection Settings

To use the merge queue action effectively you should configure your protected branch (`master` or `main`) as follows:

1. **Enable branch protection** for your base branch.
2. **Require pull request reviews** according to your team’s policy.
3. **Add the custom status context** specified in your workflow (for example `merge‑queue`) as the only required status check.
4. **Disable “Require branches to be up to date before merging.”** The merge queue ensures PRs are tested on top of the latest base.
5. **Allow merge commits.** This preserves the tested merge commit. If you must enforce a linear history, set `merge_method: squash` in your workflow instead.

Refer to GitHub’s branch protection documentation for further details on these settings.