# Mercado Livre MCP Plugin

This Codex plugin bundles a read-only Mercado Livre MCP server.

## What Users Can Ask

- "Check if Mercado Livre is configured."
- "Connect Mercado Livre."
- "Show the seller reputation for seller 123456789."
- "Review listing quality for item MLB123456789."
- "Show Product Ads metrics for this campaign last month."
- "Find items with lost exposure for this seller."

## Authentication

Ask Codex to connect Mercado Livre. The plugin will guide you through OAuth, store the tokens locally, and keep the refresh token updated when Mercado Livre rotates it.

In the Mercado Livre developer app, enable PKCE if the console offers that setting. Use the exact valid HTTPS redirect URI configured in the app when Codex asks for `redirect_uri`.

Admins can configure either:

- `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET`, and `MELI_REFRESH_TOKEN`
- or `MELI_ACCESS_TOKEN` for short-lived testing

Do not paste tokens into chat. Store them in Codex MCP/plugin environment settings or in the environment used to launch Codex.
