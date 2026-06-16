# Codex Desktop Setup Task: Mercado Livre MCP Plugin

You are setting up the Mercado Livre MCP plugin on this Windows machine.

Follow this checklist end to end. Run the commands yourself in the Codex integrated terminal when possible. Explain only when user action is required.

If the user pasted this file into chat and has not already cloned/opened the repo, clone the repo first.

## Values

Use this repo URL and default install folder unless the user asks for another location:

```powershell
$RepoUrl = "https://github.com/Likas07/MercadoLivreMCP.git"
$RepoDir = Join-Path $env:USERPROFILE "MercadoLivreMCP"
```

## Goal

Install and verify the repo-scoped Codex plugin named `mercado-livre-mcp`, then help the user connect Mercado Livre using the plugin's OAuth setup flow.

## Safety Rules

- Do not ask the user to paste Mercado Livre access tokens or refresh tokens into chat.
- Do not edit files unless a command fails because a path or config needs correction.
- Do not delete existing Codex config or plugins.
- If a command asks for permission, request the narrowest approval needed.
- If a restart of Codex is needed, tell the user exactly when to restart and what to do after reopening.

## Prerequisite Checks

Run:

```powershell
codex --version
node --version
git --version
```

If `codex` is missing, stop and tell the user Codex Desktop/CLI is not available in PATH.

If `node` is missing or older than version 20, run:

```powershell
winget install --id OpenJS.NodeJS.LTS
```

Then tell the user to close and reopen Codex before continuing.

If `git` is missing, run:

```powershell
winget install --id Git.Git
```

Then tell the user to close and reopen Codex before continuing.

## Clone Or Update The Repo

Set the install folder:

```powershell
$RepoUrl = "https://github.com/Likas07/MercadoLivreMCP.git"
$RepoDir = Join-Path $env:USERPROFILE "MercadoLivreMCP"
```

If `$RepoDir` does not exist, clone the repo:

```powershell
git clone $RepoUrl $RepoDir
```

If `$RepoDir` already exists, update it:

```powershell
cd $RepoDir
git pull --ff-only
```

If `git pull --ff-only` fails because there are local changes, stop and explain that the existing folder has local edits. Ask the user whether to choose a new folder or manually resolve the local changes. Do not delete the folder.

Enter the repo:

```powershell
cd $RepoDir
```

## Confirm Repo Root

Make sure the current directory is the root of this repo. It should contain:

- `.agents/plugins/marketplace.json`
- `plugins/mercado-livre-mcp/.codex-plugin/plugin.json`
- `plugins/mercado-livre-mcp/.mcp.json`
- `plugins/mercado-livre-mcp/server/index.mjs`

Run:

```powershell
Test-Path .\.agents\plugins\marketplace.json
Test-Path .\plugins\mercado-livre-mcp\.codex-plugin\plugin.json
Test-Path .\plugins\mercado-livre-mcp\.mcp.json
Test-Path .\plugins\mercado-livre-mcp\server\index.mjs
```

If any result is `False`, stop and explain that the cloned repo does not contain the expected plugin files. Include the current path and the missing paths.

## Register Marketplace

Run:

```powershell
codex plugin marketplace list
```

If `mercado-livre-local` is not listed, run:

```powershell
codex plugin marketplace add .
```

Then run:

```powershell
codex plugin marketplace list
```

Confirm `mercado-livre-local` appears.

## Install Plugin

Run:

```powershell
codex plugin add mercado-livre-mcp@mercado-livre-local
```

Then verify:

```powershell
codex plugin list
codex mcp list
```

Confirm:

- `mercado-livre-mcp@mercado-livre-local` is installed and enabled.
- `mercado-livre` appears in the MCP server list.

If the plugin installs but `mercado-livre` does not appear, tell the user to restart Codex and then run the verification commands again.

## Start A Fresh Thread

After installation, tell the user:

> Restart Codex, open this repo again, start a new thread, and say: "Check if Mercado Livre is configured. If not, connect it."

In that new thread, Codex should use:

1. `meli_setup_status`
2. `meli_auth_connect`

## Mercado Livre OAuth Setup

When `meli_auth_connect` runs:

- Use the form opened by Codex for Mercado Livre app credentials.
- Ask for the Mercado Livre app `client_id`, `client_secret`, and exact `redirect_uri`.
- Tell the user the Mercado Livre app should have PKCE enabled because this plugin sends `code_challenge_method=S256`.
- The `redirect_uri` must be the exact valid HTTPS URL configured in the Mercado Livre developer app. A static callback page is enough as long as Mercado Livre can redirect the browser there and the user can copy the full redirected URL back into Codex.
- Do not ask for access tokens or refresh tokens in chat.
- The plugin will store tokens locally and automatically persist each rotated Mercado Livre refresh token.

If Mercado Livre reports a redirect URI mismatch, explain that the `redirect_uri` must exactly match the value configured in the Mercado Livre developer app.

## Final Verification

After OAuth setup, call `meli_setup_status` again.

If it reports `ready: true`, tell the user setup is complete and give these example prompts:

```text
Show the seller reputation for seller 123456789.
Review listing quality for item MLB123456789.
Find items with lost exposure for this seller.
Summarize Product Ads metrics for this campaign last month.
```

If it does not report `ready: true`, summarize the exact missing requirement from `meli_setup_status`.

## Updating Later

If the user updates this repo later, run:

```powershell
codex plugin marketplace upgrade mercado-livre-local
codex plugin add mercado-livre-mcp@mercado-livre-local
```

Then restart Codex and start a new thread.
