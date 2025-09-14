# Upgrade Guide: Pinfire Fork to New Minimal Fork

This document explains how to migrate from the original Pinfire fork (with 16+ individual inputs) to this new minimal fork that adds only essential PR workflow features to the upstream Claude Code Action v1.0.

## 🎯 What This Migration Accomplishes

**From**: Complex fork with 16+ custom inputs diverging significantly from upstream
**To**: Minimal fork with only 2 new features, fully aligned with upstream v1.0 architecture

## 🚨 Breaking Changes: Individual Inputs → `claude_args`

The biggest change is migrating from individual configuration inputs to the modern consolidated `claude_args` format used by upstream.

### Input Migration Table

| Old Pinfire Input                   | New Format                                    | Example                |
| ----------------------------------- | --------------------------------------------- | ---------------------- |
| `allowed_tools: "Read,Write"`       | `claude_args: "--allowedTools Read,Write"`    | ✅ Direct conversion   |
| `disallowed_tools: "WebSearch"`     | `claude_args: "--disallowedTools WebSearch"`  | ✅ Direct conversion   |
| `custom_instructions: "Be helpful"` | `claude_args: "--system-prompt 'Be helpful'"` | ⚠️ Option name changed |
| `max_turns: "10"`                   | `claude_args: "--max-turns 10"`               | ✅ Direct conversion   |
| `model: "claude-3-5-sonnet"`        | `claude_args: "--model claude-3-5-sonnet"`    | ✅ Direct conversion   |
| `anthropic_model: "..."`            | `claude_args: "--model ..."`                  | ✅ Use `model` instead |
| `fallback_model: "..."`             | `claude_args: "--fallback-model ..."`         | ✅ Direct conversion   |
| `timeout_minutes: "30"`             | Use job-level `timeout-minutes: 30`           | ⚠️ Move to job level   |
| `direct_prompt: "Do this"`          | `prompt: "Do this"`                           | ✅ Renamed input       |
| `override_prompt: "..."`            | `prompt: "..."`                               | ✅ Use `prompt`        |
| `claude_env: "NODE_ENV=test"`       | `settings: '{"env": {"NODE_ENV": "test"}}'`   | ⚠️ JSON format         |
| `mcp_config: '{...}'`               | `claude_args: "--mcp-config '{...}'"`         | ✅ Direct conversion   |
| `mode: "agent"`                     | Auto-detected (remove input)                  | ✅ No longer needed    |
| `create_pull_request: "true"`       | Use GitHub MCP tools in `claude_args`         | ⚠️ See below           |
| `use_timestamp_suffix: "false"`     | Removed (always enabled now)                  | ❌ Feature removed     |
| `base_branch_prompt: "..."`         | Use `pr_number` instead                       | ❌ Feature replaced    |

## 🆕 New Features (Only 2 Added)

### 1. **`pr_number`** - Work Within Existing Pull Requests

```yaml
# NEW: Route comments to specific PR and work within its branch
- uses: your-org/claude-code-action@new-branch
  with:
    pr_number: 123
    prompt: "Review this PR for security issues"
    claude_args: "--allowedTools Read,Grep"
```

**What it does:**

- Routes Claude's comments to the specified PR
- Checks out the PR's branch for code changes
- Skips creating "Create PR" links (since already in a PR)

### 2. **`branch_checked_out`** - Use Pre-Checked-Out Code

```yaml
jobs:
  analyze:
    steps:
      # You handle the checkout with custom options
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          submodules: recursive

      # Claude uses your checkout
      - uses: your-org/claude-code-action@new-branch
        with:
          branch_checked_out: true
          prompt: "Analyze this codebase"
          claude_args: "--allowedTools Read,Bash"
```

**What it does:**

- Skips all git checkout operations
- Uses whatever code is currently in the workspace
- Enables custom checkout workflows

## 📝 Complete Migration Examples

### Basic Interactive Usage

**Before (Pinfire):**

