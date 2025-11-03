# Merge Queue GitHub Action

This repository provides a GitHub composite action that implements a **merge queue** with an optional hot‑fix fastlane. The queue is FIFO (first‑in, first‑out) and works on GitHub Free and private repositories. Merges are staged on a temporary branch before reaching your protected branch, ensuring that only tested code lands on `master`/`main`.

## Features

* **FIFO merge queue** – Pull requests are merged in the order they were approved.
* **Hot‑fix fastlane** – Pull requests whose branch name or title matches a configurable regex (for example `hotfix/`) bypass the queue.
* **Auto‑update of stale branches** – Optionally update PR branches that have fallen behind your base by a specified number of commits.
* **Shadow vs. live mode** – Shadow mode tests your configuration without merging; live mode performs actual merges.
* **No additional services required** – Uses the built‑in `GITHUB_TOKEN` only; no enterprise features or external CI are required.

## Installation

Add the action to your workflow by referencing the tag in your repository. Make sure your repository’s **Settings → Branch protection** requires the custom status set in `status_context` (default `merge‑queue`) and disables **“Require branches to be up to date with base”**.

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

## Branch protection

1. Protect your base branch (`master` or `main`).
2. Require pull request reviews as you normally do.
3. Add the status context specified in your workflow (default `merge‑queue`) as the only required status check.
4. Turn **off** “Require branches to be up to date before merging.”
5. Allow **merge commits** (recommended) or configure your merge method to squash.

For more information on branch protection and security policies, see the GitHub documentation【162389469722289†L471-L485】.

## License

This project is licensed under the MIT License. The MIT License allows free use, modification, and distribution of the software, provided that the copyright notice and license text appear in all copies and substantial portions of the software【16404071374199†L4-L16】.

## Code of Conduct

Participation in this project is governed by a Code of Conduct that aims to create a welcoming and inclusive environment. The code is adapted from the Contributor Covenant v2.1 and outlines behaviours that foster a positive community and those that are unacceptable【426605577719396†L4-L27】. Please review it in [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Security

To report a security vulnerability, please see [`SECURITY.md`](SECURITY.md) for instructions on responsible disclosure.
