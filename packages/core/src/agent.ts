/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

export function getAgentConfigPath(dir: string) {
  return path.join(dir, 'coco-agent.toml');
}

export function getAgentScriptPath(dir: string) {
  return path.join(dir, 'index.js');
}

// Placeholder for getAgent, which will be implemented later.
export function getAgent() {
  // In the future, this will load and return the agent.
  return null;
}
