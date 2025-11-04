/**
 * Main entry point for the GitHub Action
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import * as gh from "./github-cli";

/**
 * Type definitions
 */
interface PullRequestNode {
  createdAt: string;
  title: string;
  number: number;
  isDraft: boolean;
  headRefName: string;
  headRefOid: string;
  reviewDecision: string | null;
  mergeable: string;
}

interface GraphQLPRResponse {
  repository: {
    pullRequests: {
      nodes: PullRequestNode[];
    };
  };
}

interface QueueData {
  version: number;
  queue: number[];
}

interface QueueInfo {
  queue: number[];
  sha: string | null;
}

interface PrDetail {
  num: number;
  title: string;
  user: string;
  created: string;
  head: string;
  state: string;
}

interface StageResult {
  stagedSha: string | null;
  conflict: boolean;
}

interface GithubLabel {
  name: string;
}

interface GithubIssue {
  title: string;
  number: number;
}

interface Config {
  token: string;
  baseBranch: string;
  queueBranch: string;
  fastlaneBranch: string;
  stateBranch: string;
  queueFile: string;
  statusContext: string;
  mode: string;
  fastlaneMatchersInput: string;
  behindMaxCommits: number;
  mergeMethod: string;
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

/**
 * Helper function to get error message from unknown error
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Get and validate token
 */
function getToken(): string {
  const token = core.getInput("token") || process.env.GITHUB_TOKEN || "";
  if (!token) {
    throw new Error(
      'No GitHub token provided. Set the "token" input or rely on GITHUB_TOKEN.',
    );
  }
  return token;
}

/**
 * Parse boolean input
 */
function getBooleanInput(name: string, defaultValue: boolean): boolean {
  return (core.getInput(name) || String(defaultValue)).toLowerCase() === "true";
}

/**
 * Parse integer input
 */
function getIntInput(name: string, defaultValue: number): number {
  return parseInt(core.getInput(name) || String(defaultValue), 10);
}

/**
 * Get string input with optional default
 */
function getStringInput(name: string, defaultValue: string): string {
  return core.getInput(name) || defaultValue;
}

/**
 * Get lowercase string input
 */
function getLowercaseInput(name: string, defaultValue: string): string {
  return (core.getInput(name) || defaultValue).toLowerCase();
}

/**
 * Read branch configuration
 */
function readBranchConfig() {
  return {
    baseBranch: getStringInput("base_branch", "master"),
    queueBranch: getStringInput("queue_branch", "merge-queue/staging"),
    fastlaneBranch: getStringInput("fastlane_branch", "merge-queue/fastlane"),
    stateBranch: getStringInput("state_branch", "merge-queue/state"),
  };
}

/**
 * Read dashboard configuration
 */
function readDashboardConfig() {
  return {
    dashboardTitle: getStringInput("dashboard_title", "Merge Queue Dashboard"),
    dashboardLabel: getStringInput("dashboard_label", "mq/dashboard"),
    dashboardPin: getBooleanInput("dashboard_pin", true),
    dashboardScanOpenIssues: getIntInput("dashboard_scan_open_issues", 100),
  };
}

/**
 * Read project configuration
 */
function readProjectConfig() {
  const projectNumberRaw = core.getInput("project_number") || "";
  const projectNumber = projectNumberRaw
    ? parseInt(projectNumberRaw, 10)
    : null;

  return {
    projectMode: getLowercaseInput("project_mode", "none"),
    projectOwnerInput: getStringInput("project_owner", ""),
    projectNumber,
    projectTitle: getStringInput("project_title", "Merge Queue"),
    projectStatusFieldName: getStringInput(
      "project_status_field_name",
      "Status",
    ),
    projectQueuePosFieldName: getStringInput(
      "project_queuepos_field_name",
      "Queue Position",
    ),
  };
}

/**
 * Read configuration from action inputs
 */
function readConfig(): Config {
  return {
    token: getToken(),
    ...readBranchConfig(),
    queueFile: getStringInput("queue_file", ".github/merge-queue-queue.json"),
    statusContext: getStringInput("status_context", "merge-queue"),
    mode: getLowercaseInput("mode", "shadow"),
    fastlaneMatchersInput: getStringInput(
      "fastlane_matchers",
      "^(hotfix|critical|security)/,\bhotfix\b,^hotfix:",
    ),
    behindMaxCommits: getIntInput("behind_max_commits", 100),
    mergeMethod: getLowercaseInput("merge_method", "merge"),
    cleanQueue: getBooleanInput("clean_queue", true),
    enableQueueTracking: getBooleanInput("enable_queue_tracking", true),
    ...readDashboardConfig(),
    ...readProjectConfig(),
  };
}

/**
 * Create fastlane regex matchers from input string
 */
function createFastlaneMatchers(input: string): RegExp[] {
  return (input || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pattern) => {
      try {
        return new RegExp(pattern, "i");
      } catch (e) {
        const errorMessage = getErrorMessage(e);
        core.warning(`Invalid fastlane pattern "${pattern}": ${errorMessage}`);
        return null;
      }
    })
    .filter((x): x is RegExp => x !== null);
}

