/**
 * Tests for the key store's services, `api-key-store/services.js`: how
 * each service is asked whether it takes a key, CoinGecko's as each of
 * its two types of key, and how a service is found by name.
 * @module test/key-services.test
 *
 * The services answer through a stand-in fetch (`helpers/stand-in-web.js`),
 * so nothing outside the computer is asked.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SERVICES, serviceNamed } from "../api-key-store/index.js";
import { standInFetch } from "./helpers/stand-in-web.js";

describe("the services", () => {
  /**
   * Answers with the status `status`.
   *
   * @param {number} status - The status
   * @returns {function} The stand-in fetch
   */
  function answering(status) {
    return standInFetch(() =>
      status === 200 ? { ok: true } : { status, text: "{}" },
    );
  }

  it("each have one check, or types of key each with its own, never both", () => {
    for (const service of Object.values(SERVICES)) {
      assert.notEqual(
        typeof service.check === "function",
        service.keyTypes !== undefined,
        service.service,
      );
      for (const type of Object.values(service.keyTypes ?? {})) {
        assert.equal(typeof type.name, "string");
        assert.equal(typeof type.check, "function");
      }
    }
  });

  it("check CoinGecko's key as a Demo key, then as a paid plan's: each at its api's ping, in its own header and in no url", async () => {
    const { keyTypes } = SERVICES.coingecko;
    assert.deepEqual(Object.keys(keyTypes), ["demo", "paid"]);
    for (const [type, url, header] of [
      ["demo", "https://api.coingecko.com/api/v3/ping", "x-cg-demo-api-key"],
      ["paid", "https://pro-api.coingecko.com/api/v3/ping", "x-cg-pro-api-key"],
    ]) {
      const { check } = keyTypes[type];
      const fetch = answering(200);
      assert.equal(await check("gecko-key", { fetch }), "valid");
      assert.deepEqual(
        fetch.requests.map((request) => [request.url, request.headers[header]]),
        [[url, "gecko-key"]],
      );
      assert.equal(
        await check("gecko-key", { fetch: answering(401) }),
        "invalid",
      );
      assert.equal(
        await check("gecko-key", { fetch: answering(400) }),
        "invalid",
      );
      await assert.rejects(
        check("gecko-key", { fetch: answering(503) }),
        /CoinGecko answered with status 503/,
      );
    }
  });

  it("check DexTools' key plan by plan, 1.1 seconds apart, until one takes it", async () => {
    const waits = [];
    const sleep = async (ms) => waits.push(ms);
    const fetch = standInFetch(({ url }) =>
      url.includes("/advanced/")
        ? { ok: true }
        : { status: 403, text: '{"message":"Forbidden"}' },
    );
    assert.equal(
      await SERVICES.dextools.check("dex-key", { fetch, sleep }),
      "valid",
    );
    assert.deepEqual(
      fetch.requests.map((request) => new URL(request.url).pathname),
      [
        "/standard/v2/blockchain",
        "/trial/v2/blockchain",
        "/free/v2/blockchain",
        "/advanced/v2/blockchain",
      ],
    );
    assert.ok(
      fetch.requests.every(
        (request) => request.headers["x-api-key"] === "dex-key",
      ),
    );
    assert.deepEqual(waits, [1100, 1100, 1100]);
  });

  it("refuse DexTools' key when every plan answers 403, and throw on another answer", async () => {
    const sleep = async () => {};
    assert.equal(
      await SERVICES.dextools.check("dex-key", {
        fetch: answering(403),
        sleep,
      }),
      "invalid",
    );
    await assert.rejects(
      SERVICES.dextools.check("dex-key", { fetch: answering(429), sleep }),
      /DexTools answered with status 429/,
    );
  });

  it("check x1.ninja's key by reading a pool with it, as a bearer token", async () => {
    const fetch = answering(200);
    assert.equal(await SERVICES.x1ninja.check("x1_key", { fetch }), "valid");
    assert.equal(
      fetch.requests[0].url,
      "https://api.x1.ninja/v1/pools/CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR",
    );
    assert.equal(fetch.requests[0].headers.authorization, "Bearer x1_key");
    assert.equal(
      await SERVICES.x1ninja.check("x1_key", { fetch: answering(401) }),
      "invalid",
    );
    await assert.rejects(
      SERVICES.x1ninja.check("x1_key", { fetch: answering(404) }),
      /x1.ninja answered with status 404/,
    );
  });

  it("check Moralis's key by asking its api version, which names no chain, with the key in the X-API-Key header and in no url", async () => {
    const fetch = answering(200);
    assert.equal(
      await SERVICES.moralis.check("moralis-key", { fetch }),
      "valid",
    );
    assert.equal(
      fetch.requests[0].url,
      "https://deep-index.moralis.io/api/v2.2/web3/version",
    );
    assert.equal(fetch.requests[0].url.includes("chain"), false);
    assert.equal(fetch.requests[0].headers["x-api-key"], "moralis-key");
    assert.equal(fetch.requests[0].url.includes("moralis-key"), false);
    assert.equal(
      await SERVICES.moralis.check("moralis-key", { fetch: answering(401) }),
      "invalid",
    );
    await assert.rejects(
      SERVICES.moralis.check("moralis-key", { fetch: answering(500) }),
      /Moralis answered with status 500/,
    );
  });

  it("check CoinPaprika's key at its paid server's key facts, as the whole Authorization header and in no url", async () => {
    const fetch = answering(200);
    assert.equal(
      await SERVICES.coinpaprika.check("paprika-key", { fetch }),
      "valid",
    );
    assert.equal(
      fetch.requests[0].url,
      "https://api-pro.coinpaprika.com/v1/key/info",
    );
    assert.equal(fetch.requests[0].headers.authorization, "paprika-key");
    assert.equal(fetch.requests[0].url.includes("paprika-key"), false);
    for (const status of [401, 403]) {
      assert.equal(
        await SERVICES.coinpaprika.check("paprika-key", {
          fetch: answering(status),
        }),
        "invalid",
      );
    }
    await assert.rejects(
      SERVICES.coinpaprika.check("paprika-key", { fetch: answering(402) }),
      /CoinPaprika answered with status 402/,
    );
  });

  it("are found by name, and an unknown name is refused, naming those known", () => {
    assert.equal(serviceNamed("dextools").name, "DexTools");
    assert.equal(serviceNamed("moralis").name, "Moralis");
    assert.equal(serviceNamed("coinpaprika").name, "CoinPaprika");
    assert.throws(
      () => serviceNamed("dexscreener"),
      /No service is named "dexscreener"; the services are coingecko, coinpaprika, dextools, moralis, x1ninja/,
    );
  });
});
