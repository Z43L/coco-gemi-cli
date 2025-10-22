/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, access, writeFile } from 'node:fs/promises';
import type { Content, GenerateContentConfig } from '@google/genai';
import {
  AuthType,
  DEFAULT_GEMINI_MODEL,
  getResponseText,
  parseAgentMarkdown,
  Storage,
} from '@google/gemini-cli-core';
import { loadSettings } from '../config/settings.js';
import { ExtensionEnablementManager } from '../config/extensions/extensionEnablement.js';
import { loadExtensions } from '../config/extension.js';
import { loadCliConfig, type CliArgs } from '../config/config.js';

const PROMPT_TEMPLATE = [
  'You are an expert AI agent architect. Your job is to translate the user\'s idea into a complete Markdown specification for a specialized subagent.',
  '',
  'Agent Name: {{AGENT_NAME}}',
  'Agent Concept: {{USER_IDEA}}',
  '',
  'Return ONLY valid Markdown that follows **exactly** the structure shown below. Do not add explanations, front matter, or trailing commentary. Fill in every section and replace every placeholder such as <...> with concrete content tailored to this agent. All JSON code blocks must contain strictly valid JSON with values that match the agent concept.',
  '',
  '# Agent: {{AGENT_NAME}}',
  '',
  '## Summary',
  '<2-4 sentence overview describing the agent\'s purpose and strengths.>',
  '',
  '## Persona',
  '<Describe the tone, style, and decision-making personality of the agent.>',
  '',
  '## Guidelines',
  '- <Concrete rule the agent must always follow>',
  '- <Another actionable rule>',
  '- <Add more bullets as needed>',
  '',
  '## Inputs',
  '```json',
  '[',
  '  {',
  '    "name": "objective",',
  '    "type": "string",',
  '    "required": true,',
  '    "description": "Concise but detailed statement of the user goal the agent should accomplish."',
  '  }',
  ']',
  '```',
  '- Include every input the agent needs. Allowed types: "string", "number", "boolean", "integer", "string[]", "number[]".',
  '',
  '## Output',
  '```json',
  '{',
  '  "name": "report",',
  '  "type": "json",',
  '  "description": "What the calling agent receives at completion.",',
  '  "schema": {',
  '    "type": "object",',
  '    "properties": {',
  '      "Summary": { "type": "string" },',
  '      "Insights": { "type": "array", "items": { "type": "string" } }',
  '    },',
  '    "required": ["Summary", "Insights"]',
  '  }',
  '}',
  '```',
  '- If the agent should return free-form text, set "type" to "text" and omit the schema field.',
  '',
  '## Tools',
  '```json',
  '["read_file", "ls", "glob", "grep", "web_fetch", "web_search", "write_file", "shell"]',
  '```',
  '- Provide only tool identifiers that exist in the Coco CLI. Remove or add tools as needed to fit the agent’s responsibilities.',
  '',
  '## MCP',
  '```json',
  '["github", "jira"]',
  '```',
  '- List MCP server identifiers the agent can rely on. Use an empty array ([]) if none are needed.',
  '',
  '## Model',
  '```json',
  '{',
  '  "model": "gemini-2.5-pro",',
  '  "temperature": 0.25,',
  '  "top_p": 0.9,',
  '  "thinkingBudget": 120',
  '}',
  '```',
  '- Adjust values to match the agent\'s needs. Leave numbers as plain JSON numbers.',
  '',
  '## Run Config',
  '```json',
  '{',
  '  "max_time_minutes": 6,',
  '  "max_turns": 12',
  '}',
  '```',
  '',
  '## Query',
  '<Write the kick-off user message template. Reference inputs using ${input_name} syntax.>',
  '',
  '## System Prompt',
  '<Authoritative instructions that combine the persona, guidelines, tooling expectations, and goal for the agent.>',
  '',
  'The response must be valid Markdown and every JSON block must be strictly valid JSON.',
].join('\n');

interface GenerateAgentArgs {
  name: string;
  prompt: string;
  directory?: string;
  overwrite?: boolean;
  global?: boolean;
}