/**
 * Determine if a PR qualifies for the fastlane based on its branch name or title.
 */
function isFastlane(
  pr: { headRefName?: string; title?: string },
  fastlaneRegexes: RegExp[],
): boolean {
  if (!fastlaneRegexes.length) return false;
  const name = pr.headRefName || "";
  const title = pr.title || "";
  return fastlaneRegexes.some((re) => re.test(name) || re.test(title));
}

/**
 * Render the queue as a markdown table.
 */
function renderQueueMarkdown(rows: PrDetail[], baseBranch: string): string {
  let md = `### Merge Queue (base: \`${baseBranch}\`)\n\n`;
  if (!rows.length) {
    md += "_Queue is empty._\n";
  } else {
    md += "| Pos | PR | Title | Author | Created | Head | State |\n";
    md += "|---:|---:|---|---|---|---|---|\n";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const safeTitle = (r.title || "").replace(/\|/g, "\\|");
      md += `| ${i + 1} | #${r.num} | ${safeTitle} | ${r.user} | ${r.created} | \`${r.head}\` | ${r.state} |\n`;
    }
  }
  return md;
}

/**
 * Initialize required labels for merge queue operations
 */
async function initializeLabels(
  owner: string,
  repo: string,
): Promise<void> {
  const labels = [
    { name: "mq/dashboard", description: "Label for the merge queue dashboard issue", color: "0E8A16" },
    { name: "mq/queued", description: "PR is in the merge queue", color: "0366d6" },
    { name: "mq/staging", description: "PR is being staged for testing", color: "fbca04" },
    { name: "mq/testing", description: "PR is being tested in the queue", color: "d4c5f9" },
    { name: "mq/conflict", description: "PR has merge conflicts", color: "d73a4a" },
    { name: "mq/fastlane", description: "PR is in the fastlane (hotfix) queue", color: "ff6347" },
    { name: "mq/hold", description: "Hold PR from entering the queue", color: "e99695" },
    { name: "mq/ready", description: "PR is ready to be queued", color: "0e8a16" },
    { name: "mq/failed", description: "PR failed queue tests", color: "b60205" },
  ];

  try {
    const existingLabels = await gh.listLabels(owner, repo);
    const existingLabelNames = new Set(
      existingLabels.map((l) => l.name.toLowerCase())
    );

    for (const label of labels) {
      if (!existingLabelNames.has(label.name.toLowerCase())) {
        try {
          await gh.createLabel(owner, repo, label.name, label.description, label.color);
          core.info(`Created label: ${label.name}`);
        } catch (e) {
          const errorMessage = getErrorMessage(e);
          core.warning(`Failed to create label "${label.name}": ${errorMessage}`);
        }
      }
    }
  } catch (e) {
    const errorMessage = getErrorMessage(e);
    core.warning(`Failed to initialize labels: ${errorMessage}`);
  }
}

