/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

import {
  FinishReason,
  GenerateContentResponse,
  CountTokensResponse,
  EmbedContentResponse,
  type Content,
  type CountTokensParameters,
  type EmbedContentParameters,
  type FunctionCall,
  type GenerateContentParameters,
  type GenerateContentResponseUsageMetadata,
  type Part,
  type Tool,
} from '@google/genai';
import type { ContentGenerator } from '../core/contentGenerator.js';
import type { LlmRole } from '../telemetry/llmRole.js';
import type { ProviderConfig } from './providerConfig.js';

type OpenAiRole = 'system' | 'user' | 'assistant' | 'tool';

interface OpenAiMessage {
  role: OpenAiRole;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAiStreamChoice {
  delta?: {
    content?: string;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: 'function';
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  };
  finish_reason?: string | null;
}

interface OpenAiChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAiStreamChunk {
  id?: string;
  model?: string;
  choices?: OpenAiStreamChoice[];
  usage?: OpenAiChatResponse['usage'];
}

export class OpenAiCompatibleContentGenerator implements ContentGenerator {
  constructor(private readonly providerConfig: ProviderConfig) {}

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<GenerateContentResponse> {
    const response = await this.postChatCompletion(request, false);
    const json = (await response.json()) as OpenAiChatResponse;
    return this.chatResponseToGeminiResponse(request.model, json);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const response = await this.postChatCompletion(request, true);
    return this.readSseStream(request.model, response);
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    const response = new CountTokensResponse();
    response.totalTokens = estimateTextTokens(
      JSON.stringify(request.contents ?? ''),
    );
    return response;
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    const response = new EmbedContentResponse();
    response.embeddings = [];
    return response;
  }

  private async postChatCompletion(
    request: GenerateContentParameters,
    stream: boolean,
  ): Promise<Response> {
    const baseUrl = this.getBaseUrl();
    const body = {
      model: request.model,
      messages: this.toOpenAiMessages(request),
      stream,
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      max_tokens: request.config?.maxOutputTokens,
      stop: request.config?.stopSequences,
      tools: this.toOpenAiTools(request.config?.tools as Tool[] | undefined),
    };

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.providerConfig.apiKey
          ? { Authorization: `Bearer ${this.providerConfig.apiKey}` }
          : {}),
        ...(this.providerConfig.provider === 'openrouter'
          ? {
              'HTTP-Referer': 'https://github.com/google-gemini/gemini-cli',
              'X-OpenRouter-Title': 'Redmoon CLI',
            }
          : {}),
      },
      body: JSON.stringify(dropUndefined(body)),
      signal: request.config?.abortSignal,
    });

    if (!response.ok) {
      throw new Error(
        `${this.providerConfig.provider} request failed: ${response.status} ${response.statusText} ${await response.text()}`,
      );
    }
    return response;
  }

  private getBaseUrl(): string {
    const baseUrl = this.providerConfig.baseUrl?.replace(/\/+$/, '');
    if (!baseUrl) {
      throw new Error(`Missing base URL for ${this.providerConfig.provider}`);
    }
    return baseUrl;
  }

  private toOpenAiMessages(
    request: GenerateContentParameters,
  ): OpenAiMessage[] {
    const messages: OpenAiMessage[] = [];
    const systemInstruction = request.config?.systemInstruction;
    if (typeof systemInstruction === 'string' && systemInstruction.trim()) {
      messages.push({ role: 'system', content: systemInstruction });
    } else if (
      systemInstruction &&
      typeof systemInstruction === 'object' &&
      'parts' in systemInstruction
    ) {
      messages.push({
        role: 'system',
        content: partsToText(systemInstruction.parts ?? []),
      });
    }

    const contents = Array.isArray(request.contents)
      ? request.contents
      : [request.contents];
    for (const content of contents.filter(Boolean) as Content[]) {
      messages.push(...contentToOpenAiMessages(content));
    }
    return messages;
  }

  private toOpenAiTools(tools?: Tool[]):
    | Array<{
        type: 'function';
        function: { name: string; description?: string; parameters?: unknown };
      }>
    | undefined {
    const declarations = tools?.flatMap(
      (tool) => tool.functionDeclarations ?? [],
    );
    if (!declarations?.length) {
      return undefined;
    }
    return declarations
      .filter((fn) => fn.name)
      .map((fn) => ({
        type: 'function' as const,
        function: {
          name: fn.name!,
          description: fn.description,
          parameters: fn.parametersJsonSchema ?? fn.parameters,
        },
      }));
  }

  private chatResponseToGeminiResponse(
    requestedModel: string,
    json: OpenAiChatResponse,
  ): GenerateContentResponse {
    const choice = json.choices?.[0];
    const parts: Part[] = [];
    if (choice?.message?.content) {
      parts.push({ text: choice.message.content });
    }
    for (const toolCall of choice?.message?.tool_calls ?? []) {
      parts.push({ functionCall: openAiToolCallToGemini(toolCall) });
    }

    return makeResponse({
      model: json.model ?? requestedModel,
      responseId: json.id,
      parts,
      finishReason: mapFinishReason(choice?.finish_reason),
      usage: json.usage,
    });
  }

  private async *readSseStream(
    requestedModel: string,
    response: Response,
  ): AsyncGenerator<GenerateContentResponse> {
    if (!response.body) {
      throw new Error('Provider returned an empty stream body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls = new Map<number, OpenAiToolCall>();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data:')) {
          continue;
        }
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') {
          continue;
        }

        const chunk = JSON.parse(data) as OpenAiStreamChunk;
        const choice = chunk.choices?.[0];
        const parts: Part[] = [];
        if (choice?.delta?.content) {
          parts.push({ text: choice.delta.content });
        }

        for (const deltaTool of choice?.delta?.tool_calls ?? []) {
          const index = deltaTool.index ?? 0;
          const existing =
            toolCalls.get(index) ??
            ({
              id: deltaTool.id ?? `call_${index}`,
              type: 'function',
              function: { name: '', arguments: '' },
            } satisfies OpenAiToolCall);
          existing.id = deltaTool.id ?? existing.id;
          existing.function.name =
            deltaTool.function?.name ?? existing.function.name;
          existing.function.arguments += deltaTool.function?.arguments ?? '';
          toolCalls.set(index, existing);
        }

        if (choice?.finish_reason) {
          for (const toolCall of toolCalls.values()) {
            parts.push({ functionCall: openAiToolCallToGemini(toolCall) });
          }
        }

        if (parts.length > 0 || choice?.finish_reason || chunk.usage) {
          yield makeResponse({
            model: chunk.model ?? requestedModel,
            responseId: chunk.id,
            parts,
            finishReason: mapFinishReason(choice?.finish_reason),
            usage: chunk.usage,
          });
        }
      }
    }
  }
}

