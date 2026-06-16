#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const DEFAULT_API_BASE_URL = "https://api.mercadolibre.com";
const DEFAULT_AUTH_BASE_URL = "https://auth.mercadolivre.com.br";
const DEFAULT_TIMEOUT_MS = 30_000;
const SERVER_INSTRUCTIONS = `Read-only Mercado Livre API tools for Codex. Start with meli_setup_status; if not ready, use meli_auth_connect for guided OAuth setup. Ask users for exact IDs before data calls: seller/user id, item id, user product id, site id such as MLB, advertiser id, campaign id, and date ranges as YYYY-MM-DD. Prefer named tools over meli_get. Never ask users to paste OAuth secrets into chat unless elicitation is unavailable. Product Ads metrics usually need date_from and date_to. Return concise business summaries and mention Mercado Livre API errors plainly.`;

const PRODUCT_ADS_METRICS = [
  "clicks",
  "prints",
  "ctr",
  "cost",
  "cpc",
  "acos",
  "organic_units_quantity",
  "organic_units_amount",
  "organic_items_quantity",
  "direct_items_quantity",
  "indirect_items_quantity",
  "advertising_items_quantity",
  "cvr",
  "roas",
  "sov",
  "direct_units_quantity",
  "indirect_units_quantity",
  "units_quantity",
  "direct_amount",
  "indirect_amount",
  "total_amount"
] as const;

const PRODUCT_ADS_CAMPAIGN_METRICS = [
  ...PRODUCT_ADS_METRICS,
  "impression_share",
  "top_impression_share",
  "lost_impression_share_by_budget",
  "lost_impression_share_by_ad_rank",
  "acos_benchmark"
] as const;

type JsonPrimitive = string | number | boolean | null;
type QueryValue = JsonPrimitive | JsonPrimitive[] | undefined;
type Query = Record<string, QueryValue>;

type JsonData = unknown;

type StoredAuth = {
  client_id?: string;
  client_secret?: string;
  redirect_uri?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at_ms?: number;
  token_type?: string;
  scope?: string;
  user_id?: string | number;
  updated_at?: string;
};

class MercadoLivreApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly details: unknown
  ) {
    super(message);
    this.name = "MercadoLivreApiError";
  }
}

class TokenProvider {
  private accessToken?: string;
  private expiresAtMs = 0;
  private refreshToken?: string;
  private storedAuth: StoredAuth = {};

  constructor(private readonly env: NodeJS.ProcessEnv) {
    this.accessToken = env.MELI_ACCESS_TOKEN || env.MERCADO_LIVRE_ACCESS_TOKEN;
    this.refreshToken = env.MELI_REFRESH_TOKEN || env.MERCADO_LIVRE_REFRESH_TOKEN;

    if (this.accessToken) {
      this.expiresAtMs = Number.POSITIVE_INFINITY;
    }
  }

  async initialize(): Promise<void> {
    this.storedAuth = await readStoredAuth();

    if (!this.accessToken && this.storedAuth.access_token) {
      this.accessToken = this.storedAuth.access_token;
      this.expiresAtMs = this.storedAuth.expires_at_ms ?? 0;
    }

    // Prefer the persisted refresh token over the original env var because Mercado Livre
    // refresh tokens are single-use and rotate on every refresh.
    this.refreshToken = this.storedAuth.refresh_token ?? this.refreshToken;
  }

  async getToken(): Promise<string> {
    const oneMinuteFromNow = Date.now() + 60_000;
    if (this.accessToken && this.expiresAtMs > oneMinuteFromNow) {
      return this.accessToken;
    }

    if (this.canRefresh()) {
      await this.refresh();
      if (this.accessToken) {
        return this.accessToken;
      }
    }

    throw new Error(
      "Missing Mercado Livre credentials. Set MELI_ACCESS_TOKEN or MELI_CLIENT_ID, MELI_CLIENT_SECRET, and MELI_REFRESH_TOKEN."
    );
  }