```yaml
- uses: your-org/claude-code-action@pinfire
  with:
    mode: "tag"
    custom_instructions: "Follow our coding standards"
    allowed_tools: |
      Read
      Write
      Edit
      Bash
    max_turns: "10"
    model: "claude-3-5-sonnet-20241022"
```

**After (New):**

```yaml
- uses: your-org/claude-code-action@new-branch
  with:
    claude_args: |
      --system-prompt "Follow our coding standards"
      --allowedTools Read,Write,Edit,Bash
      --max-turns 10
      --model claude-3-5-sonnet-20241022
```

### Automation Workflow

**Before (Pinfire):**

```yaml
- uses: your-org/claude-code-action@pinfire
  with:
    mode: "agent"
    direct_prompt: "Review this PR for security issues"
    allowed_tools: "Read,Grep"
    custom_instructions: "Focus on SQL injection and XSS"
```

**After (New):**

```yaml
- uses: your-org/claude-code-action@new-branch
  with:
    prompt: |
      REPO: ${{ github.repository }}
      PR NUMBER: ${{ github.event.pull_request.number }}

      Review this PR for security issues
    claude_args: |
      --allowedTools Read,Grep
      --system-prompt "Focus on SQL injection and XSS"
```

### NEW: Working Within Existing PR

**Pinfire couldn't do this - NEW capability:**

```yaml
on:
  issue_comment:
    types: [created]

jobs:
  review-pr:
    if: contains(github.event.comment.body, 'review PR #')
    steps:
      - id: extract-pr
        run: |
          PR_NUM=$(echo "${{ github.event.comment.body }}" | grep -o 'PR #[0-9]\+' | grep -o '[0-9]\+')
          echo "pr_number=$PR_NUM" >> $GITHUB_OUTPUT

      - uses: your-org/claude-code-action@new-branch
        with:
          pr_number: ${{ steps.extract-pr.outputs.pr_number }}
          prompt: "Review this PR for the changes requested in the comment"
          claude_args: "--allowedTools Read,Grep,Write"
```

### NEW: Custom Checkout Workflow

**Pinfire couldn't do this - NEW capability:**

```yaml
jobs:
  analyze:
    steps:
      # Custom checkout with specific options
      - uses: actions/checkout@v4
        with:
          ref: develop
          fetch-depth: 100
          lfs: true
          submodules: recursive

      # Custom setup
      - run: npm install
      - run: npm run build

      # Claude uses your prepared environment
      - uses: your-org/claude-code-action@new-branch
        with:
          branch_checked_out: true
          prompt: "Analyze the built output and suggest optimizations"
```

### Environment Variables

**Before (Pinfire):**

```yaml
- uses: your-org/claude-code-action@pinfire
  with:
    claude_env: |
      NODE_ENV: production
      DEBUG: true
```

**After (New):**

```yaml
- uses: your-org/claude-code-action@new-branch
  with:
    settings: |
      {
        "env": {
          "NODE_ENV": "production",
          "DEBUG": "true"
        }
      }
```

### MCP Configuration

**Before (Pinfire):**

```yaml
- uses: your-org/claude-code-action@pinfire
  with:
    mcp_config: |
      {
        "mcpServers": {
          "filesystem": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
          }
        }
      }
```

**After (New):**

```yaml
- uses: your-org/claude-code-action@new-branch
  with:
    claude_args: |
      --mcp-config '{"mcpServers":{"filesystem":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/path"]}}}'
```

### Timeout Configuration

**Before (Pinfire):**

```yaml
- uses: your-org/claude-code-action@pinfire
  with:
    timeout_minutes: 45
```

**After (New):**

```yaml
jobs:
  claude-task:
    timeout-minutes: 45 # Moved to job level
    steps:
      - uses: your-org/claude-code-action@new-branch
```

## ⚡ Features You Gain (From Upstream v1.0)

### 1. **Modern `claude_args` Format**

- Direct access to all Claude Code CLI features
- Future-proof as CLI evolves
- Better documentation alignment

### 2. **Automatic Mode Detection**

- No more manual `mode` configuration
- Smarter behavior based on context

