/**
 * Shared HTTP concerns for the v1 API: error shape, authentication, rate
 * limiting and idempotency. Route handlers stay thin by delegating all of it
 * here through `handle`.
 */

import { NextResponse } from "next/server";

import { findApiKey, getStore } from "./store";
import { IntentError } from "./intents";
import { QuoteError } from "@/lib/router";
import { QrisBuildError, QrisParseError } from "@/lib/qris";

export interface ApiErrorBody {
  error: { type: string; code: string; message: string; param?: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
    readonly param?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  const { status, code, message, type, param } = classify(error);
  return NextResponse.json({ error: { type, code, message, param } }, { status });
}

function classify(error: unknown): {
  status: number;
  code: string;
  message: string;
  type: string;
  param?: string;
} {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      type: error.status >= 500 ? "api_error" : "invalid_request_error",
      param: error.param,
    };
  }
  if (error instanceof IntentError) {
    return { status: error.status, code: error.code, message: error.message, type: "intent_error" };
  }
  if (error instanceof QuoteError) {
    return { status: 400, code: error.code, message: error.message, type: "quote_error" };
  }
  if (error instanceof QrisParseError) {
    return { status: 422, code: error.code, message: error.message, type: "qris_error" };
  }
  if (error instanceof QrisBuildError) {
    return { status: 400, code: "build_failed", message: error.message, type: "qris_error" };
  }
  if (error instanceof SyntaxError) {
    return {
      status: 400,
      code: "invalid_json",
      message: "request body is not valid JSON",
      type: "invalid_request_error",
    };
  }
  return {
    status: 500,
    code: "internal_error",
    message: (error as Error)?.message ?? "unexpected error",
    type: "api_error",
  };
}

export interface HandlerContext {
  /** Merchant resolved from the API key, when one was supplied. */
  merchantId?: string;
}

export interface HandleOptions {
  /** Reject the request unless a valid API key is present. */
  requireAuth?: boolean;
  /** Requests per minute allowed from one caller. */
  rateLimit?: number;
  /** Honour an Idempotency-Key header, replaying the stored response. */
  idempotent?: boolean;
}

/**
 * Wraps a route handler with the cross-cutting concerns. Returns a function
 * with the signature Next.js expects.
 */
export async function handle(
  request: Request,
  options: HandleOptions,
  fn: (context: HandlerContext) => Promise<NextResponse> | NextResponse,
): Promise<NextResponse> {
  try {
    const context: HandlerContext = {};

    const apiKey = readBearer(request);
    if (apiKey) {
      const record = findApiKey(apiKey);
      if (!record) throw new ApiError("invalid API key", "invalid_api_key", 401);
      record.lastUsedAt = Date.now();
      context.merchantId = record.merchantId;
    } else if (options.requireAuth) {
      throw new ApiError(
        "missing API key — send it as `Authorization: Bearer cq_test_…`",
        "missing_api_key",
        401,
      );
    }

    const limit = options.rateLimit ?? 120;
    const identity = apiKey ?? clientIp(request);
    if (!consumeToken(identity, limit)) {
      throw new ApiError(`rate limit of ${limit} requests/minute exceeded`, "rate_limited", 429);
    }

    const idempotencyKey = options.idempotent
      ? request.headers.get("idempotency-key") ?? undefined
      : undefined;
    if (idempotencyKey) {
      const cached = getStore().idempotency.get(`${identity}:${idempotencyKey}`);
      if (cached) {
        return NextResponse.json(cached.body, {
          status: cached.status,
          headers: { "idempotent-replay": "true" },
        });
      }
    }

    const response = await fn(context);

    if (idempotencyKey && response.status < 500) {
      const body = await response.clone().json();
      getStore().idempotency.set(`${identity}:${idempotencyKey}`, {
        status: response.status,
        body,
        createdAt: Date.now(),
      });
    }
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

function readBearer(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return undefined;
  const value = header.slice(7).trim();
  return value || undefined;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}

/** Token bucket refilling continuously over a one-minute window. */
function consumeToken(identity: string, perMinute: number): boolean {
  const store = getStore();
  const now = Date.now();
  const bucket = store.rateLimit.get(identity) ?? { tokens: perMinute, updatedAt: now };

  const refill = ((now - bucket.updatedAt) / 60_000) * perMinute;
  const tokens = Math.min(perMinute, bucket.tokens + refill);

  if (tokens < 1) {
    store.rateLimit.set(identity, { tokens, updatedAt: now });
    return false;
  }
  store.rateLimit.set(identity, { tokens: tokens - 1, updatedAt: now });
  return true;
}

/** Reads and validates a JSON body against a small set of field expectations. */
export async function readJson<T extends Record<string, unknown>>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(`"${field}" is required and must be a non-empty string`, "missing_param", 400, field);
  }
  return value;
}

export function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new ApiError(`"${field}" must be a number`, "invalid_param", 400, field);
  }
  return parsed;
}

export function optionalStringArray(
  body: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ApiError(`"${field}" must be an array of strings`, "invalid_param", 400, field);
  }
  return value as string[];
}
