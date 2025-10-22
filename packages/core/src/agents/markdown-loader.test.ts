/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseAgentMarkdown,
  loadAgentsFromDirectory,
} from './markdown-loader.js';

const SAMPLE_MARKDOWN = `# Agent: Code Cartographer

## Summary
Maps and interprets complex source trees to explain architecture and highlight change impacts.

## Persona
Direct, methodical, and relentlessly curious about hidden dependencies.

## Guidelines
- Always cite file paths when referencing code.
- Verify assumptions by opening source files instead of guessing.
- Prefer breadth-first exploration before deep dives.

## Inputs
\`\`\`json
[
  {
    "name": "objective",
    "type": "string",
    "required": true,
    "description": "Goal describing the investigation focus."
  },
  {
    "name": "hints",
    "type": "string[]",
    "required": false,
    "description": "Optional clues such as errors, stack traces, or suspected modules."
  }
]
\`\`\`

## Output
\`\`\`json
{
  "name": "report",
  "type": "json",
  "description": "Structured findings containing summary, affected files, and rationale.",
  "schema": {
    "type": "object",
    "properties": {
      "Summary": { "type": "string" },
      "AffectedAreas": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "File": { "type": "string" },
            "Reason": { "type": "string" }
          },
          "required": ["File", "Reason"]
        }
      }
    },
    "required": ["Summary", "AffectedAreas"]
  }
}
\`\`\`

## Tools
\`\`\`json
["read_file", "ls", "glob", "grep", "web_fetch"]
\`\`\`

## MCP
\`\`\`json
["github"]
\`\`\`

## Model
\`\`\`json
{
  "model": "gemini-2.5-pro-exp",
  "temperature": 0.1,
  "top_p": 0.8,
  "thinkingBudget": 180
}
\`\`\`

## Run Config
\`\`\`json
{
  "max_time_minutes": 7,
  "max_turns": 14
}
\`\`\`

## Query
Investigate the repository to explain how \${objective}. Include any details from \${hints} when prioritizing files.

## System Prompt
You are Code Cartographer, a senior codebase analyst. Maintain a neutral tone, cite evidence, and document trade-offs. Focus on building a holistic architecture map before suggesting changes.
`;

describe('markdown agent loader', () => {
  it('parses a well-formed agent specification', () => {
    const definition = parseAgentMarkdown(SAMPLE_MARKDOWN, 'test-agent');

    expect(definition.name).toBe('Code Cartographer');
    expect(definition.description).toContain(
      'Maps and interprets complex source trees',
    );
    expect(definition.promptConfig.systemPrompt).toContain('Code Cartographer');
    expect(definition.promptConfig.query).toContain('${objective}');
    expect(definition.modelConfig.model).toBe('gemini-2.5-pro-exp');
    expect(definition.runConfig.max_time_minutes).toBe(7);
    expect(definition.runConfig.max_turns).toBe(14);
    expect(definition.toolConfig?.tools).toEqual([
      'read_file',
      'ls',
      'glob',
      'grep',
      'web_fetch',
    ]);
    expect(definition.inputConfig.inputs['objective']).toMatchObject({
      type: 'string',
      required: true,
    });
    expect(definition.inputConfig.inputs['hints']).toMatchObject({
      type: 'string[]',
      required: false,
    });
  });

  describe('loadAgentsFromDirectory', () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = await fs.mkdtemp(path.join(tmpdir(), 'agent-md-'));
      await fs.writeFile(
        path.join(tempDir, 'code-cartographer.agent.md'),
        SAMPLE_MARKDOWN,
      );
      await fs.writeFile(path.join(tempDir, 'notes.txt'), 'not an agent spec');
    });

    afterAll(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('loads only .agent.md files as agents', async () => {
      const definitions = await loadAgentsFromDirectory(tempDir);
      expect(definitions).toHaveLength(1);
      expect(definitions[0].name).toBe('Code Cartographer');
    });
  });
});
