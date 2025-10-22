/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_THINKING_MODE,
} from '../config/models.js';
import { debugLogger } from '../utils/debugLogger.js';
import type { AgentDefinition, OutputConfig } from './types.js';

const SECTION_HEADING_REGEX = /^##\s+(.+?)\s*$/gm;
const AGENT_NAME_REGEX = /^#\s*Agent:\s*(.+)$/im;
const JSON_BLOCK_REGEX = /```json\s*([\s\S]*?)```/i;

const DEFAULT_MAX_TIME_MINUTES = 5;
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TOP_P = 0.9;

type NormalizedSections = Map<string, string>;

interface ParsedAgentConfig {
  name: string;
  summary?: string;
  persona?: string;
  role?: string;
  guidelines?: string[];
  inputs?: AgentInputSpec[];
  output?: AgentOutputSpec;
  tools?: string[];
  mcpServers?: string[];
  model?: AgentModelSpec;
  runConfig?: AgentRunConfigSpec;
  query?: string;
  systemPrompt?: string;
}

interface AgentInputSpec {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface AgentOutputSpec {
  name: string;
  type: 'text' | 'json';
  description: string;
  schema?: unknown;
}

interface AgentModelSpec {
  model?: string;
  temperature?: number;
  top_p?: number;
  thinkingBudget?: number;
}

interface AgentRunConfigSpec {
  max_time_minutes?: number;
  max_turns?: number;
}

const ALLOWED_INPUT_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'integer',
  'string[]',
  'number[]',
]);

/**
 * Loads all markdown-defined agents from a directory.
 * @param directory Directory containing agent markdown files.
 */
export async function loadAgentsFromDirectory(
  directory: string,
): Promise<AgentDefinition[]> {
  const definitions: AgentDefinition[] = [];
  try {
    const dirEntries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.toLowerCase().endsWith('.agent.md')) {
        continue;
      }

      const fullPath = path.join(directory, entry.name);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const definition = parseAgentMarkdown(content, fullPath);
        definitions.push(definition);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debugLogger.warn(
          `[AgentRegistry] Failed to load agent from ${fullPath}: ${message}`,
        );
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return [];
    }
    const message = error instanceof Error ? error.message : String(error);
    debugLogger.warn(
      `[AgentRegistry] Unable to read agents directory "${directory}": ${message}`,
    );
    return [];
  }

  return definitions;
}

/**
 * Parses markdown content defining an agent and returns an AgentDefinition.
 * @param markdown Markdown content describing the agent.
 * @param source Optional identifier for error messages.
 */
export function parseAgentMarkdown(
  markdown: string,
  source: string = 'agent markdown',
): AgentDefinition {
  const sections = extractSections(markdown);
  const name = extractAgentName(markdown, source);
  const config = buildConfigFromSections(name, sections, source);
  return buildAgentDefinition(config, source);
}

function extractAgentName(markdown: string, source: string): string {
  const match = markdown.match(AGENT_NAME_REGEX);
  if (!match) {
    throw new Error(`Missing "# Agent: <name>" header in ${source}.`);
  }
  const name = match[1].trim();
  if (!name) {
    throw new Error(`Agent name is empty in ${source}.`);
  }
  return name;
}

function extractSections(markdown: string): NormalizedSections {
  const sections: NormalizedSections = new Map();
  const matches = [...markdown.matchAll(SECTION_HEADING_REGEX)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const heading = match[1].trim().toLowerCase();
    const start = match.index! + match[0].length;
    const end =
      i + 1 < matches.length ? matches[i + 1].index! : markdown.length;

    const content = markdown.slice(start, end).trim();
    sections.set(heading, content);
  }
  return sections;
}

