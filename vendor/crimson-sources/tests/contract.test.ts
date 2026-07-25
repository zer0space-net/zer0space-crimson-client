/*
 * /watch NDJSON wire-contract conformance.
 *
 * `contracts/watch_ndjson.schema.json` is the canonical protocol schema, GENERATED
 * by the backend (crimson-backend `core/contracts.py` -> `python -m core.contracts`)
 * and vendored here. These tests prove the values this engine produces — and the
 * `StreamLine` TS type — still satisfy that schema, so a client-resolved source
 * stays byte-compatible with a backend-resolved one. If the schema changes,
 * re-copy it from the backend and update the producers here together.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import type { StreamLine } from "../src/types";

const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL("../contracts/watch_ndjson.schema.json", import.meta.url)), "utf-8"),
);

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);

function expectValid(line: unknown) {
  const ok = validate(line);
  if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2));
  expect(ok).toBe(true);
}

describe("watch NDJSON contract", () => {
  it("pins the protocol version it was generated against", () => {
    expect(schema.$id).toBe("https://crimsonhaven.to/contracts/watch_ndjson/v1");
  });

  it("accepts a StreamLine with no cacheTicket (the client-resolved shape)", () => {
    const line: StreamLine = {
      type: "stream",
      source: "Cinema.bz (tcloud)",
      streamType: "hls",
      url: "https://cdn.example/master.m3u8",
      language: "en",
      subtitles: null,
    };
    // cacheTicket is an E0-only field; client-resolved lines omit it.
    expectValid(line);
  });

  it("accepts a StreamLine with subtitles", () => {
    const line: StreamLine = {
      type: "stream",
      source: "PlayIMDb (Server 1)",
      streamType: "mp4",
      url: "https://cdn.example/movie.mp4",
      language: null,
      subtitles: [{ url: "https://s/en.vtt", lang: "en", label: "English" }],
    };
    expectValid(line);
  });

  it("accepts the meta / unaired / done sibling lines the host also consumes", () => {
    expectValid({
      type: "meta",
      success: true,
      tmdb_id: 1429,
      season_number: 1,
      episode_number: 1,
      anilist_id: 16498,
      title: "Attack on Titan",
    });
    expectValid({
      type: "unaired",
      air_date: "2099-01-01",
      title: "Future Show",
      season_number: 1,
      episode_number: 99,
    });
    expectValid({ type: "done", count: 3 });
  });

  it("rejects an unknown line type and a bad streamType", () => {
    expect(validate({ type: "surprise" })).toBe(false);
    expect(
      validate({
        type: "stream",
        source: "x",
        streamType: "webm", // not in the enum
        url: "https://x",
        language: null,
        subtitles: null,
      }),
    ).toBe(false);
  });
});
