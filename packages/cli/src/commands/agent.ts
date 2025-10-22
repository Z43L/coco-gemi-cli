/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
const AGENT_TEMPLATE = `import { Context, Tool, defineAgent } from '@google/generative-ai/server_beta';

export const agent = defineAgent({
  async onTurn(context: Context) {
    // Your agent logic here
    return "I am a new agent.";
  },
});
`;

const TOML_TEMPLATE = `[agent]
mission = "{mission}"
tools = []
`;

const AGENT_CONFIG_FILENAME = 'coco-agent.toml';
const AGENT_SCRIPT_FILENAME = 'index.js';

function getAgentConfigPath(dir: string) {
	return path.join(dir, AGENT_CONFIG_FILENAME);
}

function getAgentScriptPath(dir: string) {
	return path.join(dir, AGENT_SCRIPT_FILENAME);
}

interface AgentInitArgs {
	dir: string;
	mission: string;
}

const initCommand: CommandModule<object, AgentInitArgs> = {
	command: 'init',
	describe: 'Initialize a new custom sub-agent.',
	builder: (yargs) =>
		yargs
			.option('dir', {
				type: 'string',
				description: 'Directory to initialize the agent in.',
				default: '.',
			})
			.option('mission', {
				type: 'string',
				description: 'The mission statement for the agent.',
				default: 'Solve the world\'s problems.',
			}),
	async handler(args) {
		const absoluteDir = path.resolve(args.dir);
		const configPath = getAgentConfigPath(absoluteDir);
		const scriptPath = getAgentScriptPath(absoluteDir);

		console.log(`Initializing agent in ${absoluteDir}`);

		await fs.mkdir(absoluteDir, { recursive: true });
		await fs.writeFile(
			configPath,
			TOML_TEMPLATE.replace('{mission}', args.mission)
		);
		await fs.writeFile(scriptPath, AGENT_TEMPLATE);

		console.log('Agent initialized successfully!');
		console.log(`- Agent configuration: ${configPath}`);
		console.log(`- Agent script: ${scriptPath}`);
	},
};

export const agentCommand: CommandModule = {
	command: 'agent <command>',
	describe: 'Create and manage custom sub-agents.',
	builder: (yargs) => yargs.command(initCommand),
	handler: () => {},
};
