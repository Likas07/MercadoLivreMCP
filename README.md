# MercadoLivre MCP Server

Read-only MCP server and Codex plugin for Mercado Livre API data. It exposes named tools for the endpoints in the provided docs: Product Ads, seller reputation, publication quality, purchase experience, catalog quality, item searches, listing exposure, and product/item metadata.

## Requirements

- Node.js 20+
- Mercado Livre OAuth credentials

## Install

```bash
npm install
npm run build
```

## Codex Plugin

This repo includes a repo-scoped Codex plugin at `plugins/mercado-livre-mcp` and a marketplace file at `.agents/plugins/marketplace.json`.

For Windows recipients, send [WINDOWS_SETUP.md](./WINDOWS_SETUP.md).

For a non-technical Codex Desktop setup, send [CODEX_DESKTOP_SETUP_PROMPT.md](./CODEX_DESKTOP_SETUP_PROMPT.md) and tell them to open this repo in Codex, attach that file, and ask Codex to follow it.

For local testing:

```bash
codex plugin marketplace add .
```

Then restart Codex, open **Plugins**, choose the repo marketplace, and install **Mercado Livre MCP**.

After install, ask Codex:

```text
Check if Mercado Livre is configured. If not, connect it.
```

Codex should call `meli_setup_status`, then `meli_auth_connect`. The OAuth setup opens Mercado Livre, exchanges the authorization code, stores tokens locally, and automatically persists Mercado Livre's rotated refresh token on each refresh.

Admins can also configure the bundled MCP server with environment variables. Prefer:

```text
MELI_CLIENT_ID
MELI_CLIENT_SECRET
MELI_REFRESH_TOKEN
```

Use `MELI_ACCESS_TOKEN` only for quick testing because access tokens expire.

Run locally:

```bash
MELI_ACCESS_TOKEN=your_token npm start
```

For normal use, prefer refresh credentials so the server can renew the access token in memory:

```bash
MELI_CLIENT_ID=your_client_id \
MELI_CLIENT_SECRET=your_client_secret \
MELI_REFRESH_TOKEN=your_refresh_token \
npm start
```

## MCP Client Config

Use the built `dist/index.js` entrypoint from this folder:

```json
{
  "mcpServers": {
    "mercadolivre": {
      "command": "node",
      "args": ["/absolute/path/to/MercadoLivreMCP/dist/index.js"],
      "env": {
        "MELI_CLIENT_ID": "your_client_id",
        "MELI_CLIENT_SECRET": "your_client_secret",
        "MELI_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

You can also package it for another machine:

```bash
npm run build
npm pack
```

Then install the generated `.tgz` wherever the MCP client runs.

## Tools

- `meli_setup_status`
- `meli_auth_connect`
- `meli_auth_logout`
- `meli_get_advertisers`
- `meli_get_product_ad`
- `meli_search_product_ad_campaigns`
- `meli_get_product_ad_campaign`
- `meli_search_product_ads`
- `meli_get_seller_reputation`
- `meli_get_item_publication_quality`
- `meli_get_user_product_quality`
- `meli_get_purchase_experience_by_item`
- `meli_get_purchase_experience_by_user_product`
- `meli_get_catalog_quality_status`
- `meli_get_items_with_lost_exposure`
- `meli_search_user_items`
- `meli_list_listing_exposures`
- `meli_get_listing_exposure`
- `meli_list_site_listing_types`
- `meli_get_site_listing_type`
- `meli_get_user_available_listing_types`
- `meli_get_user_available_free_listing_type`
- `meli_get_item_available_listing_types`
- `meli_get_item_available_upgrades`
- `meli_get_item_available_downgrades`
- `meli_get_item_listing_type`
- `meli_get_item`
- `meli_get_item_description`
- `meli_get_category`
- `meli_get_category_attributes`
- `meli_get_category_sale_terms`
- `meli_get_domain_technical_specs`
- `meli_get`

`meli_get` is a read-only escape hatch for Mercado Livre API paths not yet represented by a named tool. It only accepts relative API paths such as `/users/123`.

## Official Docs Used

- https://developers.mercadolivre.com.br/pt_br/product-ads-leitura
- https://developers.mercadolivre.com.br/pt_br/reputacao-de-vendedores
- https://developers.mercadolivre.com.br/pt_br/qualidade-das-publicacoes
- https://developers.mercadolivre.com.br/pt_br/experiencia-de-compra
- https://developers.mercadolivre.com.br/pt_br/saiba-como-estao-seus-vendedores-em-relacao-carga-de-atributos
- https://developers.mercadolivre.com.br/pt_br/itens-e-buscas
- https://developers.mercadolivre.com.br/pt_br/tutorial-tipos-de-publicacao-y-atualizacao-de-artigos
- https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos
