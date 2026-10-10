// lib/server/http.ts — §31. Uniform API responses and error handling.
//
// Rules enforced here:
//  - Clients get a stable shape: { ok, data } or { ok:false, error, code }.
//  - Clients get a SAFE message. Stack traces, SQL and Prisma internals are
//    logged server-side and never serialised into a response.
//  - Validation failures come back as field-keyed errors the UI can render
//    next to the offending input.

import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { Prisma } from './prisma';
import { isProd } from './env';

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = {
  ok: false;
  error: string;
  code: string;
  fields?: Record<string, string[]>;
};

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiOk<T>>({ ok: true, data }, init);
}

export function created<T>(data: T) {
  return ok(data, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

/** A deliberate, client-safe error. Anything thrown that is NOT one of these
 *  is treated as a bug and reported as a generic 500. */
export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string[]>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (msg = 'Invalid request', fields?: Record<string, string[]>) =>
  new ApiError(400, 'BAD_REQUEST', msg, fields);
export const unauthorized = (msg = 'You need to sign in to continue.') =>
  new ApiError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have access to this resource.') =>
  new ApiError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found') => new ApiError(404, 'NOT_FOUND', msg);
export const conflict = (msg = 'That conflicts with the current state.') =>
  new ApiError(409, 'CONFLICT', msg);
export const gone = (msg = 'No longer available') => new ApiError(410, 'GONE', msg);
export const unprocessable = (msg: string, fields?: Record<string, string[]>) =>
  new ApiError(422, 'UNPROCESSABLE', msg, fields);
export const tooManyRequests = (msg = 'Too many attempts. Please wait and try again.') =>
  new ApiError(429, 'RATE_LIMITED', msg);
export const serverError = (msg = 'Something went wrong on our end.') =>
  new ApiError(500, 'SERVER_ERROR', msg);
export const serviceUnavailable = (msg: string) => new ApiError(503, 'UNAVAILABLE', msg);

function zodFields(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Wrap every route handler with this. It converts thrown errors into correct
 * HTTP responses and guarantees nothing sensitive escapes.
 */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse> | NextResponse,
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await fn(...args);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export function toErrorResponse(err: unknown): NextResponse<ApiErr> {
  // 1. Deliberate, safe-to-show errors.
  if (err instanceof ApiError) {
    return NextResponse.json<ApiErr>(
      { ok: false, error: err.message, code: err.code, ...(err.fields ? { fields: err.fields } : {}) },
      { status: err.status },
    );
  }

  // 2. Validation.
  if (err instanceof ZodError) {
    return NextResponse.json<ApiErr>(
      {
        ok: false,
        error: 'Please check the highlighted fields.',
        code: 'VALIDATION_ERROR',
        fields: zodFields(err),
      },
      { status: 422 },
    );
  }

  // 3. Known database failures → friendly messages, no schema leakage.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const target = (err.meta as { target?: string[] } | undefined)?.target;
        const field = Array.isArray(target) ? target[target.length - 1] : undefined;
        return NextResponse.json<ApiErr>(
          {
            ok: false,
            error: field
              ? `That ${humanField(field)} is already in use.`
              : 'That record already exists.',
            code: 'DUPLICATE',
          },
          { status: 409 },
        );
      }
      case 'P2003':
        return NextResponse.json<ApiErr>(
          { ok: false, error: 'A related record is missing.', code: 'FK_VIOLATION' },
          { status: 409 },
        );
      case 'P2025':
        return NextResponse.json<ApiErr>(
          { ok: false, error: 'Not found.', code: 'NOT_FOUND' },
          { status: 404 },
        );
      case 'P2034':
        return NextResponse.json<ApiErr>(
          {
            ok: false,
            error: 'That was busy — please try again.',
            code: 'TX_CONFLICT',
          },
          { status: 409 },
        );
    }
    console.error('[prisma]', err.code, err.message);
    return NextResponse.json<ApiErr>(
      { ok: false, error: 'We could not complete that request.', code: 'DB_ERROR' },
      { status: 500 },
    );
  }

  // 4. A CHECK constraint fired — e.g. stock would have gone negative. That is
  //    the database refusing to let us oversell; report it as a conflict.
  const raw = String((err as { message?: string })?.message ?? '');
  if (raw.includes('inventory_available_nonneg') || raw.includes('inventory_onhand_nonneg')) {
    return NextResponse.json<ApiErr>(
      {
        ok: false,
        error: 'Someone just took the last of that stock. Please review your cart.',
        code: 'OUT_OF_STOCK',
      },
      { status: 409 },
    );
  }

  // 5. Genuine bug. Log everything, tell the client nothing.
  console.error('[unhandled]', err);
  return NextResponse.json<ApiErr>(
    {
      ok: false,
      error: 'Something went wrong on our end. Please try again.',
      code: 'SERVER_ERROR',
      ...(isProd ? {} : { fields: { _debug: [raw.slice(0, 500)] } }),
    },
    { status: 500 },
  );
}

function humanField(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
}

// Both helpers below are generic over the SCHEMA, not over the parsed type, and
// return `z.infer<S>` — the schema's OUTPUT.
//
// The obvious-looking `<T>(req, schema: ZodSchema<T>): T` is wrong, and wrong in
// a way that only shows up on schemas with `.default()`, `.coerce` or
// `.transform()`. `ZodSchema<Output, Def, Input>` defaults `Input = Output`, so
// writing `ZodSchema<T>` asserts the two are the same type. For
// `paginationSchema` they are not: its output is `{ page: number; perPage:
// number }` but its input is `{ page?: unknown; perPage?: unknown }`, because
// both fields have defaults. TypeScript then has to satisfy T from both
// positions at once and settles on the optional input shape, so every caller
// destructuring `const { page } = parseQuery(...)` gets `number | undefined`
// and `(page - 1) * perPage` fails to compile.
//
// `S extends ZodTypeAny` plus `z.infer<S>` reads the output slot only, which is
// what `schema.parse()` actually returns at runtime.

/** Parse + validate a JSON body. Throws a 422 with field errors on failure. */
export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
  return schema.parse(json) as z.infer<S>;
}

/** Parse + validate query params. */
export function parseQuery<S extends ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    raw[k] = v;
  });
  return schema.parse(raw) as z.infer<S>;
}