function contentToOpenAiMessages(content: Content): OpenAiMessage[] {
  const parts = content.parts ?? [];
  const functionResponses = parts.filter((part) => part.functionResponse);
  if (functionResponses.length > 0) {
    return functionResponses.map((part) => ({
      role: 'tool',
      tool_call_id:
        part.functionResponse?.id ?? part.functionResponse?.name ?? 'tool_call',
      content: JSON.stringify(part.functionResponse?.response ?? {}),
    }));
  }

  if (content.role === 'model') {
    const toolCalls = parts
      .filter((part) => part.functionCall)
      .map((part, index) =>
        geminiFunctionCallToOpenAi(part.functionCall!, index),
      );
    return [
      {
        role: 'assistant',
        content: partsToText(parts) || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
    ];
  }

  return [{ role: 'user', content: partsToText(parts) }];
}

function partsToText(parts: Part[]): string {
  return parts
    .map((part) => {
      if (part.text) {
        return part.text;
      }
      if (part.inlineData) {
        return `[inline data: ${part.inlineData.mimeType ?? 'unknown'}]`;
      }
      if (part.fileData) {
        return `[file: ${part.fileData.fileUri ?? 'unknown'}]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function geminiFunctionCallToOpenAi(
  call: FunctionCall,
  index: number,
): OpenAiToolCall {
  return {
    id: call.id ?? `${call.name ?? 'tool'}_${index}`,
    type: 'function',
    function: {
      name: call.name ?? 'tool',
      arguments: JSON.stringify(call.args ?? {}),
    },
  };
}

function openAiToolCallToGemini(toolCall: OpenAiToolCall): FunctionCall {
  return {
    id: toolCall.id,
    name: toolCall.function.name,
    args: parseJsonObject(toolCall.function.arguments),
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapFinishReason(reason?: string | null): FinishReason | undefined {
  if (!reason) {
    return undefined;
  }
  if (reason === 'tool_calls') {
    return FinishReason.STOP;
  }
  if (reason === 'length') {
    return FinishReason.MAX_TOKENS;
  }
  if (reason === 'content_filter') {
    return FinishReason.SAFETY;
  }
  return FinishReason.STOP;
}

function makeResponse({
  model,
  responseId,
  parts,
  finishReason,
  usage,
}: {
  model: string;
  responseId?: string;
  parts: Part[];
  finishReason?: FinishReason;
  usage?: OpenAiChatResponse['usage'];
}): GenerateContentResponse {
  const response = new GenerateContentResponse();
  response.modelVersion = model;
  response.responseId = responseId;
  response.candidates = [
    {
      index: 0,
      content: { role: 'model', parts },
      finishReason,
    },
  ];
  response.usageMetadata = {
    promptTokenCount: usage?.prompt_tokens,
    candidatesTokenCount: usage?.completion_tokens,
    totalTokenCount: usage?.total_tokens,
  } as GenerateContentResponseUsageMetadata;
  return response;
}

function estimateTextTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
