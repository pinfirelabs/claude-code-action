#!/usr/bin/env bun

/**
 * Create the initial tracking comment when Claude Code starts working
 * This comment shows the working status and includes a link to the job run
 */

import { appendFileSync } from "fs";
import { createJobRunLink, createCommentBody } from "./common";
import {
  isPullRequestReviewCommentEvent,
  isPullRequestEvent,
  type ParsedGitHubContext,
} from "../../context";
import type { Octokit } from "@octokit/rest";

const CLAUDE_APP_BOT_ID = 209825114;

export async function createInitialComment(
  octokit: Octokit,
  context: ParsedGitHubContext,
) {
  const { owner, repo } = context.repository;

  const jobRunLink = createJobRunLink(owner, repo, context.runId);
  const initialBody = createCommentBody(jobRunLink);

  // Determine target entity - use pr_number if specified, otherwise use current entity
  const targetEntityNumber = context.inputs.prNumber || context.entityNumber;
  const targetIsPR = context.inputs.prNumber ? true : context.isPR;

  try {
    let response;

    if (
      context.inputs.useStickyComment &&
      targetIsPR &&
      (isPullRequestEvent(context) || context.inputs.prNumber)
    ) {
      const comments = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: targetEntityNumber,
      });
      const existingComment = comments.data.find((comment) => {
        const idMatch = comment.user?.id === CLAUDE_APP_BOT_ID;
        const botNameMatch =
          comment.user?.type === "Bot" &&
          comment.user?.login.toLowerCase().includes("claude");
        const bodyMatch = comment.body === initialBody;

        return idMatch || botNameMatch || bodyMatch;
      });
      if (existingComment) {
        response = await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: existingComment.id,
          body: initialBody,
        });
      } else {
        // Create new comment if no existing one found
        response = await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: targetEntityNumber,
          body: initialBody,
        });
      }
    } else if (
      isPullRequestReviewCommentEvent(context) &&
      !context.inputs.prNumber
    ) {
      // Only use createReplyForReviewComment if it's a PR review comment AND not working within a specified PR
      response = await octokit.rest.pulls.createReplyForReviewComment({
        owner,
        repo,
        pull_number: targetEntityNumber,
        comment_id: context.payload.comment.id,
        body: initialBody,
      });
    } else {
      // For all other cases (issues, issue comments, or missing comment_id)
      response = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: targetEntityNumber,
        body: initialBody,
      });
    }

    // Output the comment ID for downstream steps using GITHUB_OUTPUT
    const githubOutput = process.env.GITHUB_OUTPUT!;
    appendFileSync(githubOutput, `claude_comment_id=${response.data.id}\n`);
    console.log(`✅ Created initial comment with ID: ${response.data.id}`);
    return response.data;
  } catch (error) {
    console.error("Error in initial comment:", error);

    // Always fall back to regular issue comment if anything fails
    try {
      const response = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: targetEntityNumber,
        body: initialBody,
      });

      const githubOutput = process.env.GITHUB_OUTPUT!;
      appendFileSync(githubOutput, `claude_comment_id=${response.data.id}\n`);
      console.log(`✅ Created fallback comment with ID: ${response.data.id}`);
      return response.data;
    } catch (fallbackError) {
      console.error("Error creating fallback comment:", fallbackError);
      throw fallbackError;
    }
  }
}
