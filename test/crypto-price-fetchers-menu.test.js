/**
 * Tests for crypto-price-fetchers-menu.gs, the Crypto Price Fetchers menu
 * that the build step puts first in the one file it gives.
 * @module test/crypto-price-fetchers-menu.test
 *
 * The menu's file runs unchanged under Node with the runner's services and
 * a spreadsheet held in memory (`helpers/stand-in-spreadsheet.js`), which
 * records each formula written, each flush and each message. The runner's
 * sleep is replaced by one that records each wait and returns at once.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createAppsScriptServices } from "../apps-script-runner/apps-script-services.js";
import {
  applyConfig,
  loadAppsScript,
} from "../apps-script-runner/load-apps-script.js";
import { standInSpreadsheet } from "./helpers/stand-in-spreadsheet.js";

/** The menu's file, as committed. */
const MENU_SOURCE = fs.readFileSync(
  new URL("../crypto-price-fetchers-menu.gs", import.meta.url),
  "utf8",
);

/** A current price, as a cell calls for it. */
const PRICE = '=dexToolsGetTokenPrice("pulse", "0x1")';

/** A past price, as a cell calls for it. */
const PAST = '=getCryptoPrice("btc", "2026-01-15 14:30:00", "UTC", "high")';

/**
 * Loads the menu with a stand-in spreadsheet.
 *
 * @param {Object} spreadsheet - The stand-in spreadsheet's options (`standInSpreadsheet`)
 * @param {Object<string, Object>} [config={}] - Fields to set, such as `{ MENU_CONFIG: { BLOCK_SIZE: 2 } }`
 * @returns {{script: Object, sheet: Object, sleeps: number[]}} The menu's context, the spreadsheet, and the waits the menu made
 */
function loadMenu(spreadsheet, config = {}) {
  const sheet = standInSpreadsheet(spreadsheet);
  const sleeps = [];
  const services = createAppsScriptServices({
    fetchSync: () => ({ failure: "the menu asks nothing of the web" }),
    sleep: (milliseconds) => sleeps.push(milliseconds),
  });
  const script = loadAppsScript(
    [{ source: MENU_SOURCE, filename: "crypto-price-fetchers-menu.gs" }],
    {
      ...services,
      SpreadsheetApp: sheet.SpreadsheetApp,
      HtmlService: sheet.HtmlService,
    },
  );
  applyConfig(script, config);
  return { script, sheet, sleeps };
}

/**
 * The formulas written to one cell, in order.
 *
 * @param {Object} sheet - The stand-in spreadsheet
 * @param {string} key - The cell, as `Tab!A1`
 * @returns {string[]} The formulas
 */
function writtenTo(sheet, key) {
  return sheet.record.formulasWritten
    .filter((write) => `${write.tab}!${write.a1}` === key)
    .map((write) => write.formula);
}

describe("the Crypto Price Fetchers menu", () => {
  it("is built when the spreadsheet opens, each item naming a function of the script", () => {
    const { script, sheet } = loadMenu({ tabs: { Sheet1: [] } });
    script.onOpen();
    const [menu] = sheet.record.menus;
    assert.equal(menu.name, "Crypto Price Fetchers");
    assert.deepEqual(
      menu.items.map((item) => item.caption ?? "—"),
      [
        "Clean up errors",
        "Refresh",
        "Refresh & freeze historical prices (this tab)",
        "—",
        "Help",
      ],
    );
    for (const item of menu.items.filter((entry) => !entry.separator)) {
      assert.equal(typeof script[item.functionName], "function");
    }
  });

  it("shows the Help page the build sets, in a dialog the sheet stays usable behind, and a pointer to the build without it", () => {
    const bare = loadMenu({ tabs: { Sheet1: [] } });
    bare.script.showCryptoPriceFetchersHelp();
    assert.match(
      bare.sheet.record.dialogs[0].html,
      /pasted as committed, without the build/,
    );
    const built = loadMenu(
      { tabs: { Sheet1: [] } },
      { HELP_PAGE: { HTML: "<p>the help</p>" } },
    );
    built.script.showCryptoPriceFetchersHelp();
    const [dialog] = built.sheet.record.dialogs;
    assert.equal(dialog.html, "<p>the help</p>");
    assert.equal(dialog.title, "Crypto Price Fetchers – Help");
    assert.equal(dialog.output.width, 760);
    assert.equal(dialog.output.height, 620);
  });
});

