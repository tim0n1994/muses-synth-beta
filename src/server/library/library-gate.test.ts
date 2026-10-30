import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  ALLOWED_LICENSES,
  isWhitelistedLicenseUrl,
  validateTrackForIngestion,
  type LibraryTrackCandidate,
} from "./license-gate.js";
import {
  bootstrapPilotLibraryDatabase,
  bucketCounts,
  insertLibraryTrack,
  poolOverlapSourceUrls,
} from "./tracks-store.js";

/**
 * License-gate unit tests (v0.7 batch 1, B path) — the 100% hard standard.
 *
 * Fabricated candidates (伪造) prove the gate rejects:
 *   - any of the four license fields missing (license / license_url /
 *     author / source_url)
 *   - NC / ND / SA / Sampling / non-CC licenses, on name OR deed URL
 *   - PRO-registered tracks entering the public pool (V5)
 *   - duplicate ingestion (same source_url, same pool+title+author, and
 *     the same work re-ingested into the OTHER pool — the two pools stay
 *     physically disjoint)
 * plus the DB-level defense in depth from migration 006 and the
 * no-server-transcode static guarantee.
 */

const baseCandidate: LibraryTrackCandidate = {
  id: "0123456789abcdef",
  track_pool: "self",
  bucket: "self_mid_mid",
  title: "Gate Test Track",
  author: "Gate Test Author",
  source: "Free Music Archive",
  source_url: "https://freemusicarchive.org/music/gate/test-track/",
  audio_url: "https://files.freemusicarchive.org/gate-test.mp3",
  audio_path: "public/library/self/self_mid_mid/0123456789abcdef.opus",
  license: "CC-BY 4.0",
  license_url: "https://creativecommons.org/licenses/by/4.0/",
  license_evidence_url: "https://freemusicarchive.org/music/gate/test-track/",
  snapshot_path: "snapshots/0123456789abcdef.json",
  snapshot_sha256: "a".repeat(64),
  content_sha256: "b".repeat(64),
  duration_seconds: 123.5,
  size_bytes: 1_500_000,
  bitrate_kbps: 96,
  mime_type: "audio/ogg",
  features_json: JSON.stringify({ bpm: 110, rms_mean: 0.08 }),
  bucket_rule_version: "pilot-v1",
  pro_registered: false,
};

const candidate = (
  overrides: Partial<LibraryTrackCandidate> = {},
): LibraryTrackCandidate => ({ ...baseCandidate, ...overrides });

describe("license gate: missing license fields are rejected", () => {
  const licenseFields = [
    "license",
    "license_url",
    "author",
    "source_url",
  ] as const;

  for (const field of licenseFields) {
    it(`rejects a fabricated track with ${field} missing (empty string)`, () => {
      const result = validateTrackForIngestion(candidate({ [field]: "" }));
      expect(result.ok).toBe(false);
      expect(result.rejection?.code).toBe("missing_field");
      expect(result.rejection?.field).toBe(field);
    });
  }

  it("rejects a fabricated track with no forensic snapshot (snapshot_path empty)", () => {
    const result = validateTrackForIngestion(candidate({ snapshot_path: "" }));
    expect(result.ok).toBe(false);
    expect(result.rejection?.code).toBe("missing_field");
    expect(result.rejection?.field).toBe("snapshot_path");
  });

  it("rejects a malformed forensic snapshot hash (取证快照哈希必须是 64 位 sha256)", () => {
    const result = validateTrackForIngestion(
      candidate({ snapshot_sha256: "not-a-hash" }),
    );
    expect(result.ok).toBe(false);
    expect(result.rejection?.code).toBe("bad_hash");
    expect(result.rejection?.field).toBe("snapshot_sha256");
  });
});

describe("license gate: NC / ND / SA / Sampling / non-CC are rejected", () => {
  it("rejects license names outside the CC0/CC-BY whitelist", () => {
    for (const license of [
      "CC-BY-NC 4.0",
      "CC-BY-ND 4.0",
      "CC-BY-NC-SA 3.0",
      "CC-BY-SA 4.0",
      "CC Sampling+ 1.0",
      "Pixabay Content License",
      "All Rights Reserved",
    ]) {
      const result = validateTrackForIngestion(candidate({ license }));
      expect(result.ok, license).toBe(false);
      expect(result.rejection?.code).toBe("license_not_allowed");
    }
  });

  it("rejects NC/ND/SA deed URLs even when the name claims plain CC-BY", () => {
    for (const license_url of [
      "https://creativecommons.org/licenses/by-nc/4.0/",
      "https://creativecommons.org/licenses/by-nc-nd/3.0/",
      "https://creativecommons.org/licenses/by-sa/4.0/",
      "https://creativecommons.org/licenses/sampling+/1.0/",
      "https://pixabay.com/service/license-summary/",
      "https://creativecommons.org/licenses/by/4.0", // missing trailing slash is normalized; keep a genuinely bad one below
      "https://example.com/licenses/by/4.0/",
    ]) {
      const whitelisted = isWhitelistedLicenseUrl(license_url);
      if (license_url === "https://creativecommons.org/licenses/by/4.0") {
        // trailing-slash normalization means this one IS whitelisted
        expect(whitelisted).toBe(true);
        continue;
      }
      expect(whitelisted, license_url).toBe(false);
      const result = validateTrackForIngestion(candidate({ license_url }));
      expect(result.ok, license_url).toBe(false);
      expect(result.rejection?.code).toBe("license_url_not_whitelisted");
    }
  });

  it("rejects a license name that contradicts its deed URL", () => {
    const result = validateTrackForIngestion(
      candidate({ license: "CC-BY 3.0" }),
    );
    expect(result.ok).toBe(false);
    expect(result.rejection?.code).toBe("license_url_mismatch");
  });

  it("accepts every whitelisted license with its matching deed", () => {
    const deeds: Record<string, string> = {
      "CC0 1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
      "CC-BY 2.5": "https://creativecommons.org/licenses/by/2.5/",
      "CC-BY 3.0": "https://creativecommons.org/licenses/by/3.0/",
      "CC-BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
    };
    for (const license of ALLOWED_LICENSES) {
      const result = validateTrackForIngestion(
        candidate({
          license,
          license_url:
            deeds[license] ?? "https://creativecommons.org/licenses/by/4.0/",
        }),
      );
      expect(result.ok, license).toBe(true);
    }
  });
});

