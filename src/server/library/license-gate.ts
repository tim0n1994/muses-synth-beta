/**
 * Open Library license gate (v0.7 batch 1, B path).
 *
 * V5: 曲库来源只收 CC0 和 CC-BY — every track must carry the four license
 * fields (license, license_url, author, source_url) plus a forensic snapshot
 * (取证快照) captured at ingestion time. 缺任何一项就拒绝入库。
 *
 * This module is the single authoritative validator: the ingestion pipeline
 * (scripts/library/ingest.mts) and the unit tests both import it. The pilot
 * candidate research (freeside /tmp/v07-candidates.json, 2026-10-20) applied
 * the same whitelist: final 255 candidates = CC-BY 4.0 ×164, CC-BY 3.0 ×54,
 * CC-BY 2.5 ×23, CC0 1.0 ×14; NC/ND/SA/Sampling/Pixabay all zero.
 */

/** License names accepted by the gate. Anything else is rejected. */
export const ALLOWED_LICENSES: readonly string[] = [
  "CC0 1.0",
  "CC-BY 2.5",
  "CC-BY 3.0",
  "CC-BY 4.0",
] as const;

/** Host+path whitelist (scheme stripped before matching). */
const LICENSE_URL_PATTERN =
  /^creativecommons\.org\/(licenses\/by\/\d+\.\d+|publicdomain\/zero\/\d+\.\d+)\/$/i;

/** Buckets per V2: self = tempo×intensity 3×3, public = stage×energy 3×2. */
export const SELF_TRACK_BUCKETS: readonly string[] = [
  "self_slow_low",
  "self_slow_mid",
  "self_slow_high",
  "self_mid_low",
  "self_mid_mid",
  "self_mid_high",
  "self_fast_low",
  "self_fast_mid",
  "self_fast_high",
] as const;

export const PUBLIC_TRACK_BUCKETS: readonly string[] = [
  "public_warmup_low",
  "public_warmup_high",
  "public_focus_low",
  "public_focus_high",
  "public_deepwork_low",
  "public_deepwork_high",
] as const;

export const TRACK_POOLS: readonly string[] = ["self", "public"] as const;

export type TrackPool = (typeof TRACK_POOLS)[number];

export interface LibraryTrackCandidate {
  readonly id: string;
  readonly track_pool: string;
  readonly bucket: string;
  readonly title: string;
  readonly author: string;
  readonly source: string;
  readonly source_url: string;
  readonly audio_url: string;
  readonly audio_path: string;
  readonly license: string;
  readonly license_url: string;
  readonly license_evidence_url: string;
  readonly snapshot_path: string;
  readonly snapshot_sha256: string;
  readonly content_sha256: string;
  readonly duration_seconds: number;
  readonly size_bytes: number;
  readonly bitrate_kbps: number;
  readonly mime_type: string;
  readonly features_json: string;
  readonly bucket_rule_version: string;
  readonly pro_registered: boolean;
}

export type LicenseGateRejectionCode =
  | "missing_field"
  | "license_not_allowed"
  | "license_url_not_whitelisted"
  | "license_url_mismatch"
  | "pro_registered_public"
  | "bad_pool"
  | "bad_bucket"
  | "bucket_pool_mismatch"
  | "bad_hash"
  | "bad_audio_contract"
  | "bad_features";

export interface LicenseGateRejection {
  readonly code: LicenseGateRejectionCode;
  readonly reason: string;
  readonly field?: string;
}

