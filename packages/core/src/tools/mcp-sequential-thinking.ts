/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DiscoveredMCPTool } from './mcp-tool.js';
import {
  type CallableTool,
  type FunctionCall,
  type Part,
  type Content,
  type Tool,
  Type,
} from '@google/genai';
import { GeminiChat, StreamEventType } from '../core/geminiChat.js';
import { Config } from '../config/config.js';
import { promptIdContext } from '../utils/promptIdContext.js';

const SEQUENTIAL_THINKING_TOOL_NAME = 'sequential_thinking';

/**
 * A tool for structured, step-by-step reasoning and planning.
 * When called, it uses the LLM to generate a plan based on the user's request.
 */
const callableTool: CallableTool = {
  tool: (): Promise<Tool> =>
    Promise.resolve({
      functionDeclarations: [
        {
          name: SEQUENTIAL_THINKING_TOOL_NAME,
          description:
            "Generates a step-by-step plan to address a user's request, encouraging the use of the context7 tool for documentation.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: {
                type: Type.STRING,
                description: "The user's request or problem to be solved.",
              },
            },
            required: ['query'],
          },
        },
      ],
    }),

  async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
    if (!functionCalls || functionCalls.length === 0) {
      return [{ text: 'Error: No function call provided for sequential_thinking tool.' }];
    }
    const args = functionCalls[0].args;
    if (!args) {
      return [{ text: 'Error: No arguments provided for sequential_thinking tool.' }];
    }
    const query = args['query'] as string;
    if (!query) {
      return [{ text: 'Error: Missing query for sequential_thinking tool.' }];
    }

    // Access the current runtime context and chat object.
    // This assumes that the tool is called within an AgentExecutor context
    // where a chat object and config are available.
    // This is a simplified approach; in a more robust system, these might be
    // passed explicitly or retrieved from a global context.
    const currentConfig = (this as any).config as Config; // Assuming 'this' context provides config
    const currentChat = (this as any).chat as GeminiChat; // Assuming 'this' context provides chat

    if (!currentConfig || !currentChat) {
      return [
        {
          text: 'Error: Sequential thinking tool requires a valid runtime configuration and chat object.',
        },
      ];
    }

    const planningPrompt = `
You are a planning expert. Your task is to take a user's request and break it down into a clear, step-by-step plan.

**User Request:** "${query}"

**Instructions:**
1.  Analyze the request and create a sequential plan to accomplish it.
2.  The final step of the plan should always be to call the 'complete_task' tool.
3.  For any steps that require understanding code, libraries, or documentation, you MUST use the 'context7' tool. The 'context7' tool can search for documentation programmatically.
4.  Output the plan as a numbered list.

Example Plan:
1. Use 'context7' to find the documentation for the 'AgentExecutor' class.
2. Read the 'run' method to understand the execution loop.
3. Propose a code modification to insert a planning step.
4. Call 'complete_task' with the final summary.
`;

    const planningMessage: Content = {
      role: 'user',
      parts: [{ text: planningPrompt }],
    };

    // Call the LLM to generate the plan.
    // We pass an empty tools array here because the planning model should not
    // call other tools during its planning phase; it should only generate text.
    const promptId = promptIdContext.getStore() || 'sequential-thinking-plan';
    const responseStream = await currentChat.sendMessageStream(
      currentConfig.getModel(), // Use the agent's configured model
      { message: planningMessage.parts || [] },
      `${promptId}-plan`,
    );

    let textResponse = '';
    for await (const resp of responseStream) {
      if (resp.type === StreamEventType.CHUNK) {
        const chunk = resp.value;
        const text =
          chunk.candidates?.[0]?.content?.parts
            ?.filter((p: Part) => p.text)
            .map((p: Part) => p.text)
            .join('') || '';
        if (text) {
          textResponse += text;
        }
      }
    }

    return [{ text: `Okay, I have a plan:\n${textResponse}` }];
  },
};

export const sequentialThinkingTool = new DiscoveredMCPTool(
  callableTool,
  SEQUENTIAL_THINKING_TOOL_NAME,
  SEQUENTIAL_THINKING_TOOL_NAME,
  'A tool for structured, step-by-step reasoning and planning.',
  z.object({
    query: z.string().describe("The user's request or problem to be solved."),
  }),
  true, // isTrusted
);
