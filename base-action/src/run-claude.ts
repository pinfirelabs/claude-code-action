import * as core from "@actions/core";
import { exec } from "child_process";
import { promisify } from "util";
import { unlink, writeFile, stat } from "fs/promises";
import { createWriteStream } from "fs";
import { spawn } from "child_process";
import { parse as parseShellArgs } from "shell-quote";

const execAsync = promisify(exec);

const PIPE_PATH = `${process.env.RUNNER_TEMP}/claude_prompt_pipe`;
const EXECUTION_FILE = `${process.env.RUNNER_TEMP}/claude-execution-output.json`;
const BASE_ARGS = ["--verbose", "--output-format", "stream-json"];

export type ClaudeOptions = {
  claudeArgs?: string;
  model?: string;
  pathToClaudeCodeExecutable?: string;
  allowedTools?: string;
  disallowedTools?: string;
  maxTurns?: string;
  mcpConfig?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  claudeEnv?: string;
  fallbackModel?: string;
};

type PreparedConfig = {
  claudeArgs: string[];
  promptPath: string;
  env: Record<string, string>;
};

export function prepareRunConfig(
  promptPath: string,
  options: ClaudeOptions,
): PreparedConfig {
  // Build Claude CLI arguments:
  // 1. Prompt flag (always first)
  // 2. User's claudeArgs (full control)
  // 3. BASE_ARGS (always last, cannot be overridden)

  const claudeArgs = ["-p"];

  // Parse and add user's custom Claude arguments
  if (options.claudeArgs?.trim()) {
    const parsed = parseShellArgs(options.claudeArgs);
    const customArgs = parsed.filter(
      (arg): arg is string => typeof arg === "string",
    );
    claudeArgs.push(...customArgs);
  }

  // BASE_ARGS are always appended last (cannot be overridden)
  claudeArgs.push(...BASE_ARGS);

  const customEnv: Record<string, string> = {};

  if (process.env.INPUT_ACTION_INPUTS_PRESENT) {
    customEnv.GITHUB_ACTION_INPUTS = process.env.INPUT_ACTION_INPUTS_PRESENT;
  }

  return {
    claudeArgs,
    promptPath,
    env: customEnv,
  };
}

