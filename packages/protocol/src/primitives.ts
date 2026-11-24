import * as v from "valibot";
export const errorCodes = [
  "invalid_request",
  "not_registered",
  "invite_rejected",
  "device_not_found",
  "path_outside_root",
  "path_not_found",
  "not_a_file",
  "not_a_directory",
  "not_git_repository",
  "git_failed",
  "permission_denied",
  "read_failed",
  "put_failed",
  "put_not_a_file",
  "put_exists",
  "file_conflict",
  "internal_error",
  "host_uninstalling",
] as const;

export type ProtocolErrorCode = (typeof errorCodes)[number];
export class ProtocolValidationError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = "ProtocolValidationError";
    this.code = code;
  }
}

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameError";
  }
}

export interface ValueSchema<T> {
  parse(value: unknown): T;
}

export function fail(message: string): never {
  throw new ProtocolValidationError("invalid_request", message);
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("expected object");
  }
  return value as Record<string, unknown>;
}

export function string(value: unknown, field: string): string {
  if (typeof value !== "string") return fail(`${field} must be a string`);
  return value;
}

export function nonEmptyString(value: unknown, field: string): string {
  const parsed = string(value, field);
  if (parsed.length === 0) return fail(`${field} must not be empty`);
  return parsed;
}

export function hostPath(value: unknown, field: string): string {
  const parsed = nonEmptyString(value, field);
  if (
    parsed.includes("\0") ||
    (!parsed.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/u.test(parsed) &&
      !/^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/u.test(parsed))
  ) {
    return fail(`${field} must be an absolute path`);
  }
  return parsed;
}

export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") return fail(`${field} must be a boolean`);
  return value;
}

export function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(`${field} must be a non-negative integer`);
  }
  return value;
}

export function decoded<T>(parse: (value: unknown) => T) {
  return v.pipe(v.unknown(), v.transform(parse));
}

export function parseValue<S extends v.GenericSchema>(
  definition: S,
  value: unknown,
): v.InferOutput<S> {
  try {
    const parsed = v.safeParse(definition, value, { abortEarly: true });
    if (parsed.success) return parsed.output;
  } catch (error) {
    if (error instanceof ProtocolValidationError) throw error;
  }
  // Library issue messages may include the input (a token or invite secret).
  return fail("Invalid protocol value");
}
export function schema<T>(
  definition: v.GenericSchema<unknown, T>,
): ValueSchema<T> {
  return { parse: (value) => parseValue(definition, value) };
}
export const identifier = v.pipe(v.string(), v.nonEmpty());
export const pathSchema = decoded((value) => hostPath(value, "path"));
export const integer = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  v.pipe(v.number(), v.safeInteger(), v.minValue(min), v.maxValue(max));
export const chunkBase64 = v.pipe(
  v.string(),
  v.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
);

export const emptyParams = decoded((value): Record<string, never> => {
  record(value);
  return {};
});

// Each entry is also its public result schema, so both lookups use the same keys.
export function method<S extends v.GenericSchema, R>(
  params: S,
  result: ValueSchema<R>,
) {
  return { params, parse: result.parse };
}

// The registered Host produced these results. Keep its data, including fields
// this Client does not know.
export function hostResult<T>(): ValueSchema<T> {
  return { parse: (value) => value as T };
}

type Method = { params: v.GenericSchema } & ValueSchema<unknown>;
export type Params<T extends Record<string, Method>> = {
  [K in keyof T]: v.InferOutput<T[K]["params"]>;
};
export type Results<T extends Record<string, Method>> = {
  [K in keyof T]: ReturnType<T[K]["parse"]>;
};
export type ResultSchemas<R> = { [K in keyof R]: ValueSchema<R[K]> };
export function hasMethod<T extends Record<string, Method>>(
  table: T,
  key: unknown,
): key is Extract<keyof T, string> {
  return typeof key === "string" && Object.hasOwn(table, key);
}

export function paramsOf<P, K extends keyof P>(
  table: { [M in keyof P]: { params: v.GenericSchema<unknown, P[M]> } },
  key: K,
  value: unknown,
): P[K] {
  return parseValue(table[key].params, record(value));
}
export const nonNulText = v.pipe(
  identifier,
  v.check((value) => !value.includes("\0")),
);
export function readable<T>(
  parse: (value: unknown) => T,
  value: unknown,
): T | undefined {
  try {
    return parse(value);
  } catch {
    return undefined;
  }
}
export function readableItems<T>(
  parse: (value: unknown) => T,
  values: unknown[],
): T[] {
  return values.flatMap((value) => {
    const item = readable(parse, value);
    return item === undefined ? [] : [item];
  });
}