/**
 * Merge Queue Action
 *
 * This script implements a merge queue with optional fastlane handling,
 * stale branch updating, queue tracking, and GitHub Project (v2) sync.
 * It runs as a Node action using the GitHub Actions toolkit.
 */
async function run() {
  try {
    const { owner, repo } = github.context.repo;
    const config = readConfig();
    const fastlaneRegexes = createFastlaneMatchers(
      config.fastlaneMatchersInput,
    );

    // Initialize labels
    await initializeLabels(owner, repo);

    // Initialize helper functions with context
    const branchOps = createBranchOperations(owner, repo);
    const queueOps = createQueueOperations(
      owner,
      repo,
      config.stateBranch,
      config.queueFile,
      config.baseBranch,
      branchOps,
    );
    const prOps = createPROperations(
      owner,
      repo,
      config.baseBranch,
      config.statusContext,
      config.behindMaxCommits,
    );
    const dashboardOps = createDashboardOperations(
      owner,
      repo,
      config.dashboardTitle,
      config.dashboardLabel,
      config.dashboardPin,
      config.dashboardScanOpenIssues,
    );

    // Main workflow
    await executeQueueWorkflow(
      config,
      fastlaneRegexes,
      branchOps,
      queueOps,
      prOps,
      dashboardOps,
    );
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const stack =
      error instanceof Error && error.stack ? error.stack : errorMessage;
    core.setFailed(stack);
  }
}

/**
 * Create branch operations
 */
function createBranchOperations(
  owner: string,
  repo: string,
) {
  async function getBranchSha(branch: string): Promise<string> {
    return await gh.getRef(owner, repo, branch);
  }

  async function ensureBranch(branch: string, sha: string): Promise<void> {
    try {
      const currentSha = await getBranchSha(branch);
      if (currentSha !== sha) {
        await gh.updateRef(owner, repo, branch, sha, true);
      }
    } catch (e) {
      // If branch doesn't exist (404), create it
      await gh.createRef(owner, repo, branch, sha);
    }
  }

  async function deleteBranch(branch: string): Promise<void> {
    await gh.deleteRef(owner, repo, branch);
  }

  return { getBranchSha, ensureBranch, deleteBranch };
}

/**
 * Create queue operations
 */
function createQueueOperations(
  owner: string,
  repo: string,
  stateBranch: string,
  queueFile: string,
  baseBranch: string,
  branchOps: ReturnType<typeof createBranchOperations>,
) {
  async function ensureStateBranch(): Promise<void> {
    const baseSha = await branchOps.getBranchSha(baseBranch);
    try {
      await branchOps.getBranchSha(stateBranch);
    } catch (e) {
      // If branch doesn't exist, create it
      await gh.createRef(owner, repo, stateBranch, baseSha);
    }
  }

  async function fetchQueueFile(): Promise<QueueInfo> {
    const data = await gh.getFileContents(owner, repo, queueFile, stateBranch);

    if (data.content) {
      const content = Buffer.from(
        data.content,
        data.encoding === "base64" ? "base64" : "utf8",
      ).toString("utf8");
      const json = JSON.parse(content || "{}") as Partial<QueueData>;
      const queue = Array.isArray(json.queue) ? json.queue : [];
      return { queue, sha: data.sha };
    }
    return { queue: [], sha: null };
  }

  async function initializeQueueFile(): Promise<QueueInfo> {
    const initial: QueueData = { version: 1, queue: [] };
    const encoded = Buffer.from(JSON.stringify(initial, null, 2)).toString(
      "base64",
    );
    await gh.putFileContents(
      owner,
      repo,
      queueFile,
      stateBranch,
      "merge-queue: init queue [skip ci]",
      encoded,
    );
    return { queue: [], sha: null };
  }

  async function readQueue(): Promise<QueueInfo> {
    await ensureStateBranch();

    try {
      return await fetchQueueFile();
    } catch (e) {
      // If file doesn't exist, initialize it
      return await initializeQueueFile();
    }
  }

  async function writeQueue(
    queue: number[],
    sha: string | null,
  ): Promise<string> {
    const obj: QueueData = { version: 1, queue };
    const encoded = Buffer.from(JSON.stringify(obj, null, 2)).toString(
      "base64",
    );

    const newSha = await gh.putFileContents(
      owner,
      repo,
      queueFile,
      stateBranch,
      "merge-queue: sync queue [skip ci]",
      encoded,
      sha || undefined,
    );

    return newSha || sha || "";
  }

  return { readQueue, writeQueue };
}

