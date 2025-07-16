#!/usr/bin/env bun

/**
 * Setup the appropriate branch based on the event type:
 * - For PRs: Checkout the PR branch
 * - For Issues: Create a new branch
 */

import { $ } from "bun";
import * as core from "@actions/core";
import type { ParsedGitHubContext } from "../context";
import type { GitHubPullRequest } from "../types";
import type { Octokits } from "../api/client";
import type { FetchDataResult } from "../data/fetcher";

export type BranchInfo = {
  baseBranch: string;
  claudeBranch?: string;
  currentBranch: string;
};

export async function setupBranch(
  octokits: Octokits,
  githubData: FetchDataResult,
  context: ParsedGitHubContext,
): Promise<BranchInfo> {
  const { owner, repo } = context.repository;
  const entityNumber = context.entityNumber;
  const { baseBranch, baseBranchPrompt, branchPrefix } = context.inputs;
  const isPR = context.isPR;

  if (isPR) {
    const prData = githubData.contextData as GitHubPullRequest;
    const prState = prData.state;

    // Check if PR is closed or merged
    if (prState === "CLOSED" || prState === "MERGED") {
      console.log(
        `PR #${entityNumber} is ${prState}, creating new branch from source...`,
      );
      // Fall through to create a new branch like we do for issues
    } else {
      // Handle open PR: Checkout the PR branch
      console.log("This is an open PR, checking out PR branch...");

      const branchName = prData.headRefName;

      // Determine optimal fetch depth based on PR commit count, with a minimum of 20
      const commitCount = prData.commits.totalCount;
      const fetchDepth = Math.max(commitCount, 20);

      console.log(
        `PR #${entityNumber}: ${commitCount} commits, using fetch depth ${fetchDepth}`,
      );

      // Execute git commands to checkout PR branch (dynamic depth based on PR size)
      await $`git fetch origin --depth=${fetchDepth} ${branchName}`;
      await $`git checkout ${branchName}`;

      console.log(`Successfully checked out PR branch for PR #${entityNumber}`);

      // For open PRs, we need to get the base branch of the PR
      const baseBranch = prData.baseRefName;

      return {
        baseBranch,
        currentBranch: branchName,
      };
    }
  }

  // Determine source branch based on the logic:
  // 1. If base_branch is provided, use it
  // 2. If base_branch is null and base_branch_prompt is provided, use AI to determine
  // 3. Otherwise, use repository default branch
  let sourceBranch: string;

  if (baseBranch) {
    // Use provided base branch for source
    sourceBranch = baseBranch;
    console.log(`Using provided base branch: ${baseBranch}`);
  } else if (baseBranchPrompt) {
    // Use AI to determine the base branch
    console.log(`Using AI prompt to determine base branch: ${baseBranchPrompt}`);
    // For now, this is a placeholder - actual AI implementation would go here
    // This would need to call an AI service to analyze the prompt and determine the branch
    console.log("AI branch determination not yet implemented, falling back to default branch");
    
    // Fallback to default branch
    const repoResponse = await octokits.rest.repos.get({
      owner,
      repo,
    });
    sourceBranch = repoResponse.data.default_branch;
  } else {
    // No base branch or prompt provided, fetch the default branch to use as source
    const repoResponse = await octokits.rest.repos.get({
      owner,
      repo,
    });
    sourceBranch = repoResponse.data.default_branch;
    console.log(`Using repository default branch: ${sourceBranch}`);
  }

  // Generate branch name for either an issue or closed/merged PR
  const entityType = isPR ? "pr" : "issue";

  let branchName: string;
  
  console.log(`🔍 Branch creation debug:
    - useTimestampSuffix: ${context.inputs.useTimestampSuffix}
    - branchPrefix: ${branchPrefix}
    - entityType: ${entityType}
    - entityNumber: ${entityNumber}`);
  
  if (context.inputs.useTimestampSuffix) {
    // Create Kubernetes-compatible timestamp: lowercase, hyphens only, shorter format
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    branchName = `${branchPrefix}${entityType}-${entityNumber}-${timestamp}`;
    console.log(`🔍 Creating branch WITH timestamp: ${branchName}`);
  } else {
    // Simple branch name without timestamp
    branchName = `${branchPrefix}${entityType}-${entityNumber}`;
    console.log(`🔍 Creating branch WITHOUT timestamp: ${branchName}`);
  }

  // Ensure branch name is Kubernetes-compatible:
  // - Lowercase only
  // - Alphanumeric with hyphens
  // - No underscores
  // - Max 50 chars (to allow for prefixes)
  const newBranch = branchName.toLowerCase().substring(0, 50);

  try {
    // Get the SHA of the source branch to verify it exists
    const sourceBranchRef = await octokits.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${sourceBranch}`,
    });

    const currentSHA = sourceBranchRef.data.object.sha;
    console.log(`Source branch SHA: ${currentSHA}`);

    // For commit signing, defer branch creation to the file ops server
    if (context.inputs.useCommitSigning) {
      console.log(
        `Branch name generated: ${newBranch} (will be created by file ops server on first commit)`,
      );

      // Set outputs for GitHub Actions
      core.setOutput("CLAUDE_BRANCH", newBranch);
      core.setOutput("BASE_BRANCH", sourceBranch);
      return {
        baseBranch: sourceBranch,
        claudeBranch: newBranch,
        currentBranch: sourceBranch, // Stay on source branch for now
      };
    }

    // For non-signing case, create and checkout the branch locally only
    console.log(
      `Creating local branch ${newBranch} for ${entityType} #${entityNumber} from source branch: ${sourceBranch}...`,
    );

    // Create and checkout the new branch locally
    await $`git checkout -b ${newBranch}`;

    console.log(
      `Successfully created and checked out local branch: ${newBranch}`,
    );

    // Set outputs for GitHub Actions
    core.setOutput("CLAUDE_BRANCH", newBranch);
    core.setOutput("BASE_BRANCH", sourceBranch);
    return {
      baseBranch: sourceBranch,
      claudeBranch: newBranch,
      currentBranch: newBranch,
    };
  } catch (error) {
    console.error("Error in branch setup:", error);
    process.exit(1);
  }
}
