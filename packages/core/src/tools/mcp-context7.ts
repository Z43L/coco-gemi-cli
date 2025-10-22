/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DiscoveredMCPTool } from './mcp-tool.js';
import type { CallableTool } from '@google/genai';
import { request } from 'undici';

const CONTEXT7_API_KEY = 'ctx7sk-67453aab-2859-4e7a-bcdb-f067d6d566bd';

const callableTool: CallableTool = {
	tool: {} as any,
	async callTool(functionCalls) {
		const call = functionCalls[0];
		if (call.name !== 'search') {
			throw new Error(`Unknown tool call: ${call.name}`);
		}

		const query = (call.args as { query: string }).query;
		const { body } = await request(`https://context7.com/api/v1/search?query=${query}`, {
			headers: {
				Authorization: `Bearer ${CONTEXT7_API_KEY}`,
			},
		});

		const response = await body.json();

		return [
			{
				functionResponse: {
					name: 'context7',
					response: {
						content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
					},
				},
			},
		];
	},
};

export const context7Tool = new DiscoveredMCPTool(
	callableTool,
	'context7',
	'search',
	'Use the Context7 API to search libraries and fetch documentation programmatically',
	z.object({
		query: z.string().describe('Search term for finding libraries'),
	}),
	true
);