describe("Refresh", () => {
  it("runs again every cell, in every tab, that calls a current-value function, whatever the case of its name, and no other", () => {
    const { script, sheet } = loadMenu({
      tabs: {
        Prices: [
          ["Token", "Price", "FDV", "Past"],
          ["A", PRICE, '=DEXTOOLSGETTOKENFDV("pulse", "0x1")', PAST],
          [
            "B",
            "=SUM(B2:C2)",
            5,
            '=dex_screener_pair_prop("pulsechain", "0x2", "priceUsd")',
          ],
        ],
        Other: [["=DEX_SCREENER_REFRESH_INTERVAL(60)"]],
      },
    });
    script.refreshCurrentPrices();
    for (const key of ["Prices!B2", "Prices!C2", "Prices!D3", "Other!A1"]) {
      assert.equal(sheet.runsOf(key), 1, key);
    }
    assert.equal(sheet.runsOf("Prices!D2"), 0);
    assert.equal(sheet.runsOf("Prices!B3"), 0);
    assert.deepEqual(writtenTo(sheet, "Prices!B2"), [`${PRICE}!`, PRICE]);
    assert.equal(sheet.cellAt("Prices", "B2").formula, PRICE);
    assert.deepEqual(sheet.record.toasts, [
      { message: "ran 4 cells again.", title: "Refresh", seconds: 10 },
    ]);
  });

  it("works in blocks of BLOCK_SIZE: breaks every formula of a block, pauses, then puts them all back", () => {
    const cells = Array.from({ length: 5 }, (_, row) => [
      `=dexToolsGetTokenPrice("pulse", "0x${row}")`,
    ]);
    const { script, sheet, sleeps } = loadMenu(
      { tabs: { Prices: cells } },
      { MENU_CONFIG: { BLOCK_SIZE: 2 } },
    );
    script.refreshCurrentPrices();
    const broken = sheet.record.formulasWritten.map((write) =>
      write.formula.endsWith("!") ? "break" : "restore",
    );
    assert.deepEqual(broken, [
      "break",
      "break",
      "restore",
      "restore",
      "break",
      "break",
      "restore",
      "restore",
      "break",
      "restore",
    ]);
    assert.deepEqual(sleeps, [1000, 1000, 1000]);
  });

  it("waits while a block's cells show Loading..., up to BLOCK_WAIT_MS", () => {
    const polled = loadMenu({ tabs: { Prices: [[PRICE]] }, loadingReads: 2 });
    polled.script.refreshCurrentPrices();
    assert.deepEqual(polled.sleeps, [1000, 1000, 1000]);
    const stuck = loadMenu(
      { tabs: { Prices: [[PRICE]] }, loadingReads: Number.MAX_SAFE_INTEGER },
      { MENU_CONFIG: { BLOCK_WAIT_MS: 20, POLL_MS: 5 } },
    );
    stuck.script.refreshCurrentPrices();
    assert.ok(stuck.sleeps.filter((ms) => ms === 5).length > 0);
    assert.equal(stuck.sheet.record.toasts.length, 1);
  });

  it("leaves alone, and names, a cell whose formula changes during the run", () => {
    const sorted = loadMenu({
      tabs: { Prices: [[PRICE], ['=dexToolsGetTokenPrice("pulse", "0x2")']] },
      onSetFormula: (write, sheet) => {
        if (write.a1 === "A1" && write.formula.endsWith("!")) {
          sheet.cellAt("Prices", "A2").formula =
            '=dexToolsGetTokenPrice("pulse", "0x9")';
        }
      },
    });
    sorted.script.refreshCurrentPrices();
    assert.equal(sorted.sheet.runsOf("Prices!A2"), 0);
    assert.equal(
      sorted.sheet.record.toasts[0].message,
      "ran 1 cell again; left 1 cell alone, since the formulas changed during the run: Prices!A2.",
    );
    const typedOver = loadMenu({
      tabs: { Prices: [[PRICE]] },
      onSetFormula: (write, sheet) => {
        if (write.formula.endsWith("!")) {
          sheet.cellAt("Prices", "A1").formula = "=1+1";
        }
      },
    });
    typedOver.script.refreshCurrentPrices();
    assert.equal(typedOver.sheet.cellAt("Prices", "A1").formula, "=1+1");
    assert.match(
      typedOver.sheet.record.toasts[0].message,
      /^ran 0 cells again; left 1 cell alone/,
    );
  });

  it("puts back a formula an earlier run left broken, if it calls a price function, and leaves any other", () => {
    const { script, sheet } = loadMenu({
      tabs: {
        Prices: [
          [
            { formula: `${PRICE}!`, display: "#ERROR!" },
            { formula: "=SUM(1)!", display: "#ERROR!" },
          ],
        ],
      },
    });
    script.refreshCurrentPrices();
    assert.equal(sheet.cellAt("Prices", "A1").formula, PRICE);
    assert.equal(sheet.cellAt("Prices", "B1").formula, "=SUM(1)!");
    assert.equal(
      sheet.record.toasts[0].message,
      "ran 1 cell again; put back 1 formula an earlier run left broken.",
    );
  });

  it("starts no block after RUN_BUDGET_MS, and counts the cells left for another run", () => {
    const { script, sheet } = loadMenu(
      { tabs: { Prices: [[PRICE], [PRICE]] } },
      { MENU_CONFIG: { RUN_BUDGET_MS: -1 } },
    );
    script.refreshCurrentPrices();
    assert.deepEqual(sheet.record.formulasWritten, []);
    assert.equal(
      sheet.record.toasts[0].message,
      "ran 0 cells again; 2 more cells did not fit in Google's time for one run; choose the item again for them.",
    );
  });
});

