/**
 * getCryptoPriceFromCentralizedExchange-tests.gs: the tests of
 * getCryptoPriceFromCentralizedExchange.gs that run in Apps Script,
 * Google's platform for scripts that run inside its apps, against the real
 * services, from the editor's "Run" button: test, which runs them all,
 * testCoinGeckoUnderTheLock and testGetCryptoPrice.
 *
 * The repo's build step, `npm run build apps-script` (npm is the package
 * manager of Node, the program that runs JavaScript outside a browser),
 * joins it with
 * getCryptoPriceFromCentralizedExchange.gs and
 * getCryptoPriceFromCentralizedExchange-sources.gs into the one file
 * pasted into a spreadsheet's Apps Script project; the sheet needs it for
 * nothing but these tests.
 *
 * @see https://github.com/nottoseethesun/crypto-price-fetchers
 */

// Declared in getCryptoPriceFromCentralizedExchange.gs, in the same project:
/* global getCryptoPrice */

/** ============================================================================
 *                                 TESTS
 * ========================================================================== */

/**
 * Master test entry point. Runs all test suites.
 */
function test() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("MASTER TEST SUITE - " + new Date().toISOString());
  console.log(
    "getCryptoPrice, in three files: the function, its sources, and these tests",
  );
  console.log(
    "══════════════════════════════════════════════════════════════\n",
  );

  const results = [];

  // The lock's path first: it is quick
  results.push({
    name: "CoinGecko under the lock",
    passed: testCoinGeckoUnderTheLock(),
  });

  // Run main price tests
  results.push({
    name: "Price Fetching",
    passed: testGetCryptoPrice(),
  });

  // Summary
  console.log(
    "\n══════════════════════════════════════════════════════════════",
  );
  console.log("MASTER TEST SUMMARY");
  console.log("══════════════════════════════════════════════════════════════");
  results.forEach((r) => {
    console.log(`  ${r.passed ? "✓" : "✗"} ${r.name}`);
  });
  const allPassed = results.every((r) => r.passed);
  console.log(`\nOverall: ${allPassed ? "ALL PASSED" : "SOME FAILED"}`);
  console.log("══════════════════════════════════════════════════════════════");
}

/**
 * Prices GRC, which MEXC does not list, so getCryptoPrice's lookup goes on
 * to CoinGecko while getCryptoPrice holds the script lock. CoinGecko's
 * step takes no lock of its own: Apps Script's lock keeps no count, so a
 * second tryLock has no effect, and a second releaseLock would end the
 * caller's hold. The test passes when the call gives a price, or the
 * message for no data.
 *
 * @returns {boolean} Whether it passed
 */
function testCoinGeckoUnderTheLock() {
  console.log("\n┌── CoinGecko, priced while getCryptoPrice holds the lock");
  console.log("│ GRC has no MEXC pair, so its price comes from CoinGecko");
  console.log(
    "├──────────────────────────────────────────────────────────────",
  );

  const startTime = new Date().getTime();

  const result = getCryptoPrice(
    "grc",
    "2026-02-08 12:00:00",
    "CST",
    "high",
    200, // Normal delay to test real lock behavior
  );

  const durationMs = new Date().getTime() - startTime;

  console.log(
    `│ Result: ${typeof result === "number" ? result.toFixed(8) : result}`,
  );
  console.log(`│ Duration: ${durationMs} ms`);

  const passed =
    typeof result === "number" ||
    (typeof result === "string" && result.includes("No data"));
  console.log(`│ Status: ${passed ? "PASS" : "FAIL"}`);
  console.log(
    "└──────────────────────────────────────────────────────────────",
  );

  return passed;
}

/**
 * Tests price fetching across multiple tokens and scenarios.
 * @returns {boolean} True if all tests pass
 */
function testGetCryptoPrice() {
  console.log("\n┌── PRICE FETCHING TESTS");
  console.log(
    "├──────────────────────────────────────────────────────────────",
  );

  const testCases = [
    {
      name: "GRC - Recent price (high)",
      token: "grc",
      dateStr: "2026-02-08 12:00:00",
      tz: "CST",
      mode: "high",
      expectedRange: [0.001, 0.05],
    },
    {
      name: "GRC - Recent price (low)",
      token: "grc",
      dateStr: "2026-02-08 12:00:00",
      tz: "CST",
      mode: "low",
      expectedRange: [0.001, 0.05],
    },
    {
      name: "XTM - Recent price (high)",
      token: "xtm",
      dateStr: "2026-02-08 12:00:00",
      tz: "CST",
      mode: "high",
      expectedRange: [0.001, 0.1],
    },
    {
      name: "XTM - Recent price (low)",
      token: "xtm",
      dateStr: "2026-02-08 12:00:00",
      tz: "CST",
      mode: "low",
      expectedRange: [0.001, 0.1],
    },
    {
      name: "XMR - Older date (high)",
      token: "xmr",
      dateStr: "2025-12-01 14:30:00",
      tz: "UTC",
      mode: "high",
      expectedRange: [380, 450],
    },
    {
      name: "BTC - New Year 2026 (high)",
      token: "btc",
      dateStr: "2026-01-01 00:00:00",
      tz: "UTC",
      mode: "high",
      expectedRange: [85000, 100000],
    },
    {
      name: "BTC - New Year 2026 (close)",
      token: "btc",
      dateStr: "2026-01-01 00:00:00",
      tz: "UTC",
      mode: "close",
      expectedRange: [85000, 100000],
    },
    {
      name: "Invalid token",
      token: "zzzzzzfake",
      dateStr: "2026-02-08 12:00:00",
      tz: "CST",
      mode: "high",
      expectedRange: null,
    },
    {
      name: "Future date",
      token: "xtm",
      // A year from now, so the date stays in the future
      dateStr: new Date(Date.now() + 365 * 86400000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " "),
      tz: "CST",
      mode: "high",
      expectedRange: null,
    },
  ];

  let passed = 0;
  const failedTests = [];

  testCases.forEach((test, index) => {
    console.log(`│`);
    console.log(`│ Test ${index + 1}/${testCases.length}: ${test.name}`);
    console.log(`│   Token: ${test.token.toUpperCase()}`);
    console.log(`│   Date:  ${test.dateStr} ${test.tz}`);
    console.log(`│   Mode:  ${test.mode.toUpperCase()}`);

    const startTime = new Date().getTime();

    const result = getCryptoPrice(
      test.token,
      test.dateStr,
      test.tz,
      test.mode,
      0, // Fast mode for tests
    );

    const durationMs = new Date().getTime() - startTime;

    console.log(
      `│   Result: ${typeof result === "number" ? result.toFixed(8) : result}`,
    );
    console.log(`│   Time:   ${durationMs} ms`);

    let isPass = false;
    if (test.expectedRange) {
      if (typeof result === "number" && !isNaN(result)) {
        isPass =
          result >= test.expectedRange[0] && result <= test.expectedRange[1];
        console.log(
          `│   Range: ${isPass ? "PASS" : "FAIL"} (${test.expectedRange[0]} - ${test.expectedRange[1]})`,
        );
      } else {
        console.log("│   Range: N/A (got string/error)");
      }
    } else {
      isPass = typeof result === "string";
      console.log(`│   Expected error: ${isPass ? "PASS" : "FAIL"}`);
    }

    if (isPass) passed++;
    else failedTests.push(test.name);

    if (index < testCases.length - 1) {
      Logger.log(`Sleeping 5s between tests`);
      Utilities.sleep(5000);
    }
  });

  const total = testCases.length;
  const passRate = Math.round((passed / total) * 100);

  console.log(`│`);
  console.log(`│ Summary: ${passed}/${total} passed (${passRate}%)`);
  if (failedTests.length > 0) {
    console.log(`│ Failed:`);
    failedTests.forEach((name) => console.log(`│   - ${name}`));
  }
  console.log(
    "└──────────────────────────────────────────────────────────────",
  );

  return failedTests.length === 0;
}