/**
 * Create PR operations
 */
function createPROperations(
  owner: string,
  repo: string,
  baseBranch: string,
  statusContext: string,
  behindMaxCommits: number,
) {
  async function fetchOpenPRs(): Promise<PullRequestNode[]> {
    const query = `
        query($owner: String!, $repo: String!, $base: String!) {
          repository(owner: $owner, name: $repo) {
            pullRequests(states: OPEN, baseRefName: $base, first: 100, orderBy: { field: CREATED_AT, direction: ASC }) {
              nodes {
                createdAt
                title
                number
                isDraft
                headRefName
                headRefOid
                reviewDecision
                mergeable
              }
            }
          }
        }
      `;

    return await gh.fetchOpenPRs(owner, repo, baseBranch, query);
  }

  async function getBehindBy(
    base: string,
    head: string,
  ): Promise<number | null> {
    return await gh.compareCommits(owner, repo, base, head);
  }

  async function maybeUpdateBranch(
    prNumber: number,
    currentSha: string,
  ): Promise<string> {
    if (!behindMaxCommits || behindMaxCommits <= 0) return currentSha;

    const pr = await gh.getPullRequest(owner, repo, prNumber);

    const headRef = pr.head.ref;
    const headRepo = pr.head.repo;
    if (!headRepo) {
      core.warning(`PR #${prNumber} has no head repo, skipping update check`);
      return currentSha;
    }

    const headRepoOwner = headRepo.owner.login;
    const qualifiedHead = `${headRepoOwner}:${headRef}`;
    const behind = await getBehindBy(baseBranch, qualifiedHead);

    if (behind === null) return currentSha;

    if (behind > behindMaxCommits) {
      try {
        await gh.updatePullRequestBranch(owner, repo, prNumber);

        const pr2 = await gh.getPullRequest(owner, repo, prNumber);

        core.notice(
          `PR #${prNumber} was behind by ${behind} commits; auto updated to ${pr2.head.sha}`,
        );
        return pr2.head.sha;
      } catch (e) {
        const errorMessage = getErrorMessage(e);
        core.warning(`Auto update failed for PR #${prNumber}: ${errorMessage}`);
        return currentSha;
      }
    }
    return currentSha;
  }

  async function setStatus(
    sha: string,
    state: "pending" | "success" | "failure" | "error",
    description: string,
  ): Promise<void> {
    await gh.createCommitStatus(owner, repo, sha, state, statusContext, description);
  }

  async function stageOnBranch(
    trainBranch: string,
    headSha: string,
    baseSha: string,
    branchOps: ReturnType<typeof createBranchOperations>,
  ): Promise<StageResult> {
    await branchOps.ensureBranch(trainBranch, baseSha);
    const result = await gh.mergeBranches(owner, repo, trainBranch, headSha);
    return { stagedSha: result.sha, conflict: result.conflict };
  }

  async function fetchPrDetails(numbers: number[]): Promise<PrDetail[]> {
    const details: PrDetail[] = [];
    for (const num of numbers) {
      const detail = await fetchSinglePrDetail(num);
      details.push(detail);
    }
    return details;
  }

  async function fetchSinglePrDetail(num: number): Promise<PrDetail> {
    try {
      const pr = await gh.getPullRequest(owner, repo, num);
      return {
        num,
        title: pr.title || "-",
        user: pr.user ? pr.user.login : "-",
        created: pr.created_at ? pr.created_at.substring(0, 10) : "-",
        head: pr.head ? pr.head.ref : "-",
        state: pr.draft
          ? "DRAFT"
          : (pr.mergeable_state || "-").toUpperCase(),
      };
    } catch {
      return {
        num,
        title: "(not found)",
        user: "-",
        created: "-",
        head: "-",
        state: "-",
      };
    }
  }

  return {
    fetchOpenPRs,
    maybeUpdateBranch,
    setStatus,
    stageOnBranch,
    fetchPrDetails,
  };
}

