/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { createRequire } from 'node:module';
import type { Config, MCPServerConfig } from '../config/config.js';
import { MCPServerConfig as McpServerConfig } from '../config/config.js';
import type { LocalAgentDefinition } from './types.js';
import { formatMcpToolName } from '../tools/mcp-tool.js';

const AETHER_AGENT_NAME = 'aether';
const AETHER_SERVER_NAMES = ['aether', 'aether-browser'];
const require = createRequire(import.meta.url);

const AetherAgentSchema = z.object({
  result: z.string().describe('The final answer or result from Aether.'),
});

function parseEnvArgs(value: string | undefined): string[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
    ) {
      return parsed;
    }
  } catch {
    // Fall back to whitespace splitting for simple command arguments.
  }

  return value.split(/\s+/).filter(Boolean);
}

function getAetherMcpServers(config: Config): Record<string, MCPServerConfig> {
  const configuredServers = config.getMcpServers() ?? {};
  const servers: Record<string, MCPServerConfig> = {};

  for (const name of AETHER_SERVER_NAMES) {
    const server = configuredServers[name];
    if (server) {
      servers[name] = server;
    }
  }

  const command = process.env['REDMOON_AETHER_MCP_COMMAND'];
  const bundledServerPath = (() => {
    try {
      return require.resolve('aether-mcp-server');
    } catch {
      return undefined;
    }
  })();

  if (!servers[AETHER_AGENT_NAME] && (command || bundledServerPath)) {
    servers[AETHER_AGENT_NAME] = new McpServerConfig(
      command ?? process.execPath,
      command
        ? parseEnvArgs(process.env['REDMOON_AETHER_MCP_ARGS'])
        : bundledServerPath
          ? [bundledServerPath]
          : undefined,
      undefined,
      process.env['REDMOON_AETHER_MCP_CWD'],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      'Personal Aether MCP server',
    );
  }

  return servers;
}

/**
 * A personal Aether subagent backed by the user's Aether MCP server.
 */
export const AetherAgent = (
  config: Config,
): LocalAgentDefinition<typeof AetherAgentSchema> => {
  const mcpServers = getAetherMcpServers(config);

  return {
    kind: 'local',
    name: AETHER_AGENT_NAME,
    displayName: 'Aether Agent',
    description:
      'Use for browser-driven work: navigating websites, testing UI flows, inspecting live pages, collecting web evidence, debugging frontend behavior, screenshots/visual state, forms, tabs, cookies, logs, network errors, and tasks that need high-fidelity browser automation through Aether MCP.',
    inputConfig: {
      inputSchema: {
        type: 'object',
        properties: {
          request: {
            type: 'string',
            description:
              'The complete task for Aether, including goal, context, constraints, and expected output.',
          },
        },
        required: ['request'],
      },
    },
    outputConfig: {
      outputName: 'result',
      description: 'The final Aether result.',
      schema: AetherAgentSchema,
    },
    modelConfig: {
      model: 'inherit',
      generateContentConfig: {
        temperature: 0.2,
        topP: 0.95,
      },
    },
    runConfig: {
      maxTimeMinutes: 20,
      maxTurns: 50,
    },
    toolConfig: {
      tools: AETHER_SERVER_NAMES.map((serverName) =>
        formatMcpToolName(serverName, '*'),
      ),
    },
    mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
    promptConfig: {
      query: '${request}',
      systemPrompt: `You are Aether, Redmoon CLI's personal delegated browser automation subagent.

You drive a real browser through Aether MCP. Your job is to complete browser-heavy tasks with high agency, high fidelity, and clear evidence while keeping the main Redmoon session lean.

Use this agent for:
- Navigating websites and web apps.
- Testing UI flows, forms, auth screens, dashboards, and local frontends.
- Inspecting live page state, DOM/accessibility state, console logs, network failures, screenshots, tabs, cookies, and performance clues.
- Gathering web evidence where the result depends on what is currently rendered in a browser.
- Repetitive browser tasks that would bloat the main session.

Tool strategy:
- First check browser availability/status with Aether tools such as \`browser_status\`, \`list_browsers\`, or \`connect_browser\` when connection state is unknown.
- Prefer compact, high-signal tools for routine work: \`browser_intent\`, \`snapshot_compact\`, \`list_interactive_elements\`, \`click_by_ref\`, \`click_by_selector\`, \`fill_by_selector\`, \`wait_for_selector\`, \`wait_for_text\`, \`get_logs\`, and \`get_network_errors\`.
- Use \`act\` for precise browser actions, compound actions, screenshots, emulation, cookies, network/debug actions, and state verification.
- Use screenshots, Set-of-Marks, accessibility snapshots, DOM snapshots, or visual frames when the task depends on visual layout, animation, element positions, or ambiguity.
- Use \`get_task_graph\` after multi-step flows or failures to understand what happened and recover.
- Avoid massive payload tools like full DOM snapshots or screenshot-heavy outputs unless they are needed for correctness.

Rules:
- Use Aether MCP tools whenever they are available and relevant. Do not substitute guesses for browser observations.
- Be evidence-driven. Do not claim that a page, UI state, console log, network response, screenshot, command, file, or external state was checked unless a tool result proves it.
- Verify after actions. After navigation, clicks, typing, form fills, or JS execution, check the resulting URL, visible text, element state, console/network errors, or screenshot as appropriate.
- Prefer semantic/natural actions first, then selectors/refs, then coordinates only when necessary.
- If an element reference becomes stale, rescan the page and recover instead of failing immediately.
- If CAPTCHA/human verification appears, use detection/reporting. Do not silently bypass a safety gate; explain what was found and what manual input is needed unless the user explicitly provided an allowed solving path.
- Keep the main Redmoon session lean: do the long-running exploration yourself and return a concise result with links, key observations, artifacts, commands/tools used, and blockers.
- If the Aether MCP tools are unavailable, say that clearly and explain what configuration is missing. Do not pretend to have used them.
- Finish by calling the completion tool with a clear final result.

Final result format:
- State the outcome first.
- Include the concrete evidence you observed: URL/title, visible UI state, screenshots or relevant text when available, console/network findings, and any failed steps.
- Mention whether the browser remains open or was closed when relevant.`,
    },
  };
};
