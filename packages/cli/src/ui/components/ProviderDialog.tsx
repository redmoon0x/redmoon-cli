/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useContext, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import {
  AuthType,
  clearActiveProvider,
  fetchProviderModels,
  getActiveProviderConfig,
  loadProviderConfigFile,
  ModelSlashCommandEvent,
  logModelSlashCommand,
  PROVIDER_PRESETS,
  resolveProviderConfig,
  saveApiKey,
  setProviderConfig,
  type ProviderConfig,
  type ProviderId,
} from '@google/gemini-cli-core';
import { theme } from '../semantic-colors.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { ConfigContext } from '../contexts/ConfigContext.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import { TextInput } from './shared/TextInput.js';
import { useTextBuffer } from './shared/text-buffer.js';
import { MessageType, type HistoryItemWithoutId } from '../types.js';

type ProviderDialogView =
  | 'provider'
  | 'apiKey'
  | 'loading'
  | 'model'
  | 'manual';

interface ProviderDialogProps {
  onClose: () => void;
  addItem?: (item: HistoryItemWithoutId) => void;
}

function providerApiKeyStatus(provider: ProviderId): string {
  const saved = loadProviderConfigFile().providers?.[provider]?.apiKey;
  const preset = PROVIDER_PRESETS[provider];
  if (saved) {
    return 'saved key';
  }
  if (process.env[preset.envKey]) {
    return preset.envKey;
  }
  return `needs ${preset.envKey}`;
}

function modelItems(models: string[]) {
  return [
    ...models.map((model) => ({
      value: model,
      title: model,
      key: model,
    })),
    {
      value: '__manual__',
      title: 'Enter model manually',
      description: 'Use this if the provider does not list the model you want.',
      key: '__manual__',
    },
  ];
}