export async function runClaude(promptPath: string, options: ClaudeOptions) {
  const config = prepareRunConfig(promptPath, options);

  // Create a named pipe
  try {
    await unlink(PIPE_PATH);
  } catch (e) {
    // Ignore if file doesn't exist
  }

  // Create the named pipe
  await execAsync(`mkfifo "${PIPE_PATH}"`);

  // Log prompt file size
  let promptSize = "unknown";
  try {
    const stats = await stat(config.promptPath);
    promptSize = stats.size.toString();
  } catch (e) {
    // Ignore error
  }

  console.log(`Prompt file size: ${promptSize} bytes`);

  // Log custom environment variables if any
  const customEnvKeys = Object.keys(config.env).filter(
    (key) => key !== "CLAUDE_ACTION_INPUTS_PRESENT",
  );
  if (customEnvKeys.length > 0) {
    console.log(`Custom environment variables: ${customEnvKeys.join(", ")}`);
  }

  // Log custom arguments if any
  if (options.claudeArgs && options.claudeArgs.trim() !== "") {
    console.log(`Custom Claude arguments: ${options.claudeArgs}`);
  }

  // Output to console
  console.log(`Running Claude with prompt from file: ${config.promptPath}`);
  console.log(`Full command: claude ${config.claudeArgs.join(" ")}`);

  // Start sending prompt to pipe in background
  const catProcess = spawn("cat", [config.promptPath], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const pipeStream = createWriteStream(PIPE_PATH);
  catProcess.stdout.pipe(pipeStream);

  catProcess.on("error", (error) => {
    console.error("Error reading prompt file:", error);
    pipeStream.destroy();
  });

  // Use custom executable path if provided, otherwise default to "claude"
  const claudeExecutable = options.pathToClaudeCodeExecutable || "claude";

  const claudeProcess = spawn(claudeExecutable, config.claudeArgs, {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      ...config.env,
    },
  });

  // Handle Claude process errors
  claudeProcess.on("error", (error) => {
    console.error("Error spawning Claude process:", error);
    pipeStream.destroy();
  });

  // Create a write stream for the raw JSON output file
  const outputStream = createWriteStream(EXECUTION_FILE + ".stream");

  // Spawn claude-stream-parser for live output formatting
  let parserProcess: ReturnType<typeof spawn> | null = null;
  try {
    parserProcess = spawn("claude-stream-parser", [], {
      stdio: ["pipe", "inherit", "inherit"],
    });

    parserProcess.on("error", (error) => {
      console.error(
        "Warning: claude-stream-parser not available, falling back to raw output:",
        error.message,
      );
      parserProcess = null;
    });
  } catch (e) {
    console.log("claude-stream-parser not available, showing raw JSON output");
  }

  // Capture output for parsing execution metrics
  let output = "";
  claudeProcess.stdout.on("data", (data) => {
    const text = data.toString();

    // Always save raw output to file
    outputStream.write(data);
    output += text;

    // Send to parser or fallback to raw output
    if (parserProcess && !parserProcess.killed && parserProcess.stdin) {
      parserProcess.stdin.write(data);
    } else {
      // Fallback: Try to parse as JSON and pretty print if it's on a single line
      const lines = text.split("\n");
      lines.forEach((line: string, index: number) => {
        if (line.trim() === "") return;

        try {
          // Check if this line is a JSON object
          const parsed = JSON.parse(line);
          const prettyJson = JSON.stringify(parsed, null, 2);
          process.stdout.write(prettyJson);
          if (index < lines.length - 1 || text.endsWith("\n")) {
            process.stdout.write("\n");
          }
        } catch (e) {
          // Not a JSON object, print as is
          process.stdout.write(line);
          if (index < lines.length - 1 || text.endsWith("\n")) {
            process.stdout.write("\n");
          }
        }
      });
    }
  });

  // Handle stdout errors
  claudeProcess.stdout.on("error", (error) => {
    console.error("Error reading Claude stdout:", error);
  });

  // Pipe from named pipe to Claude
  const pipeProcess = spawn("cat", [PIPE_PATH]);
  pipeProcess.stdout.pipe(claudeProcess.stdin);

  // Handle pipe process errors
  pipeProcess.on("error", (error) => {
    console.error("Error reading from named pipe:", error);
    claudeProcess.kill("SIGTERM");
  });

  // Wait for Claude to finish
  const exitCode = await new Promise<number>((resolve) => {
    claudeProcess.on("close", (code) => {
      resolve(code || 0);
    });

    claudeProcess.on("error", (error) => {
      console.error("Claude process error:", error);
      resolve(1);
    });
  });

  // Clean up processes
  try {
    catProcess.kill("SIGTERM");
  } catch (e) {
    // Process may already be dead
  }
  try {
    pipeProcess.kill("SIGTERM");
  } catch (e) {
    // Process may already be dead
  }

  // Close parser process if running
  if (parserProcess && !parserProcess.killed) {
    try {
      parserProcess.stdin?.end();
    } catch {}
    try {
      parserProcess.kill("SIGTERM");
    } catch {}
  }

  // Close the output stream
  outputStream.end();

  // Clean up pipe file
  try {
    await unlink(PIPE_PATH);
  } catch (e) {
    // Ignore errors during cleanup
  }

  // Log exit code for debugging
  console.log(`Claude process exited with code: ${exitCode}`);

  // Set conclusion based on exit code
  if (exitCode === 0) {
    // Try to process the output and save execution metrics
    try {
      // Wait a moment for stream to finish writing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Process the stream file into proper JSON array
      const { stdout: jsonOutput } = await execAsync(
        `jq -s '.' "${EXECUTION_FILE}.stream"`,
        {
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      await writeFile(EXECUTION_FILE, jsonOutput);

      // Clean up the stream file
      try {
        await unlink(EXECUTION_FILE + ".stream");
      } catch (e) {
        // Ignore cleanup errors
      }

      console.log(`Log saved to ${EXECUTION_FILE}`);
    } catch (e) {
      console.error(`Failed to process output for execution metrics: ${e}`);
      core.setOutput("conclusion", "failure");

      // Try fallback: rename stream file if jq processing failed
      try {
        await execAsync(`mv "${EXECUTION_FILE}.stream" "${EXECUTION_FILE}"`);
        core.setOutput("execution_file", EXECUTION_FILE);
        console.log("Using raw stream file as fallback");
      } catch (e2) {
        console.error("Even fallback processing failed:", e2);
      }

      // Exit with failure since we couldn't process the output properly
      process.exit(1);
    }

    core.setOutput("conclusion", "success");
    core.setOutput("execution_file", EXECUTION_FILE);
  } else {
    core.setOutput("conclusion", "failure");

    // Still try to save execution file if we have output
    if (output) {
      try {
        // Wait a moment for stream to finish writing
        await new Promise((resolve) => setTimeout(resolve, 100));

        const { stdout: jsonOutput } = await execAsync(
          `jq -s '.' "${EXECUTION_FILE}.stream"`,
          {
            maxBuffer: 10 * 1024 * 1024,
          },
        );
        await writeFile(EXECUTION_FILE, jsonOutput);

        // Clean up the stream file
        try {
          await unlink(EXECUTION_FILE + ".stream");
        } catch (e) {
          // Ignore cleanup errors
        }

        core.setOutput("execution_file", EXECUTION_FILE);
      } catch (e) {
        // Try fallback
        try {
          await execAsync(`mv "${EXECUTION_FILE}.stream" "${EXECUTION_FILE}"`);
          core.setOutput("execution_file", EXECUTION_FILE);
        } catch (e2) {
          // Even fallback failed
        }
      }
    }

    process.exit(exitCode);
  }
}