describe("license gate: PRO-registered tracks never enter the public pool", () => {
  it("rejects a fabricated PRO-marked track for the public pool", () => {
    const result = validateTrackForIngestion(
      candidate({
        track_pool: "public",
        bucket: "public_focus_low",
        pro_registered: true,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.rejection?.code).toBe("pro_registered_public");
  });

  it("V5 scope: the same PRO-marked track passes the gate for the SELF pool", () => {
    const result = validateTrackForIngestion(
      candidate({ pro_registered: true }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("license gate: pool/bucket consistency", () => {
  it("rejects an unknown pool", () => {
    const result = validateTrackForIngestion(
      candidate({ track_pool: "broadcast" }),
    );
    expect(result.ok).toBe(false);
    expect(result.rejection?.code).toBe("bad_pool");
  });

  it("rejects a public bucket in the self pool and vice versa", () => {
    const selfBucketInPublic = validateTrackForIngestion(
      candidate({ track_pool: "public", bucket: "self_mid_mid" }),
    );
    expect(selfBucketInPublic.ok).toBe(false);

    const publicBucketInSelf = validateTrackForIngestion(
      candidate({ bucket: "public_focus_low" }),
    );
    expect(publicBucketInSelf.ok).toBe(false);

    const garbageBucket = validateTrackForIngestion(
      candidate({ bucket: "self_ultra_max" }),
    );
    expect(garbageBucket.ok).toBe(false);
  });
});

describe("gated insertion: duplicate ingestion is rejected", () => {
  const openDb = () => {
    const db = new Database(":memory:");
    bootstrapPilotLibraryDatabase(db);
    return db;
  };

  it("inserts a valid track once, then rejects the identical row (same source_url)", () => {
    const db = openDb();
    const first = insertLibraryTrack(db, candidate());
    expect(first.inserted).toBe(true);

    const second = insertLibraryTrack(db, candidate());
    expect(second.inserted).toBe(false);
    expect(second.rejectionCode).toBe("duplicate_source_url");
    db.close();
  });

  it("rejects a different source_url with the same (pool, title, author)", () => {
    const db = openDb();
    insertLibraryTrack(db, candidate());
    const dupe = insertLibraryTrack(
      db,
      candidate({
        id: "ffffffffffffffff",
        source_url: "https://freemusicarchive.org/music/gate/test-track-2/",
        audio_url: "https://files.freemusicarchive.org/gate-test-2.mp3",
      }),
    );
    expect(dupe.inserted).toBe(false);
    expect(dupe.rejectionCode).toBe("duplicate_pool_title_author");
    db.close();
  });

  it("rejects re-ingesting the same work into the OTHER pool (pools stay disjoint)", () => {
    const db = openDb();
    insertLibraryTrack(db, candidate());
    const crossPool = insertLibraryTrack(
      db,
      candidate({
        id: "eeeeeeeeeeeeeeee",
        track_pool: "public",
        bucket: "public_focus_low",
      }),
    );
    expect(crossPool.inserted).toBe(false);
    expect(crossPool.rejectionCode).toBe("duplicate_source_url");
    expect(poolOverlapSourceUrls(db)).toEqual([]);
    db.close();
  });

  it("never writes a gate-rejected row (missing field / NC / PRO)", () => {
    const db = openDb();
    insertLibraryTrack(db, candidate());
    insertLibraryTrack(
      db,
      candidate({
        id: "aaaaaaaaaaaaaaaa",
        title: "No Author Track",
        source_url: "https://freemusicarchive.org/music/gate/no-author/",
        author: "",
      }),
    );
    insertLibraryTrack(
      db,
      candidate({
        id: "bbbbbbbbbbbbbbbb",
        title: "NC Track",
        source_url: "https://freemusicarchive.org/music/gate/nc/",
        license: "CC-BY-NC 4.0",
      }),
    );
    insertLibraryTrack(
      db,
      candidate({
        id: "cccccccccccccccc",
        title: "PRO Public Track",
        source_url: "https://freemusicarchive.org/music/gate/pro/",
        track_pool: "public",
        bucket: "public_focus_low",
        pro_registered: true,
      }),
    );

    const counts = bucketCounts(db);
    expect(counts.get("self/self_mid_mid")).toBe(1);
    db.close();
  });
});

describe("migration 006: DB-level defense in depth", () => {
  it("applies migration 006 and enforces the license CHECKs", () => {
    const db = new Database(":memory:");
    const bootstrap = bootstrapPilotLibraryDatabase(db);
    expect(bootstrap.appliedVersions).toContain(6);

    expect(() =>
      db
        .prepare(
          `INSERT INTO library_tracks (
           id, track_pool, bucket, title, author, source, source_url, audio_url,
           audio_path, license, license_url, license_evidence_url, snapshot_path,
           snapshot_sha256, content_sha256, duration_seconds, size_bytes,
           bitrate_kbps, mime_type, features_json, bucket_rule_version,
           pro_registered, ingested_at
         ) VALUES (
           'dddddddddddddddd', 'public', 'public_warmup_low', 'DB Check Track',
           'DB Check Author', 'Incompetech',
           'https://incompetech.com/music/royalty-free/mp3-royaltyfree/DB%20Check.mp3',
           'https://incompetech.com/music/royalty-free/mp3-royaltyfree/DB%20Check.mp3',
           'public/library/public/public_warmup_low/ddddddddddddddddd.opus',
           'CC-BY-NC 4.0',
           'https://creativecommons.org/licenses/by-nc/4.0/',
           'https://incompetech.com/faq', 'snapshots/dddddddddddddddd.json',
           '${"c".repeat(64)}', '${"d".repeat(64)}', 100.0, 1200000, 96,
           'audio/ogg', '{"bpm":100}', 'pilot-v1', 0,
           '2026-10-20T00:00:00.000Z'
         )`,
        )
        .run(),
    ).toThrowError(/CHECK constraint failed/);
    db.close();
  });
});

describe("zero-transcode guarantee: the server module spawns no encoders", () => {
  it("src/server/library production sources reference neither ffmpeg nor child_process", () => {
    const libraryDir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(libraryDir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(join(libraryDir, name), "utf8");
      expect(
        source.includes("ffmpeg") || source.includes("child_process"),
        `${name} must not encode audio or spawn processes (V3/V6: audio is pre-encoded Opus served as static files; labeling and encoding happen offline on the ingestion Mac)`,
      ).toBe(false);
    }
  });
});
