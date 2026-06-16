# Windows Setup For Mercado Livre MCP Plugin

These instructions install the repo-scoped Codex plugin on a Windows machine.

## Requirements

- Windows with PowerShell
- Codex installed and signed in
- Git
- Node.js 20 or newer

Install common prerequisites from PowerShell:

```powershell
winget install Codex -s msstore
winget install --id Git.Git
winget install --id OpenJS.NodeJS.LTS
```

Close and reopen PowerShell after installing Git or Node.

## Install From The Repo

Clone the repo:

```powershell
cd $env:USERPROFILE
git clone https://github.com/Likas07/MercadoLivreMCP.git MercadoLivreMCP
cd .\MercadoLivreMCP
```

Register the repo as a Codex plugin marketplace:

```powershell
codex plugin marketplace add .
```

Install the plugin:

```powershell
codex plugin add mercado-livre-mcp@mercado-livre-local
```

Confirm it is installed:

```powershell
codex plugin list
codex mcp list
```

You should see:

- `mercado-livre-mcp@mercado-livre-local` as installed and enabled
- `mercado-livre` in the MCP server list

Restart Codex after installation.

## Connect Mercado Livre

Start a new Codex thread and ask:

```text
Check if Mercado Livre is configured. If not, connect it.
```

Codex should call:

1. `meli_setup_status`
2. `meli_auth_connect`

The OAuth flow asks for the Mercado Livre app credentials, opens the Mercado Livre authorization URL, exchanges the authorization code, and stores tokens locally. After that, the plugin automatically refreshes access tokens and persists Mercado Livre's rotated refresh token.

## Normal Use

Example prompts:

```text
Show the seller reputation for seller 123456789.
Review listing quality for item MLB123456789.
Find items with lost exposure for this seller.
Summarize Product Ads metrics for this campaign last month.
```

## Troubleshooting

If PowerShell blocks scripts with an execution-policy error:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

If Codex cannot find the plugin after updating the repo:

```powershell
codex plugin marketplace upgrade mercado-livre-local
codex plugin add mercado-livre-mcp@mercado-livre-local
```

If Node is not found:

```powershell
node --version
```

If that fails, reinstall Node.js and reopen PowerShell:

```powershell
winget install --id OpenJS.NodeJS.LTS
```
