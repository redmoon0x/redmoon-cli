/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LEGACY_GEMINI_DIR, REDMOON_DIR } from '../utils/paths.js';

export const PROVIDER_CONFIG_FILENAME = 'providers.json';

export type ProviderId =
  | 'gemini'
  | 'kilocode'
  | 'opencode-zen'
  | 'opencode-go'
  | 'openrouter';

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  envKey: string;
  defaultBaseUrl?: string;
  defaultModel?: string;
  openAiCompatible: boolean;
}

export interface ProviderConfig {
  provider: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface ProviderConfigFile {
  activeProvider?: ProviderId;
  providers?: Partial<Record<ProviderId, ProviderConfig>>;
}

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  gemini: {
    id: 'gemini',
    label: 'Gemini API',
    envKey: 'GEMINI_API_KEY',
    defaultModel: 'auto',
    openAiCompatible: false,
  },
  kilocode: {
    id: 'kilocode',
    label: 'KiloCode Gateway',
    envKey: 'KILOCODE_API_KEY',
    defaultBaseUrl: 'https://api.kilo.ai/api/gateway',
    defaultModel: 'anthropic/claude-sonnet-4.5',
    openAiCompatible: true,
  },
  'opencode-zen': {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    envKey: 'OPENCODE_API_KEY',
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    defaultModel: 'glm-4.7-free',
    openAiCompatible: true,
  },
  'opencode-go': {
    id: 'opencode-go',
    label: 'OpenCode Go',
    envKey: 'OPENCODE_GO_API_KEY',
    defaultBaseUrl: 'https://opencode.ai/zen/go/v1',
    defaultModel: 'qwen3-coder',
    openAiCompatible: true,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    openAiCompatible: true,
  },
};

export function getProviderConfigPath(): string {
  return path.join(os.homedir(), REDMOON_DIR, PROVIDER_CONFIG_FILENAME);
}

export function loadProviderConfigFile(): ProviderConfigFile {
  const filePath = getProviderConfigPath();
  const legacyFilePath = path.join(
    os.homedir(),
    LEGACY_GEMINI_DIR,
    PROVIDER_CONFIG_FILENAME,
  );
  const pathToRead =
    fs.existsSync(filePath) || !fs.existsSync(legacyFilePath)
      ? filePath
      : legacyFilePath;
  if (!fs.existsSync(pathToRead)) {
    return {};
  }
  const raw = fs.readFileSync(pathToRead, 'utf-8');
  return JSON.parse(raw) as ProviderConfigFile;
}

export function saveProviderConfigFile(config: ProviderConfigFile): void {
  const filePath = getProviderConfigPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export function getActiveProviderConfig(): ProviderConfig | undefined {
  const file = loadProviderConfigFile();
  const provider = file.activeProvider;
  if (!provider) {
    return undefined;
  }
  return resolveProviderConfig(provider, file.providers?.[provider]);
}

export function resolveProviderConfig(
  provider: ProviderId,
  saved?: ProviderConfig,
): ProviderConfig {
  const preset = PROVIDER_PRESETS[provider];
  const envKey = process.env[preset.envKey];
  const baseUrlEnvName = `${provider.toUpperCase().replace(/-/g, '_')}_BASE_URL`;
  return {
    provider,
    apiKey: saved?.apiKey || envKey,
    baseUrl:
      saved?.baseUrl || process.env[baseUrlEnvName] || preset.defaultBaseUrl,
    model: saved?.model || preset.defaultModel,
  };
}

export function setProviderConfig(providerConfig: ProviderConfig): void {
  const current = loadProviderConfigFile();
  const provider = providerConfig.provider;
  current.activeProvider = provider;
  current.providers = {
    ...(current.providers ?? {}),
    [provider]: providerConfig,
  };
  saveProviderConfigFile(current);
}

export function clearActiveProvider(): void {
  const current = loadProviderConfigFile();
  delete current.activeProvider;
  saveProviderConfigFile(current);
}

export async function fetchProviderModels(
  providerConfig: ProviderConfig,
): Promise<string[]> {
  const preset = PROVIDER_PRESETS[providerConfig.provider];
  if (!preset.openAiCompatible) {
    return [];
  }
  const baseUrl = (providerConfig.baseUrl || preset.defaultBaseUrl)?.replace(
    /\/+$/,
    '',
  );
  if (!baseUrl) {
    return [];
  }

  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      ...(providerConfig.apiKey
        ? { Authorization: `Bearer ${providerConfig.apiKey}` }
        : {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch models from ${preset.label}: ${response.status} ${response.statusText}`,
    );
  }
  const json = (await response.json()) as {
    data?: Array<{ id?: string; name?: string }>;
  };
  return (json.data ?? [])
    .map((model) => model.id || model.name)
    .filter((model): model is string => Boolean(model));
}