/**
 * Create dashboard operations
 */
function createDashboardOperations(
  owner: string,
  repo: string,
  dashboardTitle: string,
  dashboardLabel: string,
  dashboardPin: boolean,
  dashboardScanOpenIssues: number,
) {
  async function getLabelsToUse(): Promise<string[]> {
    const labelsToUse: string[] = [];
    if (dashboardLabel) {
      // Label should already be created by initializeLabels()
      // Just add it to the list for the dashboard issue
      labelsToUse.push(dashboardLabel);
    }
    return labelsToUse;
  }

  async function findExistingIssue(): Promise<GithubIssue | null> {
    try {
      const openIssues = await gh.listIssues(owner, repo, "open", dashboardScanOpenIssues);
      const found = openIssues.find((i) => i.title === dashboardTitle);
      return found || null;
    } catch (e) {
      const errorMessage = getErrorMessage(e);
      core.warning(`Failed to list open issues: ${errorMessage}`);
      return null;
    }
  }

  async function pinIssue(issueNumber: number): Promise<void> {
    if (!dashboardPin) return;
    try {
      await gh.pinIssue(owner, repo, issueNumber);
      core.info(`Pinned dashboard issue #${issueNumber}`);
    } catch (e) {
      const errorMessage = getErrorMessage(e);
      core.warning(`Failed to pin issue #${issueNumber}: ${errorMessage}`);
    }
  }

  async function lockIssue(issueNumber: number): Promise<void> {
    try {
      await gh.lockIssue(owner, repo, issueNumber, "resolved");
      core.info(`Locked dashboard issue #${issueNumber}`);
    } catch (e) {
      const errorMessage = getErrorMessage(e);
      core.warning(`Failed to lock issue #${issueNumber}: ${errorMessage}`);
    }
  }

  async function updateExistingIssue(
    issueNumber: number,
    body: string,
  ): Promise<void> {
    await gh.updateIssue(owner, repo, issueNumber, body);
    await pinIssue(issueNumber);
    await lockIssue(issueNumber);
  }

  async function createNewIssue(body: string, labels: string[]): Promise<void> {
    try {
      const issueNumber = await gh.createIssue(owner, repo, dashboardTitle, body, labels);
      await pinIssue(issueNumber);
      await lockIssue(issueNumber);
    } catch {
      try {
        const issueNumber = await gh.createIssue(owner, repo, dashboardTitle, body);
        await pinIssue(issueNumber);
        await lockIssue(issueNumber);
      } catch (e2) {
        const errorMessage = getErrorMessage(e2);
        core.warning(`Failed to create dashboard issue: ${errorMessage}`);
      }
    }
  }

  async function upsertDashboard(body: string): Promise<void> {
    const labelsToUse = await getLabelsToUse();
    const existingIssue = await findExistingIssue();

    if (existingIssue) {
      await updateExistingIssue(existingIssue.number, body);
    } else {
      await createNewIssue(body, labelsToUse);
    }
  }

  return { upsertDashboard };
}

/**
 * Execute the main queue workflow
 */