### 3. **Security Improvements**

```yaml
# NEW: Allow non-write users (use carefully!)
allowed_non_write_users: "trusted-user1,trusted-user2"
```

### 4. **Progress Tracking**

```yaml
# NEW: Force tracking comments in automation mode
track_progress: true
prompt: "Review this PR"
```

### 5. **Custom Executables**

```yaml
# NEW: Use custom Claude Code or Bun versions
path_to_claude_code_executable: "/custom/path/claude-code"
path_to_bun_executable: "/custom/path/bun"
```

### 6. **Better Bot Configuration**

```yaml
# NEW: Customize bot identity
bot_id: "your-bot-id"
bot_name: "your-bot-name"
```

## ❌ Features Removed

### 1. **`use_timestamp_suffix`**

- **Reason**: Timestamp suffixes are now always used for better branch naming
- **Migration**: Remove the input, behavior is now standard

### 2. **`base_branch_prompt`**

- **Reason**: Replaced by more powerful `pr_number` workflow
- **Migration**: Use `pr_number` to work within existing PRs instead

### 3. **`create_pull_request`**

- **Reason**: GitHub MCP tools provide more flexible PR operations
- **Migration**: Use `claude_args` with GitHub MCP tools:

```yaml
claude_args: |
  --allowedTools mcp__github__create_pull_request,mcp__github__push_files
```

## 🔧 Step-by-Step Migration Checklist

### Phase 1: Update Action Reference

- [ ] Change `uses:` from `@pinfire` to `@new-branch`

### Phase 2: Input Migration

- [ ] Remove `mode` input (auto-detected now)
- [ ] Replace `direct_prompt` with `prompt`
- [ ] Replace `override_prompt` with `prompt`
- [ ] Move all tool/model configs to `claude_args`
- [ ] Convert `claude_env` to `settings` JSON format
- [ ] Move `timeout_minutes` to job-level `timeout-minutes`
- [ ] Remove `use_timestamp_suffix` (always enabled)
- [ ] Remove `base_branch_prompt` (use `pr_number` instead)

### Phase 3: Use New Features (Optional)

- [ ] Add `pr_number` for PR-specific workflows
- [ ] Add `branch_checked_out` for custom checkout needs
- [ ] Consider `track_progress: true` for automation visibility
- [ ] Use `allowed_non_write_users` if needed (security risk)

### Phase 4: Test & Validate

- [ ] Test basic @claude mentions still work
- [ ] Test automation workflows with `prompt`
- [ ] Verify `claude_args` configuration works
- [ ] Test new `pr_number` feature if using it

## 📚 Additional Resources

1. **Upstream Migration Guide**: See [docs/migration-guide.md](docs/migration-guide.md) for comprehensive `claude_args` documentation
2. **GitHub MCP Tools**: For advanced PR/issue operations
3. **Claude Code CLI Docs**: For all available `claude_args` options

## 🆘 Common Migration Issues

### Issue: "Tool not found" errors

```yaml
# ❌ Old way
allowed_tools: "CustomTool"

# ✅ New way
claude_args: "--allowedTools CustomTool"
```

### Issue: Complex MCP config breaks

```yaml
# ❌ Problematic
claude_args: --mcp-config {"complex": "json"}

# ✅ Properly escaped
claude_args: '--mcp-config "{\"complex\": \"json\"}"'
```

### Issue: Environment variables not working

```yaml
# ❌ Old way
claude_env: "VAR=value"

# ✅ New way
settings: '{"env": {"VAR": "value"}}'
```

## ✨ Why This Migration Is Worth It

1. **Alignment**: Stay synchronized with upstream improvements
2. **Simplicity**: 2 new features vs 16 divergent inputs
3. **Future-proof**: Easy to merge upstream changes
4. **Powerful**: New PR workflows enable advanced automation
5. **Maintainable**: Minimal fork = minimal maintenance burden

The new branch gives you everything the Pinfire fork had, plus new capabilities, with much less complexity and better long-term sustainability.
