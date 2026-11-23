/**
 * Tests of the checks crypto-price-filler's settings and token list pass
 * before the tool takes them.
 * @file tests/settings-files.test.js
 *
 * `config.js` reads `config-example.json`, with the owner's `config.json`
 * laid over it, and `supported-tokens.js` reads `supported-tokens.json`;
 * each file is held to its JSON Schema (`SETTINGS_SCHEMA`,
 * `SUPPORTED_TOKENS_SCHEMA`). The tests hold the committed files to the
 * schemas, and write files of their own in a temp folder for the cases a
 * schema refuses, so the owner's `config.json` is never read.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { readSupportedTokens } from "../supported-tokens.js";

/** HEX's contract on PulseChain in lower case, not EIP-55's form, for the schema to refuse. */
const LOWER_CASE_ADDRESS = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";

const COMMITTED = new URL("../config-example.json", import.meta.url);
let folder;

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "filler-settings-"));
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

/**
 * Writes a file in the test's temp folder.
 *
 * @param {string} name - The file's name
 * @param {*} content - Its content, written as JSON unless a string
 * @returns {string} Its path
 */
function writeFile(name, content) {
  const file = path.join(folder, name);
  const text =
    typeof content === "string" ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(file, text);
  return file;
}

describe("config.js's settings", () => {
  it("are the committed ones when no config.json exists", () => {
    const committed = JSON.parse(fs.readFileSync(COMMITTED, "utf8"));
    expect(loadConfig({ ownFile: path.join(folder, "config.json") })).toEqual(
      committed,
    );
  });

  it("take each setting config.json holds in place of the committed one", () => {
    const ownFile = writeFile("config.json", { BACKFILL_HIGHEST: true });
    const settings = loadConfig({ ownFile });
    expect(settings.BACKFILL_HIGHEST).toBe(true);
    expect(settings.GECKOTERMINAL_TOP_POOLS_CONSIDERED).toBe(10);
  });

  it("refuse a config.json with a setting the tool does not read, or of the wrong kind, listing every problem", () => {
    const ownFile = writeFile("config.json", {
      BACKFILL_HIGEST: true,
      BACKFILL_LOWEST: "no",
      GECKOTERMINAL_TOP_POOLS_CONSIDERED: 0,
    });
    expect(() => loadConfig({ ownFile })).toThrow(
      [
        "crypto-price-filler/config.json → BACKFILL_HIGEST is not a setting this tool reads",
        "crypto-price-filler/config.json → GECKOTERMINAL_TOP_POOLS_CONSIDERED must be a whole number above 0; it is 0",
        'crypto-price-filler/config.json → BACKFILL_LOWEST must be true or false; it is "no"',
      ].join("\n"),
    );
  });

  it("refuse a config.json that is not JSON, naming the file", () => {
    const ownFile = writeFile("config.json", "{ BACKFILL_HIGHEST: true }");
    expect(() => loadConfig({ ownFile })).toThrow(
      `${ownFile} is not valid JSON: `,
    );
  });

  it("stop when the committed settings are missing", () => {
    expect(() =>
      loadConfig({
        committedFile: path.join(folder, "config-example.json"),
        ownFile: path.join(folder, "config.json"),
      }),
    ).toThrow(/^Cannot read \S*config-example\.json: ENOENT/);
  });
});

describe("supported-tokens.json", () => {
  it("holds to its schema as committed", () => {
    expect(Object.keys(readSupportedTokens().tokens)).toContain("btc");
  });

  it("is refused with a fact no token has, a contract not in EIP-55's form, or a required fact missing, listing every problem", () => {
    const file = writeFile("supported-tokens.json", {
      tokens: {
        phex: {
          name: "HEX on PulseChain",
          coingecko_id: null,
          coinpaprika_id: null,
          mexc_symbol: null,
          contract: LOWER_CASE_ADDRESS,
          geckoterminal_netwerk: "pulsechain",
        },
        grc: { name: "Gridcoin", coingecko_id: "gridcoin-research" },
      },
    });
    expect(() => readSupportedTokens(file)).toThrow(
      [
        "crypto-price-filler/supported-tokens.json → tokens.phex.geckoterminal_netwerk is not a setting this tool reads",
        `crypto-price-filler/supported-tokens.json → tokens.phex.contract must be an EIP-55 address; it is "${LOWER_CASE_ADDRESS}"`,
        "crypto-price-filler/supported-tokens.json → tokens.grc.coinpaprika_id is missing",
        "crypto-price-filler/supported-tokens.json → tokens.grc.mexc_symbol is missing",
      ].join("\n"),
    );
  });
});
