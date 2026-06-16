---
name: mercado-livre
description: Use when a user asks Codex to inspect Mercado Livre or MercadoLibre seller, item, listing quality, purchase experience, catalog completeness, exposure, or Product Ads data through the bundled MCP server.
---

# Mercado Livre MCP

Use the bundled Mercado Livre MCP tools for read-only API inspection.

## First Response Pattern

- If the user is setting up the plugin, call `meli_setup_status` first.
- If credentials are missing, call `meli_auth_connect` for guided OAuth setup.
- Do not ask the user to paste secrets into chat unless the MCP client cannot use elicitation; prefer the auth form opened by `meli_auth_connect`.
- If the user asks about the Mercado Livre app setup, tell them to enable PKCE and use the exact valid HTTPS redirect URI configured in the app. The plugin sends `code_challenge_method=S256`.
- Explain that Mercado Livre refresh tokens are single-use and the plugin persists each rotated refresh token locally.
- Ask for exact IDs before calling data tools: seller/user id, item id, user product id, site id such as `MLB`, advertiser id, campaign id, and date range as `YYYY-MM-DD`.

## Tool Choices

- Seller reputation: `meli_get_seller_reputation`.
- Listing quality: `meli_get_item_publication_quality` or `meli_get_user_product_quality`.
- Purchase experience: `meli_get_purchase_experience_by_item` or `meli_get_purchase_experience_by_user_product`.
- Attribute completeness: `meli_get_catalog_quality_status`.
- Lost exposure: `meli_get_items_with_lost_exposure`.
- Product Ads advertisers, campaigns, ads, and metrics: use the `meli_*product_ad*` tools.
- Item and product metadata: `meli_get_item`, `meli_get_item_description`, category tools, and listing type tools.
- Use `meli_get` only when no named tool covers the requested read-only endpoint.
- Disconnect stored OAuth credentials only when the user explicitly asks; use `meli_auth_logout`.

## Output Style

Summarize results in business language. Highlight what needs attention, what looks healthy, and which fields from the Mercado Livre response support the conclusion. Keep raw JSON out of the final answer unless the user asks for it.