  private canRefresh(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.refreshToken);
  }

  private get clientId(): string | undefined {
    return this.env.MELI_CLIENT_ID || this.env.MELI_APP_ID || this.env.MERCADO_LIVRE_CLIENT_ID || this.storedAuth.client_id;
  }

  private get clientSecret(): string | undefined {
    return this.env.MELI_CLIENT_SECRET || this.env.MERCADO_LIVRE_CLIENT_SECRET || this.storedAuth.client_secret;
  }

  private async refresh(): Promise<void> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      refresh_token: this.refreshToken!
    });

    const response = await fetch(`${apiBaseUrl()}/oauth/token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent()
      },
      body
    });

    const data = await parseResponse(response);

    if (!response.ok) {
      throw new MercadoLivreApiError(
        `Mercado Livre token refresh failed with HTTP ${response.status}`,
        response.status,
        `${apiBaseUrl()}/oauth/token`,
        data
      );
    }

    const token = tokenRefreshResponseSchema.parse(data);
    await this.setToken(token);
  }

  async setToken(token: z.infer<typeof tokenRefreshResponseSchema>, auth: Partial<StoredAuth> = {}): Promise<void> {
    this.accessToken = token.access_token;
    this.refreshToken = token.refresh_token ?? this.refreshToken;
    this.expiresAtMs = Date.now() + token.expires_in * 1000;

    const nextAuth: StoredAuth = {
      ...this.storedAuth,
      ...auth,
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expires_at_ms: this.expiresAtMs,
      token_type: token.token_type,
      scope: token.scope,
      user_id: token.user_id,
      updated_at: new Date().toISOString()
    };

    await writeStoredAuth(nextAuth);
    this.storedAuth = nextAuth;
  }

  setupStatus(): Record<string, unknown> {
    const hasAccessToken = Boolean(this.accessToken);
    const hasClientId = Boolean(this.clientId);
    const hasClientSecret = Boolean(this.clientSecret);
    const hasRefreshToken = Boolean(this.refreshToken);
    const hasRefreshCredentials = hasClientId && hasClientSecret && hasRefreshToken;
    const persisted = Boolean(this.storedAuth.refresh_token || this.storedAuth.access_token);

    const missing: string[] = [];
    if (!hasAccessToken && !hasRefreshCredentials) {
      missing.push("Run meli_auth_connect");
      missing.push("or configure MELI_CLIENT_ID + MELI_CLIENT_SECRET + MELI_REFRESH_TOKEN");
    }

    return {
      ready: hasAccessToken || hasRefreshCredentials,
      auth_mode: persisted ? "stored_oauth" : hasRefreshCredentials ? "refresh_token_env" : hasAccessToken ? "access_token_env" : "missing",
      can_refresh: hasRefreshCredentials,
      credentials_present: {
        access_token: hasAccessToken,
        client_id: hasClientId,
        client_secret: hasClientSecret,
        refresh_token: hasRefreshToken,
        persisted_token_store: persisted
      },
      missing,
      token_store_path: tokenStorePath(),
      token_expires_at: Number.isFinite(this.expiresAtMs) && this.expiresAtMs > 0 ? new Date(this.expiresAtMs).toISOString() : null,
      user_id: this.storedAuth.user_id ?? null,
      recommended_setup:
        "Run meli_auth_connect once. The plugin stores OAuth tokens locally and automatically persists Mercado Livre's rotated refresh_token after every refresh.",
      api_base_url: apiBaseUrl(),
      timeout_ms: timeoutMs()
    };
  }
}

class MercadoLivreClient {
  constructor(private readonly tokenProvider: TokenProvider) {}

  async get(path: string, query: Query = {}): Promise<JsonData> {
    assertSafeApiPath(path);

    const url = new URL(path, apiBaseUrl());
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        const compactValues = value.filter((item) => item !== undefined && item !== null);
        if (compactValues.length === 0) continue;
        url.searchParams.set(key, compactValues.join(","));
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs());

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${await this.tokenProvider.getToken()}`,
          "User-Agent": userAgent()
        },
        signal: controller.signal
      });

      const data = await parseResponse(response);

      if (!response.ok) {
        throw new MercadoLivreApiError(
          `Mercado Livre API returned HTTP ${response.status}`,
          response.status,
          url.toString(),
          data
        );
      }

      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Mercado Livre API request timed out after ${timeoutMs()}ms: ${url.toString()}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

const tokenRefreshResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).optional()
});

const storedAuthSchema = z.object({
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  redirect_uri: z.string().optional(),
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_at_ms: z.number().optional(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  updated_at: z.string().optional()
});

const idSchema = z.union([z.string(), z.number()]).describe("Mercado Livre numeric or string id.");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const siteIdSchema = z.string().min(3).describe("Mercado Livre site id, for example MLB, MLA, or MLM.");
const itemIdSchema = z.string().min(3).describe("Mercado Livre item id, for example MLB123456789.");
const userProductIdSchema = z.string().min(3).describe("Mercado Livre user product id, for example MLAU123456789.");
const metricArraySchema = z.array(z.string().min(1)).optional();
const attributesSchema = z.array(z.string().min(1)).optional();
const paginationSchema = {
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional()
};

const tokenProvider = new TokenProvider(process.env);
await tokenProvider.initialize();
const api = new MercadoLivreClient(tokenProvider);

const server = new McpServer({
  name: "mercadolivre-mcp-server",
  version: "0.1.0"
}, {
  instructions: SERVER_INSTRUCTIONS
});

registerTool(
  "meli_setup_status",
  {
    title: "Mercado Livre Setup Status",
    description: "Check whether Mercado Livre credentials are available to this MCP server without calling the Mercado Livre API.",
    inputSchema: {}
  },
  async () => tokenProvider.setupStatus()
);

registerTool(
  "meli_auth_connect",
  {
    title: "Connect Mercado Livre OAuth",
    description:
      "Guided OAuth setup. Opens the Mercado Livre authorization URL, exchanges the authorization code, and stores tokens locally for automatic refresh-token rotation.",
    inputSchema: {}
  },
  async () => runInteractiveOAuthConnect()
);

registerTool(
  "meli_auth_logout",
  {
    title: "Disconnect Mercado Livre OAuth",
    description: "Delete locally stored Mercado Livre OAuth tokens for this plugin.",
    inputSchema: {}
  },
  async () => {
    await rm(tokenStorePath(), { force: true });
    return {
      disconnected: true,
      token_store_path: tokenStorePath()
    };
  }
);

registerTool(
  "meli_get_advertisers",
  {
    title: "Get Mercado Ads Advertisers",
    description: "Read advertisers available to the authenticated user for a Mercado Ads product. Defaults to Product Ads (PADS).",
    inputSchema: {
      product_id: z.string().optional().describe("Mercado Ads product id. Defaults to PADS.")
    }
  },
  async ({ product_id }) => api.get("/advertising/advertisers", { product_id: product_id ?? "PADS" })
);

registerTool(
  "meli_get_product_ad",
  {
    title: "Get Product Ad Detail And Metrics",
    description: "Read Product Ads ad detail, optionally with metrics for a date range.",
    inputSchema: {
      site_id: siteIdSchema,
      item_id: itemIdSchema,
      date_from: dateSchema.optional(),
      date_to: dateSchema.optional(),
      metrics: metricArraySchema.describe("Metrics to request. Defaults to the Product Ads metrics documented by Mercado Livre."),
      aggregation_type: z.string().optional().describe("Optional aggregation type, for example DAILY.")
    }
  },
  async ({ site_id, item_id, date_from, date_to, metrics, aggregation_type }) =>
    api.get(`/advertising/${site_id}/product_ads/ads/${item_id}`, {
      date_from,
      date_to,
      metrics: metricsForRequest(metrics, PRODUCT_ADS_METRICS, Boolean(date_from || date_to)),
      aggregation_type
    })
);

registerTool(
  "meli_search_product_ad_campaigns",
  {
    title: "Search Product Ads Campaigns",
    description: "Search Product Ads campaigns for an advertiser, optionally including campaign metrics.",
    inputSchema: {
      site_id: siteIdSchema,
      advertiser_id: idSchema,
      ...paginationSchema,
      date_from: dateSchema.optional(),
      date_to: dateSchema.optional(),
      metrics: metricArraySchema.describe("Metrics to request. Defaults to the campaign metrics documented by Mercado Livre."),
      aggregation_type: z.string().optional().describe("Optional aggregation type, for example DAILY."),
      metrics_summary: z.boolean().optional().describe("When true, request a metrics summary if supported by the API.")
    }
  },
  async ({ site_id, advertiser_id, limit, offset, date_from, date_to, metrics, aggregation_type, metrics_summary }) =>
    api.get(`/advertising/${site_id}/advertisers/${advertiser_id}/product_ads/campaigns/search`, {
      limit,
      offset,
      date_from,
      date_to,
      metrics: metricsForRequest(metrics, PRODUCT_ADS_CAMPAIGN_METRICS, Boolean(date_from || date_to)),
      aggregation_type,
      metrics_summary
    })
);

registerTool(
  "meli_get_product_ad_campaign",
  {
    title: "Get Product Ads Campaign Detail And Metrics",
    description: "Read Product Ads campaign detail, optionally with metrics for a date range.",
    inputSchema: {
      site_id: siteIdSchema,
      campaign_id: idSchema,
      date_from: dateSchema.optional(),
      date_to: dateSchema.optional(),
      metrics: metricArraySchema.describe("Metrics to request. Defaults to the campaign metrics documented by Mercado Livre."),
      aggregation_type: z.string().optional().describe("Optional aggregation type, for example DAILY.")
    }
  },
  async ({ site_id, campaign_id, date_from, date_to, metrics, aggregation_type }) =>
    api.get(`/advertising/${site_id}/product_ads/campaigns/${campaign_id}`, {
      date_from,
      date_to,
      metrics: metricsForRequest(metrics, PRODUCT_ADS_CAMPAIGN_METRICS, Boolean(date_from || date_to)),
      aggregation_type
    })
);

registerTool(
  "meli_search_product_ads",
  {
    title: "Search Product Ads",
    description: "Search Product Ads ads for an advertiser, optionally including ad metrics.",
    inputSchema: {
      site_id: siteIdSchema,
      advertiser_id: idSchema,
      ...paginationSchema,
      date_from: dateSchema.optional(),
      date_to: dateSchema.optional(),
      metrics: metricArraySchema.describe("Metrics to request. Defaults to the Product Ads metrics documented by Mercado Livre."),
      aggregation_type: z.string().optional().describe("Optional aggregation type, for example DAILY."),
      metrics_summary: z.boolean().optional().describe("When true, request a metrics summary if supported by the API.")
    }
  },
  async ({ site_id, advertiser_id, limit, offset, date_from, date_to, metrics, aggregation_type, metrics_summary }) =>
    api.get(`/advertising/${site_id}/advertisers/${advertiser_id}/product_ads/ads/search`, {
      limit,
      offset,
      date_from,
      date_to,
      metrics: metricsForRequest(metrics, PRODUCT_ADS_METRICS, Boolean(date_from || date_to)),
      aggregation_type,
      metrics_summary
    })
);

registerTool(
  "meli_get_seller_reputation",
  {
    title: "Get Seller Reputation",
    description: "Read /users/{user_id}. The response includes seller_reputation when available.",
    inputSchema: {
      user_id: idSchema,
      attributes: attributesSchema.describe("Optional response fields, for example seller_reputation,status,nickname.")
    }
  },
  async ({ user_id, attributes }) => api.get(`/users/${user_id}`, { attributes })
);

registerTool(
  "meli_get_item_publication_quality",
  {
    title: "Get Item Publication Quality",
    description: "Read publication quality from /item/{item_id}/performance.",
    inputSchema: {
      item_id: itemIdSchema
    }
  },
  async ({ item_id }) => api.get(`/item/${item_id}/performance`)
);

registerTool(
  "meli_get_user_product_quality",
  {
    title: "Get User Product Publication Quality",
    description: "Read publication quality from /user-product/{user_product_id}/performance.",
    inputSchema: {
      user_product_id: userProductIdSchema
    }
  },
  async ({ user_product_id }) => api.get(`/user-product/${user_product_id}/performance`)
);

registerTool(
  "meli_get_purchase_experience_by_item",
  {
    title: "Get Purchase Experience By Item",
    description: "Read purchase experience signals for an item from /reputation/items/{item_id}/purchase_experience/integrators.",
    inputSchema: {
      item_id: itemIdSchema,
      locale: z.string().optional().describe("Optional locale, for example pt_BR or es_AR.")
    }
  },
  async ({ item_id, locale }) => api.get(`/reputation/items/${item_id}/purchase_experience/integrators`, { locale })
);

registerTool(
  "meli_get_purchase_experience_by_user_product",
  {
    title: "Get Purchase Experience By User Product",
    description:
      "Read purchase experience signals for a user product. The docs show user_products in the template and users_products in one example; route_variant lets you choose.",
    inputSchema: {
      user_product_id: userProductIdSchema,
      locale: z.string().optional().describe("Optional locale, for example pt_BR or es_AR."),
      route_variant: z
        .enum(["user_products", "users_products"])
        .optional()
        .describe("Defaults to the documented template route: user_products.")
    }
  },
  async ({ user_product_id, locale, route_variant }) =>
    api.get(`/reputation/${route_variant ?? "user_products"}/${user_product_id}/purchase_experience/integrators`, {
      locale
    })
);

registerTool(
  "meli_get_catalog_quality_status",
  {
    title: "Get Catalog Attribute Completeness",
    description:
      "Read catalog_quality/status for a seller or item. Use seller_id for seller-level status or item_id for a single listing.",
    inputSchema: {
      seller_id: idSchema.optional(),
      item_id: itemIdSchema.optional(),
      include_items: z.boolean().optional().describe("Seller query only. Include item-level data in the response."),
      version: z.number().int().positive().optional().describe("API version query parameter. Defaults to 32 for seller_id and 3 for item_id.")
    }
  },
  async ({ seller_id, item_id, include_items, version }) => {
    if ((seller_id && item_id) || (!seller_id && !item_id)) {
      throw new Error("Provide exactly one of seller_id or item_id.");
    }

    if (seller_id) {
      return api.get("/catalog_quality/status", {
        seller_id,
        include_items,
        v: version ?? 32
      });
    }

    return api.get("/catalog_quality/status", {
      item_id,
      v: version ?? 3
    });
  }
);

registerTool(
  "meli_get_items_with_lost_exposure",
  {
    title: "Get Items With Lost Exposure",
    description: "Read item ids from /users/{user_id}/items/search?reputation_health_gauge=unhealthy.",
    inputSchema: {
      user_id: idSchema,
      ...paginationSchema
    }
  },
  async ({ user_id, limit, offset }) =>
    api.get(`/users/${user_id}/items/search`, {
      reputation_health_gauge: "unhealthy",
      limit,
      offset
    })
);

registerTool(
  "meli_search_user_items",
  {
    title: "Search User Items",
    description: "Read item ids from /users/{user_id}/items/search with common filters.",
    inputSchema: {
      user_id: idSchema,
      ...paginationSchema,
      status: z.string().optional().describe("Optional item status, for example active."),
      sku: z.string().optional().describe("Filter by legacy seller custom field."),
      seller_sku: z.string().optional().describe("Filter by seller SKU."),
      listing_type_id: z.string().optional().describe("Filter by listing type, for example gold_pro."),
      missing_product_identifiers: z.boolean().optional(),
      include_filters: z.boolean().optional(),
      orders: z.string().optional().describe("Sort order, for example start_time_desc."),
      search_type: z.string().optional().describe("Use scan for deep pagination."),
      scroll_id: z.string().optional().describe("Scroll id returned by a previous scan request.")
    }
  },
  async ({
    user_id,
    limit,
    offset,
    status,
    sku,
    seller_sku,
    listing_type_id,
    missing_product_identifiers,
    include_filters,
    orders,
    search_type,
    scroll_id
  }) =>
    api.get(`/users/${user_id}/items/search`, {
      limit,
      offset,
      status,
      sku,
      seller_sku,
      listing_type_id,
      missing_product_identifiers,
      include_filters,
      orders,
      search_type,
      scroll_id
    })
);

registerTool(
  "meli_list_listing_exposures",
  {
    title: "List Listing Exposures",
    description: "Read listing exposure levels for a site from /sites/{site_id}/listing_exposures.",
    inputSchema: {
      site_id: siteIdSchema
    }
  },
  async ({ site_id }) => api.get(`/sites/${site_id}/listing_exposures`)
);

registerTool(
  "meli_get_listing_exposure",
  {
    title: "Get Listing Exposure",
    description: "Read a listing exposure level from /sites/{site_id}/listing_exposures/{exposure_level}.",
    inputSchema: {
      site_id: siteIdSchema,
      exposure_level: z.string().min(1).describe("Exposure level, for example high.")
    }
  },
  async ({ site_id, exposure_level }) => api.get(`/sites/${site_id}/listing_exposures/${exposure_level}`)
);

registerTool(
  "meli_list_site_listing_types",
  {
    title: "List Site Listing Types",
    description: "Read publication listing types for a site from /sites/{site_id}/listing_types.",
    inputSchema: {
      site_id: siteIdSchema
    }
  },
  async ({ site_id }) => api.get(`/sites/${site_id}/listing_types`)
);

registerTool(
  "meli_get_site_listing_type",
  {
    title: "Get Site Listing Type",
    description: "Read a publication listing type from /sites/{site_id}/listing_types/{listing_type_id}.",
    inputSchema: {
      site_id: siteIdSchema,
      listing_type_id: z.string().min(1).describe("Listing type id, for example gold_special.")
    }
  },
  async ({ site_id, listing_type_id }) => api.get(`/sites/${site_id}/listing_types/${listing_type_id}`)
);

registerTool(
  "meli_get_user_available_listing_types",
  {
    title: "Get User Available Listing Types",
    description: "Read available listing types for a user and category.",
    inputSchema: {
      user_id: idSchema,
      category_id: z.string().min(1)
    }
  },
  async ({ user_id, category_id }) =>
    api.get(`/users/${user_id}/available_listing_types`, {
      category_id
    })
);

registerTool(
  "meli_get_user_available_free_listing_type",
  {
    title: "Get User Available Free Listing Type",
    description: "Read the free listing type availability for a user and category.",
    inputSchema: {
      user_id: idSchema,
      category_id: z.string().min(1)
    }
  },
  async ({ user_id, category_id }) =>
    api.get(`/users/${user_id}/available_listing_type/free`, {
      category_id
    })
);

registerTool(
  "meli_get_item_available_listing_types",
  {
    title: "Get Item Available Listing Types",
    description: "Read available listing type changes for an item.",
    inputSchema: {
      item_id: itemIdSchema
    }
  },
  async ({ item_id }) => api.get(`/items/${item_id}/available_listing_types`)
);

registerTool(
  "meli_get_item_available_upgrades",
  {
    title: "Get Item Available Upgrades",
    description: "Read available listing upgrades for an item.",
    inputSchema: {
      item_id: itemIdSchema
    }
  },
  async ({ item_id }) => api.get(`/items/${item_id}/available_upgrades`)
);

registerTool(
  "meli_get_item_available_downgrades",
  {
    title: "Get Item Available Downgrades",
    description: "Read available listing downgrades for an item.",
    inputSchema: {
      item_id: itemIdSchema
    }
  },
  async ({ item_id }) => api.get(`/items/${item_id}/available_downgrades`)
);

registerTool(
  "meli_get_item_listing_type",
  {
    title: "Get Item Listing Type",
    description: "Read the current listing type for an item.",
    inputSchema: {
      item_id: itemIdSchema
    }
  },
  async ({ item_id }) => api.get(`/items/${item_id}/listing_type`)
);

registerTool(
  "meli_get_item",
  {
    title: "Get Item",
    description: "Read /items/{item_id}. Use attributes to limit returned fields such as id,price,category_id,title.",
    inputSchema: {
      item_id: itemIdSchema,
      attributes: attributesSchema
    }
  },
  async ({ item_id, attributes }) => api.get(`/items/${item_id}`, { attributes })
);

registerTool(
  "meli_get_item_description",
  {
    title: "Get Item Description",
    description: "Read /items/{item_id}/description.",
    inputSchema: {
      item_id: itemIdSchema
    }
  },
  async ({ item_id }) => api.get(`/items/${item_id}/description`)
);

registerTool(
  "meli_get_category",
  {
    title: "Get Category",
    description: "Read /categories/{category_id}.",
    inputSchema: {
      category_id: z.string().min(1)
    }
  },
  async ({ category_id }) => api.get(`/categories/${category_id}`)
);

registerTool(
  "meli_get_category_attributes",
  {
    title: "Get Category Attributes",
    description: "Read /categories/{category_id}/attributes.",
    inputSchema: {
      category_id: z.string().min(1)
    }
  },
  async ({ category_id }) => api.get(`/categories/${category_id}/attributes`)
);

registerTool(
  "meli_get_category_sale_terms",
  {
    title: "Get Category Sale Terms",
    description: "Read /categories/{category_id}/sale_terms.",
    inputSchema: {
      category_id: z.string().min(1)
    }
  },
  async ({ category_id }) => api.get(`/categories/${category_id}/sale_terms`)
);

registerTool(
  "meli_get_domain_technical_specs",
  {
    title: "Get Domain Technical Specs",
    description: "Read /domains/{domain_id}/technical_specs.",
    inputSchema: {
      domain_id: z.string().min(1)
    }
  },
  async ({ domain_id }) => api.get(`/domains/${domain_id}/technical_specs`)
);

registerTool(
  "meli_get",
  {
    title: "Raw Mercado Livre GET",
    description:
      "Read any Mercado Livre API relative path not yet represented by a named tool. Only relative paths are accepted, for example /users/123.",
    inputSchema: {
      path: z.string().startsWith("/").describe("Relative Mercado Livre API path."),
      query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).optional()
    }
  },
  async ({ path, query }) => api.get(path, query)
);