export const generateAgentCommand: CommandModule<unknown, GenerateAgentArgs> = {
  command: 'generate-agent',
  describe:
    'Create a markdown-defined subagent by describing the specialization you need.',
  builder: (yargs) =>
    yargs
      .option('name', {
        alias: 'n',
        type: 'string',
        description: 'Display name for the new agent.',
        demandOption: true,
      })
      .option('prompt', {
        alias: 'p',
        type: 'string',
        description:
          'High level description of the agent’s responsibilities, tools, and tone.',
        demandOption: true,
      })
      .option('directory', {
        alias: 'd',
        type: 'string',
        description:
          'Directory to store the agent markdown file (defaults to ./agents).',
      })
      .option('overwrite', {
        alias: 'f',
        type: 'boolean',
        default: false,
        description: 'Overwrite the output file if it already exists.',
      })
      .option('global', {
        type: 'boolean',
        default: false,
        description:
          'Store the agent in the global configuration directory instead of the workspace.',
      }),
  handler: async (argv) => {
    try {
      await handleGenerateAgent(argv);
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to generate agent: ${message}`);
      process.exit(1);
    }
  },
};

async function handleGenerateAgent(args: GenerateAgentArgs): Promise<void> {
  const agentName = args.name.trim();
  const userPrompt = args.prompt.trim();

  if (!agentName) {
    throw new Error('Agent name cannot be empty.');
  }
  if (!userPrompt) {
    throw new Error('Prompt cannot be empty.');
  }

  const destinationDirectory = await resolveDestinationDirectory(args);
  const slug = slugify(agentName);
  const fileName = `${slug}.agent.md`;
  const outputPath = path.join(destinationDirectory, fileName);

  if (!args.overwrite && (await fileExists(outputPath))) {
    throw new Error(
      `Agent file already exists at ${outputPath}. Use --overwrite to replace it.`,
    );
  }

  const settings = loadSettings(process.cwd());
  const extensionEnablementManager = new ExtensionEnablementManager();
  const extensions = loadExtensions(extensionEnablementManager);

  const cliArgs: CliArgs = {
    query: undefined,
    model: undefined,
    sandbox: false,
    debug: false,
    prompt: undefined,
    promptInteractive: undefined,
    yolo: undefined,
    approvalMode: undefined,
    allowedMcpServerNames: undefined,
    allowedTools: undefined,
    experimentalAcp: undefined,
    extensions: undefined,
    listExtensions: undefined,
    includeDirectories: undefined,
    screenReader: undefined,
    useSmartEdit: undefined,
    useWriteTodos: undefined,
    outputFormat: undefined,
  };

  const config = await loadCliConfig(
    settings.merged,
    extensions,
    randomUUID(),
    cliArgs,
    process.cwd(),
  );

  await config.initialize();

  const selectedAuthType =
    (settings.merged.security?.auth?.selectedType as AuthType | undefined) ??
    AuthType.USE_GEMINI;

  await config.refreshAuth(selectedAuthType);

  const contentGeneratorConfig = config.getContentGeneratorConfig();
  if (!contentGeneratorConfig?.authType) {
    throw new Error(
      'Content generator is not initialized. Configure authentication (e.g., `coco auth login`) before generating agents.',
    );
  }

  const geminiClient = config.getGeminiClient();
  const abortController = new AbortController();
  const contents: Content[] = [
    {
      role: 'user',
      parts: [
        {
          text: buildPrompt(PROMPT_TEMPLATE, agentName, userPrompt),
        },
      ],
    },
  ];

  const generationConfig: GenerateContentConfig = {
    temperature: 0.25,
    topP: 0.9,
    maxOutputTokens: 8192,
  };

  const modelName = config.getModel();
  const model = modelName === 'auto' ? DEFAULT_GEMINI_MODEL : modelName;

  const response = await geminiClient.generateContent(
    contents,
    generationConfig,
    abortController.signal,
    model,
  );

  const rawMarkdown = getResponseText(response)?.trim();
  if (!rawMarkdown) {
    throw new Error('The language model did not return any content.');
  }

  // Validate the generated markdown parses into an agent definition.
  parseAgentMarkdown(rawMarkdown, 'generated agent');

  await mkdir(destinationDirectory, { recursive: true });
  await writeFile(outputPath, formatMarkdown(rawMarkdown), 'utf-8');

  console.log(`✨ Created agent "${agentName}" at ${outputPath}`);
  console.log(
    'Reload the CLI or run `/memory refresh` so the new agent is discovered.',
  );
}

function buildPrompt(template: string, name: string, idea: string): string {
  return template
    .replaceAll('{{AGENT_NAME}}', name)
    .replaceAll('{{USER_IDEA}}', idea);
}

async function resolveDestinationDirectory(
  args: GenerateAgentArgs,
): Promise<string> {
  if (args.global) {
    return Storage.getGlobalAgentsDir();
  }
  if (args.directory) {
    return path.resolve(process.cwd(), args.directory);
  }
  return path.resolve(process.cwd(), 'agents');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function slugify(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized.length > 0) {
    return normalized;
  }
  return `agent-${Date.now()}`;
}

function formatMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
}