describe("Clean up errors", () => {
  it("runs again only the cells that show #ERROR! and whose own formula calls a price function", () => {
    const error = (formula) => ({ formula, display: "#ERROR!" });
    const { script, sheet } = loadMenu({
      tabs: {
        Prices: [
          [
            error(PRICE),
            error(PAST),
            { formula: '=dexToolsGetTokenFDV("pulse", "0x1")', value: 12.5 },
          ],
          [
            error("=A1*2"),
            error("=myOwnFunction()"),
            error('=DEX_SCREENER_PAIR("bsc", "0x3")'),
          ],
        ],
      },
    });
    script.cleanUpErrors();
    for (const key of ["Prices!A1", "Prices!B1", "Prices!C2"]) {
      assert.equal(sheet.runsOf(key), 1, key);
    }
    for (const key of ["Prices!C1", "Prices!A2", "Prices!B2"]) {
      assert.equal(sheet.runsOf(key), 0, key);
    }
    assert.equal(sheet.record.toasts[0].title, "Clean up errors");
  });
});

describe("Refresh & freeze historical prices", () => {
  /**
   * The spreadsheet: a past price that gives a number, one that gives a
   * message, and a current price on the active tab, and a past price on
   * another.
   *
   * @param {string} answer - The button the question is answered with
   * @returns {Object} The loaded menu (`loadMenu`)
   */
  const trades = (answer) =>
    loadMenu({
      tabs: {
        Trades: [
          [PAST],
          ['=getCryptoPrice("zzz", "2026-01-15 14:30:00", "UTC")'],
          [PRICE],
        ],
        Other: [[PAST]],
      },
      activeTab: "Trades",
      answer,
      evaluate: (formula) =>
        formula.includes('"zzz"')
          ? "No data available from any source"
          : 42000.5,
    });

  it("asks first, then on the active tab keeps each past price that gives a number as that number, and each other formula", () => {
    const { script, sheet } = trades("YES");
    script.freezeHistoricalPrices();
    assert.equal(
      sheet.record.alerts[0].title,
      "Refresh & freeze historical prices?",
    );
    assert.equal(sheet.record.alerts[0].buttons, "YES_NO");
    assert.deepEqual(sheet.cellAt("Trades", "A1"), {
      formula: "",
      value: 42000.5,
      display: "42000.5",
      loadingLeft: 0,
    });
    assert.match(sheet.cellAt("Trades", "A2").formula, /"zzz"/);
    assert.equal(sheet.runsOf("Trades!A3"), 0);
    assert.equal(sheet.runsOf("Other!A1"), 0);
    assert.equal(
      sheet.record.toasts[0].message,
      "ran 2 cells again; froze 1 price; kept 1 formula that gave no number.",
    );
  });

  it("does nothing when the question is answered No", () => {
    const { script, sheet } = trades("NO");
    script.freezeHistoricalPrices();
    assert.deepEqual(sheet.record.formulasWritten, []);
    assert.deepEqual(sheet.record.valuesWritten, []);
    assert.deepEqual(sheet.record.toasts, []);
  });
});

describe("the menu's settings", () => {
  it("run no more than 20 cells at once, below the 30 calls Google runs at once for one person", () => {
    const { script } = loadMenu({ tabs: { Sheet1: [] } });
    const config = vm.runInContext("MENU_CONFIG", script);
    assert.ok(config.BLOCK_SIZE <= 20);
    assert.ok(
      config.RUN_BUDGET_MS + config.BLOCK_WAIT_MS + config.PAUSE_MS < 360000,
    );
  });
});
