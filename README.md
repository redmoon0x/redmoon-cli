# Redmoon CLI

Redmoon CLI is a personal, unbloated fork of Gemini CLI focused on fast terminal
coding, multi-provider model routing, and first-class browser automation through
Aether.

This fork keeps the useful runtime core and removes upstream project automation,
eval suites, performance suites, memory tests, integration tests, GitHub/GCP
automation, and non-runtime packages that are not needed for personal CLI use.

## What Stayed

- `packages/cli` - terminal UI and command surface.
- `packages/core` - agent loop, tools, prompts, MCP, providers, memory, and
  runtime logic.
- `packages/devtools` - devtools support.
- `packages/test-utils` - shared test helpers.
- `packages/aether-mcp` - Aether browser MCP submodule from
  [redmoon0x/Aether](https://github.com/redmoon0x/Aether.git).

## What Changed

- Rebranded visible CLI surface from Gemini CLI to Redmoon CLI.
- Added `redmoon` binary/script while keeping legacy `gemini` compatibility.
- Added `/provider` for interactive provider selection and API key setup.
- Added OpenAI-compatible provider support:
  - Gemini
  - Kilo Code
  - OpenCode Zen
  - OpenCode Go
  - OpenRouter
- `/model` and `/models` can fetch/select models from the active provider's
  `/models` endpoint.
- Redmoon config paths prefer `.redmoon`, `REDMOON.md`, `.redmoonignore`, and
  `REDMOON_*` env vars, while keeping compatibility fallbacks for old `.gemini`,
  `GEMINI.md`, `.geminiignore`, and `GEMINI_*`.
- Core system prompts now identify as Redmoon and emphasize proactive,
  evidence-driven coding.
- Added a built-in `aether` subagent for browser-driven tasks.

## Aether Browser Agent

Redmoon includes a built-in `aether` subagent for live browser work:

- navigating sites and web apps
- testing UI flows and forms
- inspecting DOM/accessibility state
- screenshots, visual state, tabs, cookies, logs, and network errors
- high-fidelity browser automation through Aether MCP

Aether is tracked as a git submodule at:

```text
packages/aether-mcp
```

The submodule points to:

```text
https://github.com/redmoon0x/Aether.git
```

Build and bundle commands sync the submodule before building, so Redmoon picks
up the latest Aether changes:

```powershell
npm run sync:aether
npm run build
npm run bundle
```

The bundled CLI copies Aether into:

```text
bundle/node_modules/aether-mcp-server
```

You can still override the bundled Aether server for local development:

```powershell
$env:REDMOON_AETHER_MCP_COMMAND = "node"
$env:REDMOON_AETHER_MCP_ARGS = '["D:\\brain\\reddit-bot\\server\\dist\\index.js"]'
$env:REDMOON_AETHER_MCP_CWD = "D:\\brain\\reddit-bot\\server"
```

## Providers

Run Redmoon and open the provider picker:

```text
/provider
```

The picker lets you choose a provider, enter an API key, fetch models, and
select the active model without hand-editing config.

Provider configuration is stored under Redmoon user storage:

```text
~/.redmoon/providers.json
```

Legacy `~/.gemini/providers.json` is read as a fallback if the Redmoon file does
not exist.

## Models

Use either command:

```text
/model
/models
```

For non-Gemini providers, Redmoon fetches models from the active provider's
`/models` endpoint where supported.

## MCP

MCP remains compatible with upstream behavior:

```powershell
npm run redmoon -- mcp --help
npm run redmoon -- mcp list
```

Redmoon reads MCP settings from `.redmoon/settings.json` first, with fallback to
legacy `.gemini/settings.json` if the Redmoon file is missing.

If a folder is untrusted, MCP servers are intentionally disabled until the
workspace is trusted or Redmoon is started with:

```powershell
npm run redmoon -- --skip-trust
```

## Development

Install dependencies:

```powershell
npm install
```

Run typecheck:

```powershell
npm run typecheck
```

Build:

```powershell
npm run build
```

Start Redmoon:

```powershell
npm run redmoon
```

Show help:

```powershell
npm run redmoon -- --help
```

## Submodules

When cloning this repo, include submodules:

```powershell
git clone --recurse-submodules https://github.com/redmoon0x/redmoon-cli.git
```

If already cloned:

```powershell
git submodule update --init --remote
```

## Notes

This is a personal fork and is not trying to preserve every upstream workflow.
The priority is a lean, practical coding CLI with strong provider flexibility
and a high-quality browser automation subagent.