async function executeQueueWorkflow(
  config: Config,
  fastlaneRegexes: RegExp[],
  branchOps: ReturnType<typeof createBranchOperations>,
  queueOps: ReturnType<typeof createQueueOperations>,
  prOps: ReturnType<typeof createPROperations>,
  dashboardOps: ReturnType<typeof createDashboardOperations>,
) {
  const queueInfo = await queueOps.readQueue();
  let queue: number[] = queueInfo.queue.slice();
  let queueSha: string | null = queueInfo.sha;

  const prs = await prOps.fetchOpenPRs();
  const eligible = prs.filter(
    (pr) =>
      !pr.isDraft &&
      pr.reviewDecision === "APPROVED" &&
      pr.mergeable !== "CONFLICTING",
  );

  const fastCandidate = eligible.find((pr) => isFastlane(pr, fastlaneRegexes));
  const normalEligible = eligible.filter(
    (pr) => !isFastlane(pr, fastlaneRegexes),
  );
  const eligibleNums = new Set(normalEligible.map((p) => p.number));

  queue = queue.filter((num) => eligibleNums.has(num));
  for (const pr of normalEligible) {
    if (!queue.includes(pr.number)) queue.push(pr.number);
  }

  const newQueueJson: QueueData = { version: 1, queue };
  const currentQueueContent = JSON.stringify(
    { version: 1, queue: queueInfo.queue },
    null,
    2,
  );
  const newQueueContent = JSON.stringify(newQueueJson, null, 2);

  if (newQueueContent !== currentQueueContent) {
    queueSha = await queueOps.writeQueue(queue, queueSha);
  }

  let candidate: PullRequestNode | null = null;
  let isFastCandidate = false;

  if (fastCandidate) {
    candidate = fastCandidate;
    isFastCandidate = true;
  } else if (queue.length) {
    const headNum = queue[0];
    candidate = normalEligible.find((pr) => pr.number === headNum) || null;
  }

  if (!candidate) {
    core.info("No eligible PR found to process.");
    if (config.enableQueueTracking) {
      await updateDashboard(queue, prOps, dashboardOps, config.baseBranch);
    }
    return;
  }

  await processCandidate(
    candidate,
    isFastCandidate,
    queue,
    queueSha,
    config,
    branchOps,
    queueOps,
    prOps,
    dashboardOps,
  );
}

/**
 * Update dashboard with current queue state
 */
async function updateDashboard(
  queue: number[],
  prOps: ReturnType<typeof createPROperations>,
  dashboardOps: ReturnType<typeof createDashboardOperations>,
  baseBranch: string,
) {
  const rows = await prOps.fetchPrDetails(queue);
  const md = renderQueueMarkdown(rows, baseBranch);
  await core.summary.addRaw(md).write();
  await dashboardOps.upsertDashboard(md);
}

/**
 * Process a candidate PR
 */
async function processCandidate(
  candidate: PullRequestNode,
  isFastCandidate: boolean,
  queue: number[],
  queueSha: string | null,
  config: Config,
  branchOps: ReturnType<typeof createBranchOperations>,
  queueOps: ReturnType<typeof createQueueOperations>,
  prOps: ReturnType<typeof createPROperations>,
  dashboardOps: ReturnType<typeof createDashboardOperations>,
) {
  const prNumber = candidate.number;
  let prHeadSha = candidate.headRefOid;

  prHeadSha = await prOps.maybeUpdateBranch(prNumber, prHeadSha);
  await prOps.setStatus(prHeadSha, "pending", "Queued in merge queue");

  const trainBranch = isFastCandidate
    ? config.fastlaneBranch
    : config.queueBranch;
  const initialBaseSha = await branchOps.getBranchSha(config.baseBranch);
  const staged = await prOps.stageOnBranch(
    trainBranch,
    prHeadSha,
    initialBaseSha,
    branchOps,
  );

  if (staged.conflict) {
    await handleConflict(
      prNumber,
      prHeadSha,
      trainBranch,
      config,
      branchOps,
      prOps,
    );
    return;
  }

  const currentBaseSha = await branchOps.getBranchSha(config.baseBranch);
  const baseMoved = initialBaseSha !== currentBaseSha;

  if (baseMoved) {
    await handleBaseMoved(prHeadSha, trainBranch, config, branchOps, prOps);
  } else {
    await handleSuccess(
      prNumber,
      prHeadSha,
      isFastCandidate,
      trainBranch,
      queue,
      queueSha,
      config,
      branchOps,
      queueOps,
      prOps,
    );
  }

  if (config.enableQueueTracking) {
    await updateDashboard(queue, prOps, dashboardOps, config.baseBranch);
  }
}

