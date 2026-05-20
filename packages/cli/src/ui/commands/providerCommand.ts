/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuthType,
  clearActiveProvider,
  fetchProviderModels,
  getActiveProviderConfig,
  PROVIDER_PRESETS,
  resolveProviderConfig,
  setProviderConfig,
  type ProviderId,
} from '@google/gemini-cli-core';
import { createElement } from 'react';
import {
  CommandKind,
  type CommandContext,
  type SlashCommand,
} from './types.js';
import { MessageType } from '../types.js';
import { ProviderDialog } from '../components/ProviderDialog.js';

function parseArgs(args: string): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const tokens = args.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].replace(/^["']|["']$/g, '');
    if (token.startsWith('--')) {
      const [rawKey, inlineValue] = token.slice(2).split(/=(.*)/s);
      if (inlineValue !== undefined) {
        flags[rawKey] = inlineValue;
      } else {
        const next = tokens[i + 1]?.replace(/^["']|["']$/g, '');
        if (next && !next.startsWith('--')) {
          flags[rawKey] = next;
          i++;
        } else {
          flags[rawKey] = true;
        }
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function isProviderId(value: string): value is ProviderId {
  return value in PROVIDER_PRESETS;
}

function isStringFlag(value: string | boolean | undefined): value is string {
  return value !== undefined && value !== true;
}

function info(context: CommandContext, text: string): void {
  context.ui.addItem({ type: MessageType.INFO, text });
}

function error(context: CommandContext, text: string): void {
  context.ui.addItem({ type: MessageType.ERROR, text });
}

const listCommand: SlashCommand = {
  name: 'list',
  description: 'List supported providers',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const active = getActiveProviderConfig()?.provider ?? 'gemini';
    const lines = Object.values(PROVIDER_PRESETS).map(
      (provider) =>
        `${provider.id === active ? '*' : ' '} ${provider.id} - ${provider.label}`,
    );
    info(context, lines.join('\n'));
  },
};

const statusCommand: SlashCommand = {
  name: 'status',
  description: 'Show the active provider',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const active = getActiveProviderConfig();
    if (!active) {
      info(
        context,
        `Active provider: gemini\nModel: ${context.services.agentContext?.config.getModel() ?? 'auto'}`,
      );
      return;
    }
    info(
      context,
      [
        `Active provider: ${active.provider}`,
        `Base URL: ${active.baseUrl ?? '(default)'}`,
        `Model: ${context.services.agentContext?.config.getModel() ?? active.model ?? '(not set)'}`,
        `API key: ${active.apiKey ? 'configured' : `missing (${PROVIDER_PRESETS[active.provider].envKey})`}`,
      ].join('\n'),
    );
  },
};

const modelsCommand: SlashCommand = {
  name: 'models',
  description:
    'Fetch models from a provider. Usage: /provider models [provider]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context, args) => {
    const providerName = args.trim() || getActiveProviderConfig()?.provider;
    if (!providerName || !isProviderId(providerName)) {
      error(
        context,
        'Usage: /provider models <gemini|kilocode|opencode-zen|opencode-go|openrouter>',
      );
      return;
    }
    if (providerName === 'gemini') {
      info(
        context,
        'Gemini models are managed by the built-in /model command.',
      );
      return;
    }
    try {
      const models = await fetchProviderModels(
        resolveProviderConfig(providerName),
      );
      info(
        context,
        models.length > 0
          ? models.slice(0, 80).join('\n')
          : `No models returned by ${providerName}.`,
      );
    } catch (e) {
      error(context, e instanceof Error ? e.message : String(e));
    }
  },
};

const useCommand: SlashCommand = {
  name: 'use',
  description:
    'Use a provider. Usage: /provider use <provider> [model] [--key KEY] [--base-url URL]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context, args) => {
    const { positional, flags } = parseArgs(args);
    const providerName = positional[0];
    if (!providerName || !isProviderId(providerName)) {
      error(
        context,
        'Usage: /provider use <gemini|kilocode|opencode-zen|opencode-go|openrouter> [model] [--key KEY] [--base-url URL]',
      );
      return;
    }

    const config = context.services.agentContext?.config;
    if (!config) {
      error(context, 'Config is not initialized yet.');
      return;
    }

    if (providerName === 'gemini') {
      clearActiveProvider();
      await config.refreshAuth(AuthType.USE_GEMINI);
      if (positional[1]) {
        config.setModel(positional[1], false);
      }
      info(
        context,
        `Provider set to gemini${positional[1] ? ` (${positional[1]})` : ''}`,
      );
      return;
    }

    const providerConfig = resolveProviderConfig(providerName, {
      provider: providerName,
      apiKey: isStringFlag(flags['key']) ? flags['key'] : undefined,
      baseUrl: isStringFlag(flags['base-url']) ? flags['base-url'] : undefined,
      model: positional[1],
    });

    if (!providerConfig.apiKey) {
      error(
        context,
        `Missing API key. Pass --key or set ${PROVIDER_PRESETS[providerName].envKey}.`,
      );
      return;
    }

    setProviderConfig(providerConfig);
    config.setModel(
      providerConfig.model ?? positional[1] ?? config.getModel(),
      false,
    );
    await config.refreshAuth(AuthType.OPENAI_COMPATIBLE);
    info(
      context,
      [
        `Provider set to ${providerName}`,
        `Base URL: ${providerConfig.baseUrl}`,
        `Model: ${config.getModel()}`,
      ].join('\n'),
    );
  },
};

export const providerCommand: SlashCommand = {
  name: 'provider',
  description: 'Manage model providers',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [statusCommand, listCommand, useCommand, modelsCommand],
  action: async (context) => ({
    type: 'custom_dialog',
    component: createElement(ProviderDialog, {
      onClose: context.ui.removeComponent,
      addItem: context.ui.addItem,
    }),
  }),
};