const transport = new StdioServerTransport();
await server.connect(transport);

function registerTool(
  name: string,
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodRawShape;
  },
  handler: (args: Record<string, any>) => Promise<JsonData>
): void {
  server.registerTool(name, config, async (args) => {
    try {
      const data = await handler(args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatError(error)
          }
        ]
      };
    }
  });
}

function metricsForRequest(metrics: string[] | undefined, defaults: readonly string[], includeDefaults: boolean): string[] | undefined {
  if (metrics && metrics.length > 0) {
    return metrics;
  }

  return includeDefaults ? [...defaults] : undefined;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatError(error: unknown): string {
  if (error instanceof MercadoLivreApiError) {
    return JSON.stringify(
      {
        error: error.message,
        status: error.status,
        url: error.url,
        details: error.details
      },
      null,
      2
    );
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function assertSafeApiPath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error("Only relative Mercado Livre API paths are allowed.");
  }

  if (path.startsWith("//")) {
    throw new Error("Protocol-relative URLs are not allowed.");
  }

  if (/^\/?https?:\/\//i.test(path)) {
    throw new Error("Absolute URLs are not allowed.");
  }
}

function apiBaseUrl(): string {
  return process.env.MELI_API_BASE_URL || process.env.MERCADO_LIVRE_API_BASE_URL || DEFAULT_API_BASE_URL;
}

function timeoutMs(): number {
  const raw = process.env.MELI_TIMEOUT_MS || process.env.MERCADO_LIVRE_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function userAgent(): string {
  return process.env.MELI_USER_AGENT || "mercadolivre-mcp-server/0.1.0";
}

async function runInteractiveOAuthConnect(): Promise<Record<string, unknown>> {
  const credentials = await server.server.elicitInput({
    mode: "form",
    message:
      "Enter your Mercado Livre application credentials. These are stored locally so the plugin can refresh and rotate tokens automatically.",
    requestedSchema: {
      type: "object",
      properties: {
        client_id: {
          type: "string",
          title: "Client ID / App ID",
          minLength: 1
        },
        client_secret: {
          type: "string",
          title: "Client Secret",
          minLength: 1
        },
        redirect_uri: {
          type: "string",
          title: "Redirect URI",
          description: "Must exactly match the redirect URI configured in your Mercado Livre app.",
          minLength: 1
        },
        auth_base_url: {
          type: "string",
          title: "Authorization host",
          default: authBaseUrl(),
          minLength: 1
        }
      },
      required: ["client_id", "client_secret", "redirect_uri"]
    }
  });

  if (credentials.action !== "accept") {
    return { connected: false, reason: "OAuth setup was cancelled." };
  }

  const clientId = nonEmptyString(credentials.content?.client_id, "client_id");
  const clientSecret = nonEmptyString(credentials.content?.client_secret, "client_secret");
  const redirectUri = nonEmptyString(credentials.content?.redirect_uri, "redirect_uri");
  const authBase = nonEmptyString(credentials.content?.auth_base_url ?? authBaseUrl(), "auth_base_url");
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64Url(crypto.randomBytes(16));
  const authorizationUrl = buildAuthorizationUrl(authBase, clientId, redirectUri, challenge, state);

  try {
    await server.server.elicitInput({
      mode: "url",
      elicitationId: `meli-oauth-${Date.now()}`,
      message: "Sign in to Mercado Livre and authorize this app. Return here after the browser redirects.",
      url: authorizationUrl
    });
  } catch {
    // Some MCP clients do not support URL elicitation. The next form includes the URL.
  }

  const codeResult = await server.server.elicitInput({
    mode: "form",
    message: `After authorizing Mercado Livre, paste the full redirected URL or just the code parameter. Authorization URL: ${authorizationUrl}`,
    requestedSchema: {
      type: "object",
      properties: {
        redirected_url_or_code: {
          type: "string",
          title: "Redirected URL or code",
          minLength: 1
        }
      },
      required: ["redirected_url_or_code"]
    }
  });

  if (codeResult.action !== "accept") {
    return { connected: false, reason: "Authorization code entry was cancelled." };
  }

  const parsed = parseAuthorizationCode(nonEmptyString(codeResult.content?.redirected_url_or_code, "redirected_url_or_code"));
  if (parsed.state && parsed.state !== state) {
    throw new Error("Mercado Livre OAuth state did not match. Restart meli_auth_connect.");
  }

  const token = await exchangeAuthorizationCode({
    clientId,
    clientSecret,
    redirectUri,
    code: parsed.code,
    codeVerifier: verifier
  });

  await tokenProvider.setToken(token, {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri
  });

  return {
    connected: true,
    auth_mode: "stored_oauth",
    user_id: token.user_id ?? null,
    token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    token_store_path: tokenStorePath(),
    note: "Mercado Livre refresh tokens are single-use. This plugin will persist the new refresh_token after every automatic refresh."
  };
}

async function exchangeAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<z.infer<typeof tokenRefreshResponseSchema>> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier
  });

  const response = await fetch(`${apiBaseUrl()}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent()
    },
    body
  });

  const data = await parseResponse(response);
  if (!response.ok) {
    throw new MercadoLivreApiError(
      `Mercado Livre authorization code exchange failed with HTTP ${response.status}`,
      response.status,
      `${apiBaseUrl()}/oauth/token`,
      data
    );
  }

  return tokenRefreshResponseSchema.parse(data);
}

function buildAuthorizationUrl(authBase: string, clientId: string, redirectUri: string, challenge: string, state: string): string {
  const url = new URL("/authorization", authBase);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function parseAuthorizationCode(value: string): { code: string; state?: string } {
  try {
    const url = new URL(value);
    const code = url.searchParams.get("code");
    if (!code) {
      throw new Error("Missing code query parameter.");
    }
    return {
      code,
      state: url.searchParams.get("state") ?? undefined
    };
  } catch {
    return { code: value.trim() };
  }
}

async function readStoredAuth(): Promise<StoredAuth> {
  try {
    const raw = await readFile(tokenStorePath(), "utf8");
    return storedAuthSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeStoredAuth(auth: StoredAuth): Promise<void> {
  const filePath = tokenStorePath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
}

function tokenStorePath(): string {
  if (process.env.MELI_TOKEN_STORE_PATH) {
    return process.env.MELI_TOKEN_STORE_PATH;
  }

  const pluginData = process.env.PLUGIN_DATA || process.env.CODEX_PLUGIN_DATA;
  if (pluginData) {
    return path.join(pluginData, "mercado-livre-auth.json");
  }

  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "mercado-livre-mcp", "auth.json");
}

function authBaseUrl(): string {
  return process.env.MELI_AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL;
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