export interface LicenseGateResult {
  readonly ok: boolean;
  readonly rejection?: LicenseGateRejection;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Strip scheme (and any query/fragment) so the host+path can be matched. */
export function normalizeLicenseUrlForWhitelist(url: string): string {
  let rest = url.trim();
  const schemeMatch = /^https?:\/\//i.exec(rest);
  if (schemeMatch) {
    rest = rest.slice(schemeMatch[0].length);
  }
  const queryIndex = rest.search(/[?#]/);
  if (queryIndex >= 0) {
    rest = rest.slice(0, queryIndex);
  }
  if (!rest.endsWith("/")) {
    rest = `${rest}/`;
  }
  return rest.toLowerCase();
}

export function isWhitelistedLicenseUrl(url: string): boolean {
  return LICENSE_URL_PATTERN.test(normalizeLicenseUrlForWhitelist(url));
}

/** The CC deed URL that the license NAME must correspond to. */
export function expectedLicenseUrlFor(license: string): string | undefined {
  switch (license) {
    case "CC0 1.0":
      return "creativecommons.org/publicdomain/zero/1.0/";
    case "CC-BY 2.5":
      return "creativecommons.org/licenses/by/2.5/";
    case "CC-BY 3.0":
      return "creativecommons.org/licenses/by/3.0/";
    case "CC-BY 4.0":
      return "creativecommons.org/licenses/by/4.0/";
    default:
      return undefined;
  }
}

/**
 * The gate. Pure function — no IO — so tests can fabricate candidates
 * freely. Order of checks is irrelevant to correctness; every rejection
 * names the offending field.
 */
export function validateTrackForIngestion(
  candidate: LibraryTrackCandidate,
): LicenseGateResult {
  const requiredTextFields = [
    "id",
    "title",
    "author",
    "source",
    "source_url",
    "audio_url",
    "audio_path",
    "license",
    "license_url",
    "license_evidence_url",
    "snapshot_path",
    "bucket_rule_version",
  ] as const;
  for (const field of requiredTextFields) {
    if (!isNonEmptyString(candidate[field])) {
      return {
        ok: false,
        rejection: {
          code: "missing_field",
          field,
          reason: `license gate: field ${field} is missing or empty`,
        },
      };
    }
  }

  if (!ALLOWED_LICENSES.includes(candidate.license)) {
    return {
      ok: false,
      rejection: {
        code: "license_not_allowed",
        field: "license",
        reason: `license gate: license "${candidate.license}" is not one of ${ALLOWED_LICENSES.join(", ")} (NC/ND/SA/Sampling and non-CC licenses are rejected)`,
      },
    };
  }

  if (!isWhitelistedLicenseUrl(candidate.license_url)) {
    return {
      ok: false,
      rejection: {
        code: "license_url_not_whitelisted",
        field: "license_url",
        reason: `license gate: license_url "${candidate.license_url}" is not a plain CC-BY/CC0 deed on creativecommons.org (NC/ND/SA/Sampling and off-whitelist hosts rejected)`,
      },
    };
  }

  const expected = expectedLicenseUrlFor(candidate.license);
  if (
    expected !== undefined &&
    normalizeLicenseUrlForWhitelist(candidate.license_url) !== expected
  ) {
    return {
      ok: false,
      rejection: {
        code: "license_url_mismatch",
        field: "license_url",
        reason: `license gate: license "${candidate.license}" does not match license_url "${candidate.license_url}"`,
      },
    };
  }

  if (!TRACK_POOLS.includes(candidate.track_pool)) {
    return {
      ok: false,
      rejection: {
        code: "bad_pool",
        field: "track_pool",
        reason: `license gate: track_pool "${candidate.track_pool}" must be "self" or "public"`,
      },
    };
  }

  const bucketOk =
    candidate.track_pool === "self"
      ? SELF_TRACK_BUCKETS.includes(candidate.bucket)
      : PUBLIC_TRACK_BUCKETS.includes(candidate.bucket);
  if (!bucketOk) {
    return {
      ok: false,
      rejection: {
        code: "bucket_pool_mismatch",
        field: "bucket",
        reason: `license gate: bucket "${candidate.bucket}" is not a valid ${candidate.track_pool}-pool bucket`,
      },
    };
  }

  if (candidate.pro_registered === true && candidate.track_pool === "public") {
    return {
      ok: false,
      rejection: {
        code: "pro_registered_public",
        field: "pro_registered",
        reason:
          "license gate: PRO-registered tracks never enter the public pool (V5)",
      },
    };
  }

  for (const [field, value] of [
    ["snapshot_sha256", candidate.snapshot_sha256],
    ["content_sha256", candidate.content_sha256],
  ] as const) {
    if (
      typeof value !== "string" ||
      !SHA256_PATTERN.test(value.toLowerCase())
    ) {
      return {
        ok: false,
        rejection: {
          code: "bad_hash",
          field,
          reason: `license gate: ${field} must be a lowercase 64-hex sha256`,
        },
      };
    }
  }

  if (
    candidate.mime_type !== "audio/ogg" ||
    typeof candidate.bitrate_kbps !== "number" ||
    !Number.isFinite(candidate.bitrate_kbps) ||
    candidate.bitrate_kbps <= 0
  ) {
    return {
      ok: false,
      rejection: {
        code: "bad_audio_contract",
        field: "mime_type",
        reason:
          "license gate: audio contract violated — the library stores pre-encoded Opus in OGG (mime audio/ogg) with a positive nominal bitrate; the server never transcodes",
      },
    };
  }

  if (
    typeof candidate.duration_seconds !== "number" ||
    !Number.isFinite(candidate.duration_seconds) ||
    candidate.duration_seconds <= 0 ||
    typeof candidate.size_bytes !== "number" ||
    !Number.isInteger(candidate.size_bytes) ||
    candidate.size_bytes <= 0
  ) {
    return {
      ok: false,
      rejection: {
        code: "bad_audio_contract",
        field: "duration_seconds",
        reason:
          "license gate: duration_seconds must be a positive number and size_bytes a positive integer",
      },
    };
  }

  try {
    const parsed: unknown = JSON.parse(candidate.features_json);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("features_json must be a JSON object");
    }
  } catch {
    return {
      ok: false,
      rejection: {
        code: "bad_features",
        field: "features_json",
        reason:
          "license gate: features_json must be valid JSON (librosa labeling output)",
      },
    };
  }

  return { ok: true };
}

export function rejectionReason(result: LicenseGateResult): string {
  return result.rejection?.reason ?? "unknown rejection";
}
