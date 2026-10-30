import { MAX_JSON_DEPTH } from "./constants";

export type CanonicalJsonPrimitive = null | boolean | number | string;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

export class CanonicalJsonError extends Error {
  public readonly code = "HASH_INPUT_INVALID" as const;
  public readonly path: string;

  public constructor(message: string, path = "$") {
    super(message);
    this.name = "CanonicalJsonError";
    this.path = path;
  }
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function canonicalize(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
): string {
  if (depth > MAX_JSON_DEPTH) {
    throw new CanonicalJsonError(
      `Maximum JSON depth ${MAX_JSON_DEPTH} exceeded.`,
      path,
    );
  }

  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return quote(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(
          "Only finite JSON numbers are allowed.",
          path,
        );
      }
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "undefined":
    case "bigint":
    case "symbol":
    case "function":
      throw new CanonicalJsonError(
        `Non-JSON value of type ${typeof value} is not allowed.`,
        path,
      );
    case "object":
      break;
    default:
      throw new CanonicalJsonError("Unsupported value.", path);
  }

  if (ancestors.has(value)) {
    throw new CanonicalJsonError(
      "Circular references are not valid JSON.",
      path,
    );
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new CanonicalJsonError(
            "Sparse arrays are not allowed.",
            `${path}[${index}]`,
          );
        }
        items.push(
          canonicalize(value[index], `${path}[${index}]`, depth + 1, ancestors),
        );
      }
      return `[${items.join(",")}]`;
    }

    if (!isPlainRecord(value)) {
      throw new CanonicalJsonError(
        "Only plain JSON objects are allowed.",
        path,
      );
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new CanonicalJsonError("Symbol keys are not valid JSON.", path);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    const properties: string[] = [];

    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined) {
        continue;
      }
      if ("get" in descriptor || "set" in descriptor) {
        throw new CanonicalJsonError(
          "Accessor properties are not allowed.",
          `${path}.${key}`,
        );
      }
      if (!descriptor.enumerable) {
        throw new CanonicalJsonError(
          "Non-enumerable properties are not valid JSON.",
          `${path}.${key}`,
        );
      }
      properties.push(
        `${quote(key)}:${canonicalize(descriptor.value, `${path}.${key}`, depth + 1, ancestors)}`,
      );
    }

    return `{${properties.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, "$", 0, new WeakSet<object>());
}

export function canonicalJsonByteLength(value: unknown): number {
  return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

const SHA_256_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
]);

const SHA_256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = BigInt(bytes.byteLength) * 8n;
  const totalLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(totalLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;

  for (let index = 0; index < 8; index += 1) {
    const shift = BigInt((7 - index) * 8);
    padded[totalLength - 8 + index] = Number((bitLength >> shift) & 0xffn);
  }

  const hash = new Uint32Array(SHA_256_INITIAL);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] =
        ((padded[wordOffset] ?? 0) << 24) |
        ((padded[wordOffset + 1] ?? 0) << 16) |
        ((padded[wordOffset + 2] ?? 0) << 8) |
        (padded[wordOffset + 3] ?? 0);
    }

    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0;
      const previous2 = words[index - 2] ?? 0;
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3);
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) +
          sigma0 +
          (words[index - 7] ?? 0) +
          sigma1) >>>
        0;
    }

    let a = hash[0] ?? 0;
    let b = hash[1] ?? 0;
    let c = hash[2] ?? 0;
    let d = hash[3] ?? 0;
    let e = hash[4] ?? 0;
    let f = hash[5] ?? 0;
    let g = hash[6] ?? 0;
    let h = hash[7] ?? 0;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h +
          sum1 +
          choice +
          (SHA_256_CONSTANTS[index] ?? 0) +
          (words[index] ?? 0)) >>>
        0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    hash[0] = ((hash[0] ?? 0) + a) >>> 0;
    hash[1] = ((hash[1] ?? 0) + b) >>> 0;
    hash[2] = ((hash[2] ?? 0) + c) >>> 0;
    hash[3] = ((hash[3] ?? 0) + d) >>> 0;
    hash[4] = ((hash[4] ?? 0) + e) >>> 0;
    hash[5] = ((hash[5] ?? 0) + f) >>> 0;
    hash[6] = ((hash[6] ?? 0) + g) >>> 0;
    hash[7] = ((hash[7] ?? 0) + h) >>> 0;
  }

  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join(
    "",
  );
}

export function hashCanonicalJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
