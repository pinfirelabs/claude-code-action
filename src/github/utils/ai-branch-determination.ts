import Anthropic from "@anthropic-ai/sdk";
import type { ParsedGitHubContext } from "../context";
import type { FetchDataResult } from "../data/fetcher";
import type { Octokits } from "../api/client";

export async function determineBranchWithAI(
  octokits: Octokits,
  githubData: FetchDataResult,
  context: ParsedGitHubContext,
  prompt: string,
): Promise<string> {
  try {
    // Get authentication details - try multiple sources
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const claudeCodeOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    
    if (!anthropicApiKey && !claudeCodeOAuthToken) {
      console.log("No Anthropic authentication available for AI branch determination, falling back to default");
      return await getDefaultBranch(octokits, context);
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: anthropicApiKey || claudeCodeOAuthToken,
    });

    // Get repository information for context
    const { owner, repo } = context.repository;
    const repoResponse = await octokits.rest.repos.get({
      owner,
      repo,
    });

    // Get list of branches
    const branchesResponse = await octokits.rest.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    });

    const branches = branchesResponse.data.map(branch => branch.name);
    const defaultBranch = repoResponse.data.default_branch;

    // Prepare context for AI
    const contextInfo = {
      repository: `${owner}/${repo}`,
      defaultBranch,
      availableBranches: branches,
      entityType: context.isPR ? "pull_request" : "issue",
      entityNumber: context.entityNumber,
      eventName: context.eventName,
    };

    // Add issue/PR context
    let entityContext = "";
    if (context.isPR) {
      const prData = githubData.contextData as any;
      entityContext = `PR #${context.entityNumber}: ${prData.title}\n${prData.body || ""}`;
    } else {
      const issueData = githubData.contextData as any;
      entityContext = `Issue #${context.entityNumber}: ${issueData.title}\n${issueData.body || ""}`;
    }

    // Create the AI prompt with base_branch_prompt in system prompt
    const systemPrompt = `You are a Git branch expert helping determine the appropriate base branch for a new feature branch.

${prompt}

Repository context:
- Repository: ${contextInfo.repository}
- Default branch: ${contextInfo.defaultBranch}
- Available branches: ${branches.join(", ")}

Your task is to analyze the issue/PR context and determine the most appropriate base branch. Consider factors like:
- Branch naming conventions
- Development workflow patterns
- Feature vs hotfix branches
- Release branches
- The content and purpose of the issue/PR

Respond with ONLY the branch name, nothing else.`;

    // Use the issue/PR context as the user prompt
    const userPrompt = `${contextInfo.entityType === "pull_request" ? "Pull Request" : "Issue"} #${contextInfo.entityNumber}:
${entityContext}

Based on the above ${contextInfo.entityType} details, which branch should be used as the base branch?`;

    // Make the AI call
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022", // Use a recent model
      max_tokens: 100,
      messages: [
        { role: "user", content: userPrompt }
      ],
      system: systemPrompt,
    });

    const branchName = response.content[0]?.type === "text" 
      ? response.content[0].text.trim() 
      : defaultBranch;

    // Validate that the suggested branch exists
    if (branches.includes(branchName)) {
      console.log(`AI determined base branch: ${branchName}`);
      return branchName;
    } else {
      console.log(`AI suggested branch "${branchName}" doesn't exist, falling back to default: ${defaultBranch}`);
      return defaultBranch;
    }

  } catch (error) {
    console.error("Error in AI branch determination:", error);
    console.log("Falling back to default branch");
    return await getDefaultBranch(octokits, context);
  }
}

async function getDefaultBranch(octokits: Octokits, context: ParsedGitHubContext): Promise<string> {
  const { owner, repo } = context.repository;
  const repoResponse = await octokits.rest.repos.get({
    owner,
    repo,
  });
  return repoResponse.data.default_branch;
}