/**
 * Handle merge conflict scenario
 */
async function handleConflict(
  prNumber: number,
  prHeadSha: string,
  trainBranch: string,
  config: Config,
  branchOps: ReturnType<typeof createBranchOperations>,
  prOps: ReturnType<typeof createPROperations>,
) {
  const { owner, repo } = github.context.repo;

  const comment = `Merge queue could not stage this PR due to conflicts with the latest \`${config.baseBranch}\`. Please rebase/merge and push.`;
  await gh.commentOnIssue(owner, repo, prNumber, comment);

  await prOps.setStatus(prHeadSha, "failure", "Conflict with base branch");
  if (config.cleanQueue) await branchOps.deleteBranch(trainBranch);
}

/**
 * Handle base moved scenario
 */
async function handleBaseMoved(
  prHeadSha: string,
  trainBranch: string,
  config: Config,
  branchOps: ReturnType<typeof createBranchOperations>,
  prOps: ReturnType<typeof createPROperations>,
) {
  await prOps.setStatus(
    prHeadSha,
    "pending",
    "Base moved during test; will retry",
  );
  if (config.cleanQueue) await branchOps.deleteBranch(trainBranch);
}

/**
 * Handle success scenario
 */
async function handleSuccess(
  prNumber: number,
  prHeadSha: string,
  isFastCandidate: boolean,
  trainBranch: string,
  queue: number[],
  queueSha: string | null,
  config: Config,
  branchOps: ReturnType<typeof createBranchOperations>,
  queueOps: ReturnType<typeof createQueueOperations>,
  prOps: ReturnType<typeof createPROperations>,
) {
  if (config.mode === "live") {
    await mergePR(
      prNumber,
      prHeadSha,
      isFastCandidate,
      queue,
      queueSha,
      config,
      queueOps,
      prOps,
    );
  } else {
    await prOps.setStatus(
      prHeadSha,
      "success",
      isFastCandidate
        ? "Fastlane passed on staging (shadow)"
        : "Passed on staging (shadow)",
    );
  }

  if (config.cleanQueue) {
    await branchOps.deleteBranch(trainBranch);
  }
}

/**
 * Merge PR in live mode
 */
async function mergePR(
  prNumber: number,
  prHeadSha: string,
  isFastCandidate: boolean,
  queue: number[],
  queueSha: string | null,
  config: Config,
  queueOps: ReturnType<typeof createQueueOperations>,
  prOps: ReturnType<typeof createPROperations>,
) {
  const { owner, repo } = github.context.repo;

  try {
    const mergeMethod = config.mergeMethod === "squash" ? "squash" : "merge";
    await gh.mergePullRequest(owner, repo, prNumber, mergeMethod);

    await prOps.setStatus(
      prHeadSha,
      "success",
      isFastCandidate
        ? "Fastlane passed; merged to base"
        : "Passed on staging; merged to base",
    );
  } catch (e) {
    const errorMessage = getErrorMessage(e);
    core.warning(`Failed to merge PR #${prNumber}: ${errorMessage}`);
    await prOps.setStatus(prHeadSha, "failure", "Failed to merge");
  }

  if (!isFastCandidate) {
    const updatedQueue = queue.filter((n) => n !== prNumber);
    await queueOps.writeQueue(updatedQueue, queueSha);
  }
}

// Only run if this is the main module (not being imported for testing)
if (require.main === module) {
  run();
}