export function ProviderDialog({
  onClose,
  addItem,
}: ProviderDialogProps): React.JSX.Element {
  const config = useContext(ConfigContext);
  const { terminalWidth } = useUIState();
  const active = getActiveProviderConfig()?.provider ?? 'gemini';
  const [view, setView] = useState<ProviderDialogView>('provider');
  const [provider, setProvider] = useState<ProviderId>(active);
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('');

  const viewportWidth = Math.max(20, terminalWidth - 8);
  const keyBuffer = useTextBuffer({
    initialText: '',
    viewport: { width: viewportWidth, height: 1 },
    inputFilter: (text) => text.replace(/[\r\n]/g, ''),
    singleLine: true,
  });
  const modelBuffer = useTextBuffer({
    initialText: '',
    viewport: { width: viewportWidth, height: 1 },
    inputFilter: (text) => text.replace(/[\r\n]/g, ''),
    singleLine: true,
  });

  const selectedPreset = PROVIDER_PRESETS[provider];
  const existingProviderConfig = resolveProviderConfig(provider);
  const providerOptions = useMemo(
    () =>
      Object.values(PROVIDER_PRESETS).map((preset) => ({
        value: preset.id,
        title: `${preset.label}${preset.id === active ? ' (active)' : ''}`,
        description:
          preset.id === 'gemini'
            ? `Built-in Gemini API auth, ${providerApiKeyStatus(preset.id)}`
            : `${preset.defaultBaseUrl ?? 'custom base URL'}, ${providerApiKeyStatus(preset.id)}`,
        key: preset.id,
      })),
    [active],
  );

  const initialProviderIndex = Math.max(
    0,
    providerOptions.findIndex((item) => item.value === active),
  );

  const showMessage = useCallback(
    (type: MessageType.INFO | MessageType.ERROR, text: string) => {
      addItem?.({ type, text });
    },
    [addItem],
  );

  const applyGemini = useCallback(
    async (submittedKey?: string) => {
      if (!config) {
        setError('Config is not initialized yet.');
        return;
      }
      const key = submittedKey?.trim();
      if (key) {
        await saveApiKey(key);
      }
      clearActiveProvider();
      await config.refreshAuth(AuthType.USE_GEMINI, key || undefined);
      showMessage(MessageType.INFO, 'Provider set to Gemini API.');
      onClose();
    },
    [config, onClose, showMessage],
  );

  const selectProvider = useCallback(
    async (nextProvider: ProviderId) => {
      setProvider(nextProvider);
      setError(null);
      keyBuffer.setText('', 'end');
      modelBuffer.setText('', 'end');

      if (nextProvider === 'gemini') {
        setView('apiKey');
        return;
      }

      const resolved = resolveProviderConfig(nextProvider);
      if (resolved.apiKey) {
        setApiKey(resolved.apiKey);
        setView('loading');
        setLoadingMessage(
          `Fetching ${PROVIDER_PRESETS[nextProvider].label} models...`,
        );
        try {
          const fetchedModels = await fetchProviderModels(resolved);
          setModels(fetchedModels);
          setView(fetchedModels.length > 0 ? 'model' : 'manual');
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setView('manual');
        }
      } else {
        setApiKey('');
        setView('apiKey');
      }
    },
    [keyBuffer, modelBuffer],
  );

  const submitApiKey = useCallback(
    async (value: string) => {
      setError(null);
      const submittedKey = value.trim();

      if (provider === 'gemini') {
        await applyGemini(submittedKey);
        return;
      }

      const resolved = resolveProviderConfig(provider, {
        provider,
        apiKey: submittedKey || existingProviderConfig.apiKey,
      });
      if (!resolved.apiKey) {
        setError(`Enter an API key or set ${selectedPreset.envKey}.`);
        return;
      }

      setApiKey(resolved.apiKey);
      setView('loading');
      setLoadingMessage(`Fetching ${selectedPreset.label} models...`);
      try {
        const fetchedModels = await fetchProviderModels(resolved);
        setModels(fetchedModels);
        setView(fetchedModels.length > 0 ? 'model' : 'manual');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setView('manual');
      }
    },
    [
      applyGemini,
      existingProviderConfig.apiKey,
      provider,
      selectedPreset.envKey,
      selectedPreset.label,
    ],
  );

  const applyProvider = useCallback(
    async (model: string) => {
      if (!config) {
        setError('Config is not initialized yet.');
        return;
      }
      const resolved: ProviderConfig = resolveProviderConfig(provider, {
        provider,
        apiKey,
        model,
      });
      if (!resolved.apiKey) {
        setError(`Missing API key for ${selectedPreset.label}.`);
        setView('apiKey');
        return;
      }

      setProviderConfig(resolved);
      config.setModel(model, false);
      await config.refreshAuth(AuthType.OPENAI_COMPATIBLE);
      logModelSlashCommand(config, new ModelSlashCommandEvent(model));
      showMessage(
        MessageType.INFO,
        [
          `Provider set to ${selectedPreset.label}`,
          `Base URL: ${resolved.baseUrl}`,
          `Model: ${model}`,
        ].join('\n'),
      );
      onClose();
    },
    [apiKey, config, onClose, provider, selectedPreset.label, showMessage],
  );

  const selectModel = useCallback(
    async (model: string) => {
      if (model === '__manual__') {
        modelBuffer.setText(selectedPreset.defaultModel ?? '', 'end');
        setView('manual');
        return;
      }
      await applyProvider(model);
    },
    [applyProvider, modelBuffer, selectedPreset.defaultModel],
  );

  const submitManualModel = useCallback(
    async (value: string) => {
      const model = value.trim() || selectedPreset.defaultModel;
      if (!model) {
        setError('Enter a model name.');
        return;
      }
      await applyProvider(model);
    },
    [applyProvider, selectedPreset.defaultModel],
  );

  useKeypress(
    (key) => {
      if (key.name !== 'escape') {
        return false;
      }
      if (view === 'model' || view === 'manual') {
        setView('apiKey');
        return true;
      }
      if (view === 'apiKey') {
        setView('provider');
        return true;
      }
      onClose();
      return true;
    },
    { isActive: view !== 'loading' },
  );

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>Provider</Text>

      {view === 'provider' && (
        <Box marginTop={1} flexDirection="column">
          <DescriptiveRadioButtonSelect
            items={providerOptions}
            onSelect={(value) => {
              void selectProvider(value);
            }}
            initialIndex={initialProviderIndex}
            showNumbers={true}
          />
          <Box marginTop={1}>
            <Text color={theme.text.secondary}>
              (Use arrows, Enter to select, Esc to close)
            </Text>
          </Box>
        </Box>
      )}

      {view === 'apiKey' && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.primary}>
            {provider === 'gemini'
              ? 'Enter a Gemini API key, or press Enter to keep the current key/env.'
              : `Enter ${selectedPreset.label} API key, or press Enter to keep saved/env key.`}
          </Text>
          <Box
            marginTop={1}
            borderStyle="round"
            borderColor={theme.border.default}
            paddingX={1}
          >
            <TextInput
              buffer={keyBuffer}
              onSubmit={(value) => {
                void submitApiKey(value);
              }}
              onCancel={() => setView('provider')}
              placeholder={
                existingProviderConfig.apiKey
                  ? 'Press Enter to keep existing key'
                  : 'Paste API key'
              }
            />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.text.secondary}>
              {provider === 'gemini'
                ? 'Stored in the existing Gemini API keychain.'
                : `Stored in ${selectedPreset.envKey}-compatible provider config.`}
            </Text>
          </Box>
        </Box>
      )}

      {view === 'loading' && (
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>{loadingMessage}</Text>
        </Box>
      )}

      {view === 'model' && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.primary}>
            Select model for {selectedPreset.label}
          </Text>
          <Box marginTop={1}>
            <DescriptiveRadioButtonSelect
              items={modelItems(models)}
              onSelect={(value) => {
                void selectModel(value);
              }}
              showNumbers={true}
              showScrollArrows={true}
              maxItemsToShow={10}
            />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.text.secondary}>
              (Use arrows, Enter to select, Esc to go back)
            </Text>
          </Box>
        </Box>
      )}

      {view === 'manual' && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.primary}>
            Enter model for {selectedPreset.label}
          </Text>
          <Box
            marginTop={1}
            borderStyle="round"
            borderColor={theme.border.default}
            paddingX={1}
          >
            <TextInput
              buffer={modelBuffer}
              onSubmit={(value) => {
                void submitManualModel(value);
              }}
              onCancel={() => setView('apiKey')}
              placeholder={selectedPreset.defaultModel ?? 'model-name'}
            />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.text.secondary}>
              (Enter to save, Esc to go back)
            </Text>
          </Box>
        </Box>
      )}

      {error && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.status.error}>{error}</Text>
        </Box>
      )}
    </Box>
  );
}