function buildConfigFromSections(
  name: string,
  sections: NormalizedSections,
  source: string,
): ParsedAgentConfig {
  const getText = (key: string): string | undefined => {
    const section = sections.get(key);
    if (!section) return undefined;
    return section.replace(/```[\s\S]*?```/g, '').trim() || undefined;
  };

  const parseJsonSection = <T>(key: string): T | undefined => {
    const section = sections.get(key);
    if (!section) return undefined;
    const match = section.match(JSON_BLOCK_REGEX);
    if (!match) {
      throw new Error(
        `Expected a JSON code block in "${key}" section of ${source}.`,
      );
    }
    try {
      return JSON.parse(match[1]) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid JSON in "${key}" section of ${source}: ${message}`,
      );
    }
  };

  const guidelines = extractGuidelines(sections.get('guidelines'));

  const inputs = parseInputs(parseJsonSection<AgentInputSpec[]>('inputs'));
  const output = parseOutput(parseJsonSection<AgentOutputSpec>('output'));
  const tools = parseStringArray(parseJsonSection<string[]>('tools'));
  const mcpServers = parseStringArray(parseJsonSection<string[]>('mcp'));
  const model = parseModel(parseJsonSection<AgentModelSpec>('model'));
  const runConfig = parseRunConfig(
    parseJsonSection<AgentRunConfigSpec>('run config'),
  );

  const config: ParsedAgentConfig = {
    name,
    summary: getText('summary') ?? getText('role'),
    persona: getText('persona'),
    role: getText('role'),
    guidelines,
    inputs,
    output,
    tools,
    mcpServers,
    model,
    runConfig,
    query: getText('query'),
    systemPrompt: getText('system prompt'),
  };

  return config;
}

function extractGuidelines(section?: string): string[] | undefined {
  if (!section) return undefined;
  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const bullets = lines
    .filter((line) => line.startsWith('-'))
    .map((line) => line.replace(/^-+\s*/, '').trim())
    .filter((line) => line.length > 0);

  if (bullets.length > 0) {
    return bullets;
  }
  if (lines.length > 0) {
    return [lines.join(' ')];
  }
  return undefined;
}

function parseInputs(inputs?: AgentInputSpec[]): AgentInputSpec[] | undefined {
  if (!inputs || inputs.length === 0) {
    return undefined;
  }
  const sanitized = inputs
    .map((input) => ({
      name: input.name?.trim(),
      type: input.type?.trim()?.toLowerCase(),
      required: input.required ?? true,
      description: input.description?.trim() ?? '',
    }))
    .filter((input) => !!input.name && !!input.type);

  const valid = sanitized.filter((input) =>
    ALLOWED_INPUT_TYPES.has(input.type as string),
  );

  if (valid.length === 0) {
    return undefined;
  }
  return valid as AgentInputSpec[];
}

function parseOutput(output?: AgentOutputSpec): AgentOutputSpec | undefined {
  if (!output) return undefined;
  const name = output.name?.trim() || 'result';
  const type =
    output.type?.toLowerCase() === 'json'
      ? ('json' as const)
      : ('text' as const);
  const description = output.description?.trim() || '';
  return {
    name,
    type,
    description,
    schema: output.schema,
  };
}

function parseStringArray(values?: string[]): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const sanitized = values
    .map((value) => value?.toString().trim())
    .filter((value) => !!value);
  if (sanitized.length === 0) return undefined;
  return Array.from(new Set(sanitized));
}

function parseModel(model?: AgentModelSpec): AgentModelSpec | undefined {
  if (!model) return undefined;
  const parsed: AgentModelSpec = {
    model: model.model?.trim(),
  };
  if (typeof model.temperature === 'number') {
    parsed.temperature = model.temperature;
  }
  if (typeof model.top_p === 'number') {
    parsed.top_p = model.top_p;
  }
  if (typeof model.thinkingBudget === 'number') {
    parsed.thinkingBudget = model.thinkingBudget;
  }
  return parsed;
}

function parseRunConfig(
  run?: AgentRunConfigSpec,
): AgentRunConfigSpec | undefined {
  if (!run) return undefined;
  const parsed: AgentRunConfigSpec = {};
  if (typeof run.max_time_minutes === 'number') {
    parsed.max_time_minutes = run.max_time_minutes;
  }
  if (typeof run.max_turns === 'number') {
    parsed.max_turns = run.max_turns;
  }
  return parsed;
}

function buildAgentDefinition(
  config: ParsedAgentConfig,
  source: string,
): AgentDefinition {
  const inputs = buildInputConfig(config.inputs);
  const expectsJsonOutput = config.output?.type === 'json';
  const outputConfig = buildOutputConfig(config.output);
  type OutputSchema =
    typeof outputConfig extends OutputConfig<infer S> ? S : z.ZodUnknown;
  const modelConfig = buildModelConfig(config.model);
  const runConfig = buildRunConfig(config.runConfig);
  const toolConfig = buildToolConfig(config.tools);

  const systemPrompt = buildSystemPrompt(config);
  const finalPrompt = appendToolingContext(
    systemPrompt,
    config.tools,
    config.mcpServers,
  );

  const definition: AgentDefinition<OutputSchema> = {
    name: config.name,
    displayName: config.name,
    description:
      config.summary || config.role || `Custom agent defined in ${source}`,
    promptConfig: {
      systemPrompt: finalPrompt,
      query:
        config.query ??
        'Use the provided inputs to accomplish the requested task with precision.',
    },
    modelConfig,
    runConfig,
    toolConfig,
    outputConfig: outputConfig as OutputConfig<OutputSchema> | undefined,
    inputConfig: inputs,
    processOutput: expectsJsonOutput
      ? (value: z.infer<OutputSchema>) => JSON.stringify(value, null, 2)
      : undefined,
  };

  return definition;
}

function buildInputConfig(
  inputs?: AgentInputSpec[],
): AgentDefinition['inputConfig'] {
  const effectiveInputs =
    inputs && inputs.length > 0
      ? inputs
      : [
          {
            name: 'objective',
            type: 'string',
            required: true,
            description: 'Detailed description of the task to accomplish.',
          },
        ];

  const inputConfig = Object.fromEntries(
    effectiveInputs.map((input) => [
      input.name,
      {
        description: input.description,
        type: mapInputType(input.type),
        required: input.required,
      },
    ]),
  );

  return { inputs: inputConfig };
}

function mapInputType(
  type: string,
): AgentDefinition['inputConfig']['inputs'][string]['type'] {
  switch (type) {
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'string[]':
      return 'string[]';
    case 'number[]':
      return 'number[]';
    default:
      return 'string';
  }
}

function buildOutputConfig(
  output?: AgentOutputSpec,
): OutputConfig<z.ZodTypeAny> | undefined {
  if (!output) {
    return {
      outputName: 'result',
      description: 'Final answer generated by the agent.',
      schema: z.string(),
    };
  }

  const schema =
    output.type === 'json' ? buildZodSchema(output.schema) : z.string();

  return {
    outputName: output.name,
    description:
      output.description ||
      (output.type === 'json'
        ? 'Structured JSON output generated by the agent.'
        : 'Textual result generated by the agent.'),
    schema,
  };
}

function buildModelConfig(
  model?: AgentModelSpec,
): AgentDefinition['modelConfig'] {
  return {
    model: model?.model || DEFAULT_GEMINI_MODEL,
    temp: model?.temperature ?? DEFAULT_TEMPERATURE,
    top_p: model?.top_p ?? DEFAULT_TOP_P,
    thinkingBudget: model?.thinkingBudget ?? DEFAULT_THINKING_MODE,
  };
}

function buildRunConfig(
  runConfig?: AgentRunConfigSpec,
): AgentDefinition['runConfig'] {
  const maxTime =
    typeof runConfig?.max_time_minutes === 'number' &&
    Number.isFinite(runConfig.max_time_minutes) &&
    runConfig.max_time_minutes > 0
      ? runConfig.max_time_minutes
      : DEFAULT_MAX_TIME_MINUTES;

  const maxTurns =
    typeof runConfig?.max_turns === 'number' &&
    Number.isFinite(runConfig.max_turns) &&
    runConfig.max_turns > 0
      ? runConfig.max_turns
      : DEFAULT_MAX_TURNS;

  return {
    max_time_minutes: maxTime,
    max_turns: maxTurns,
  };
}

function buildToolConfig(
  tools?: string[],
): AgentDefinition['toolConfig'] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return {
    tools,
  };
}

function buildSystemPrompt(config: ParsedAgentConfig): string {
  if (config.systemPrompt) {
    return config.systemPrompt.trim();
  }

  const segments: string[] = [];
  if (config.role || config.summary) {
    segments.push(
      `You are **${config.name}**, ${config.role ?? config.summary}.`,
    );
  } else {
    segments.push(`You are **${config.name}**, a specialized assistant.`);
  }

  if (config.persona) {
    segments.push(`Persona:\n${config.persona}`);
  }

  if (config.guidelines && config.guidelines.length > 0) {
    const list = config.guidelines.map((line) => `- ${line}`).join('\n');
    segments.push(`Follow these guidelines:\n${list}`);
  }

  segments.push(
    'Think step-by-step, justify your reasoning, and provide actionable, concrete outputs.',
  );

  return segments.join('\n\n').trim();
}

function appendToolingContext(
  prompt: string,
  tools?: string[],
  mcpServers?: string[],
): string {
  const additions: string[] = [];
  if (tools && tools.length > 0) {
    additions.push(
      `You can invoke the following tools when needed: ${tools.join(', ')}.`,
    );
  }
  if (mcpServers && mcpServers.length > 0) {
    additions.push(
      `You have access to these MCP servers: ${mcpServers.join(
        ', ',
      )}. Use them when they can provide better context or direct actions.`,
    );
  }

  if (additions.length === 0) {
    return prompt;
  }

  return `${prompt}\n\n${additions.join('\n')}`.trim();
}

function buildZodSchema(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.any();
  }
  try {
    return jsonSchemaToZod(schema as Record<string, unknown>);
  } catch (_error) {
    return z.any();
  }
}

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const type = typeof schema['type'] === 'string' ? schema['type'] : undefined;
  switch (type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'array': {
      const items = schema['items'];
      if (typeof items === 'object' && items !== null) {
        return z.array(jsonSchemaToZod(items as Record<string, unknown>));
      }
      return z.array(z.any());
    }
    case 'object': {
      const properties = schema['properties'];
      const required = new Set(
        Array.isArray(schema['required'])
          ? (schema['required'] as string[])
          : [],
      );

      if (typeof properties !== 'object' || properties === null) {
        return z.record(z.any());
      }

      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, value] of Object.entries(
        properties as Record<string, unknown>,
      )) {
        const propertySchema =
          typeof value === 'object' && value !== null
            ? jsonSchemaToZod(value as Record<string, unknown>)
            : z.any();
        shape[key] = required.has(key)
          ? propertySchema
          : propertySchema.optional();
      }
      return z.object(shape).passthrough();
    }
    default:
      return z.any();
  }
}
