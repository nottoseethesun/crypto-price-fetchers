/**
 * Crypto Price Fetchers – the menu of the one pasted script
 *
 * PURPOSE
 *   `npm run build apps-script`, the build step of the crypto-price-fetchers
 *   repo, joins every Sheets script of the repo into one file to paste into
 *   a spreadsheet's Apps Script project. This file is that file's first
 *   part: the Crypto Price Fetchers menu, which `onOpen` builds each time
 *   the spreadsheet opens, and what its items do. They run the price cells
 *   again, clear cells stuck on #ERROR!, freeze historical prices, and show
 *   Help, a page the build makes from the help section below and those of
 *   the other scripts' headers.
 *
 * <!-- HELP START -->
 * ## The Crypto Price Fetchers menu
 *
 * The menu appears each time the spreadsheet opens. When an item ends, a
 * message at the bottom right of the sheet says what it did.
 *
 * - Clean up errors: runs again every cell, in every tab, that shows
 *   `#ERROR!` and whose own formula calls `dexToolsGetTokenPrice`,
 *   `dexToolsGetTokenFDV`, `getCryptoPrice` or a `DEX_SCREENER_` function.
 *   A cell that shows `#ERROR!` only because it reads such a cell clears
 *   once that cell has run again.
 * - Refresh: runs again every cell, in every tab, that calls
 *   `dexToolsGetTokenPrice`, `dexToolsGetTokenFDV` or a `DEX_SCREENER_`
 *   function, so each shows the current value. Cells that call
 *   `getCryptoPrice`, a price at a past time, are left as they are.
 * - Refresh & freeze historical prices (this tab): on the tab you are on,
 *   runs every cell that calls `getCryptoPrice` again, then replaces each
 *   formula that gave a number with that number. A cell that gave a
 *   message or an error keeps its formula, for another run.
 * - Help: shows this page.
 *
 * The first time you choose an item, Google asks you to approve what the
 * script may do. Approve once; it asks again only when a new version of
 * the script needs more.
 *
 * ### Why a cell shows #ERROR! and how it clears
 *
 * Google stops a custom function that runs longer than 30 seconds, and its
 * cell shows `#ERROR!`. Sheets runs that cell again only when its formula
 * is edited or a cell named in it changes, so the error stays until then.
 * Clean up errors and Refresh make that edit for you: each adds a `!` to
 * the end of the formula, which Sheets saves as a formula it cannot read,
 * and a second later puts back the formula as you typed it, which Sheets
 * runs as a new one. They work on 20 cells at a time, and wait for those
 * results before the next 20, since Google runs at most 30 calls of one
 * person at the same time. A cell whose formula changes while they run,
 * for example because you sort the tab, is left alone and named in the
 * message.
 * <!-- HELP END -->
 *
 * HOW THE ITEMS WORK
 *
 *   - Each item finds its cells by reading each tab's formulas in one call
 *     (`getFormulas`), and, for Clean up errors, the displayed values of
 *     the tabs that hold calls (`getDisplayValues`). A formula counts when
 *     it calls one of `PRICE_CALLS`' functions, whatever the case of its
 *     name, since Sheets ignores the case of a custom function's name.
 *   - A cell runs again when its formula is broken and put back
 *     (`rerunInBlocks_`), in blocks of `MENU_CONFIG.BLOCK_SIZE`. Before each
 *     write, the cell's formula is read again, so a cell that changed, as
 *     when a sort moves the rows, is skipped and reported, never written
 *     into.
 *   - Every item starts and ends by putting back any formula of these
 *     functions that a stopped run left with a `!` at its end
 *     (`restoreLeftovers_`), so no formula stays broken.
 *   - No item starts a new block after `MENU_CONFIG.RUN_BUDGET_MS`, inside
 *     Google's six minutes for one run; the message counts the cells left,
 *     for another run.
 *
 * WHY THIS FILE HOLDS onOpen
 *
 *   A function named onOpen runs on its own when the spreadsheet opens, and
 *   builds the menu without a trigger set up by hand. All files of an Apps
 *   Script project share one global scope, so the project holds one onOpen,
 *   this one, with every script's menu items in it.
 *
 * NODE
 *
 *   No Node version of the scripts loads this file, since nothing here
 *   gives a price. The repo's tests load it with a stand-in of the
 *   spreadsheet (`test/helpers/stand-in-spreadsheet.js`).
 *
 * PROJECT & LICENSE INFORMATION
 *
 *   Part of https://github.com/nottoseethesun/crypto-price-fetchers, under
 *   the Apache 2.0 License. Use at your own risk.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   SETTINGS
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} MenuConfig
 * @property {number} BLOCK_SIZE     Cells run again together; Google runs at most 30 calls of one person at once
 * @property {number} PAUSE_MS       How long a formula stays broken, so Sheets saves the edit
 * @property {number} BLOCK_WAIT_MS  The longest wait for a block's cells to finish; Google stops a call after 30 s
 * @property {number} POLL_MS        How often a block's cells are looked at while they run
 * @property {number} RUN_BUDGET_MS  No new block starts after this long, inside Google's 6 minutes for one run
 */
const MENU_CONFIG = {
  BLOCK_SIZE: 20,
  PAUSE_MS: 1000,
  BLOCK_WAIT_MS: 30000,
  POLL_MS: 1000,
  RUN_BUDGET_MS: 300000,
};

/**
 * The page the Help item shows. The build sets `HTML` from the help
 * sections of the scripts' headers; the page written here is shown only by
 * a copy pasted without the build.
 *
 * @type {{HTML: string}}
 */
const HELP_PAGE = {
  HTML:
    '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif">' +
    "<p>This copy of the script was pasted as committed, without the build " +
    "step, so it holds no help page and no api keys.</p>" +
    "<p>Install it as the README of crypto-price-fetchers says, under " +
    '<a href="https://github.com/nottoseethesun/crypto-price-fetchers#install" ' +
    'target="_blank">Install</a>: <code>npm run build apps-script</code> gives ' +
    "the one file to paste.</p></body></html>",
};

/** The calls the items look for: current values, past prices, and either. */
const PRICE_CALLS = Object.freeze({
  current:
    /\b(?:dexToolsGetTokenPrice|dexToolsGetTokenFDV|DEX_SCREENER_\w*)\s*\(/i,
  historical: /\bgetCryptoPrice\s*\(/i,
  any: /\b(?:dexToolsGetTokenPrice|dexToolsGetTokenFDV|DEX_SCREENER_\w*|getCryptoPrice)\s*\(/i,
});

/** What Sheets shows in a cell whose custom function failed. */
const ERROR_DISPLAY = "#ERROR!";

/** What Sheets shows in a cell whose custom function is still running. */
const LOADING_DISPLAY = "Loading...";

/* ─────────────────────────────────────────────────────────────────────────────
   THE MENU
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Builds the Crypto Price Fetchers menu when the spreadsheet opens.
 *
 * @return {void}
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Crypto Price Fetchers")
    .addItem("Clean up errors", "cleanUpErrors")
    .addItem("Refresh", "refreshCurrentPrices")
    .addItem(
      "Refresh & freeze historical prices (this tab)",
      "freezeHistoricalPrices",
    )
    .addSeparator()
    .addItem("Help", "showCryptoPriceFetchersHelp")
    .addToUi();
}

/**
 * The Help item: shows the help page in a dialog, with the sheet usable
 * behind it.
 *
 * @return {void}
 */
function showCryptoPriceFetchersHelp() {
  const page = HtmlService.createHtmlOutput(HELP_PAGE.HTML)
    .setWidth(760)
    .setHeight(620);
  SpreadsheetApp.getUi().showModelessDialog(
    page,
    "Crypto Price Fetchers – Help",
  );
}

/**
 * The Clean up errors item: runs again every cell, in every tab, that
 * shows #ERROR! and calls one of the price functions.
 *
 * @return {void}
 */
function cleanUpErrors() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = spreadsheet.getSheets();
  runItem_(spreadsheet, "Clean up errors", sheets, () =>
    findCalls_(sheets, PRICE_CALLS.any, true),
  );
}

/**
 * The Refresh item: runs again every cell, in every tab, that calls a
 * current-value function.
 *
 * @return {void}
 */
function refreshCurrentPrices() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = spreadsheet.getSheets();
  runItem_(spreadsheet, "Refresh", sheets, () =>
    findCalls_(sheets, PRICE_CALLS.current, false),
  );
}

/**
 * The Refresh & freeze historical prices item: on the active tab, runs
 * every getCryptoPrice cell again, then keeps each price it gave as a
 * plain number.
 *
 * @return {void}
 */
function freezeHistoricalPrices() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();
  const answer = ui.alert(
    "Refresh & freeze historical prices?",
    `Every getCryptoPrice cell on the tab "${sheet.getName()}" runs again, ` +
      "then each one that gives a number keeps it as a plain number, " +
      "without its formula. Continue?",
    ui.ButtonSet.YES_NO,
  );
  if (answer !== ui.Button.YES) return;
  runItem_(
    spreadsheet,
    "Refresh & freeze historical prices",
    [sheet],
    () => findCalls_([sheet], PRICE_CALLS.historical, false),
    freezeNumbers_,
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   INTERNAL – FINDING AND RUNNING CELLS AGAIN
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * One cell that holds a call.
 *
 * @typedef {Object} CallCell
 * @property {Object} sheet    The tab
 * @property {number} row      Its row, from 1
 * @property {number} column   Its column, from 1
 * @property {string} formula  Its formula, as read before the run
 */

/**
 * What a run did.
 *
 * @typedef {Object} RunResult
 * @property {CallCell[]} reran    The cells run again
 * @property {CallCell[]} skipped  The cells left alone, since their formulas changed during the run
 * @property {CallCell[]} left     The cells no block reached within the run's time
 * @property {number} repaired     How many broken formulas left by an earlier run it put back
 * @property {string[]} notes      What a step after the run adds to the message
 */

/**
 * Runs one item: puts back broken formulas left behind, finds the cells,
 * runs them again, hands the result to the item's last step, puts back any
 * broken formula left again, and reports.
 *
 * @param {Object} spreadsheet - The spreadsheet
 * @param {string} title - The item's name, for the message
 * @param {Object[]} sheets - The tabs it works on
 * @param {function(): CallCell[]} find - Finds the cells to run again
 * @param {function(RunResult): void} [finish] - The item's last step, given what the run did
 * @return {RunResult} What the run did
 */
function runItem_(spreadsheet, title, sheets, find, finish) {
  const startedAt = Date.now();
  const repairedBefore = restoreLeftovers_(sheets);
  const result = rerunInBlocks_(find(), startedAt);
  if (finish !== undefined) finish(result);
  result.repaired = repairedBefore + restoreLeftovers_(sheets);
  report_(spreadsheet, title, result);
  return result;
}

/**
 * Finds the cells whose formula calls one of the functions a pattern
 * names.
 *
 * @param {Object[]} sheets - The tabs to look in
 * @param {RegExp} pattern - Matches a call in a formula
 * @param {boolean} errorsOnly - Whether only cells showing #ERROR! count
 * @return {CallCell[]} The cells, tab by tab, row by row
 */
function findCalls_(sheets, pattern, errorsOnly) {
  const cells = [];
  for (const sheet of sheets) {
    const range = sheet.getDataRange();
    const hits = [];
    range.getFormulas().forEach((row, r) =>
      row.forEach((formula, c) => {
        if (formula !== "" && pattern.test(formula)) {
          hits.push({ r, c, formula });
        }
      }),
    );
    if (hits.length === 0) continue;
    const displays = errorsOnly ? range.getDisplayValues() : null;
    for (const hit of hits) {
      if (errorsOnly && displays[hit.r][hit.c] !== ERROR_DISPLAY) continue;
      cells.push({
        sheet,
        row: range.getRow() + hit.r,
        column: range.getColumn() + hit.c,
        formula: hit.formula,
      });
    }
  }
  return cells;
}

/**
 * Puts back each formula that calls one of the price functions and ends
 * with the `!` a stopped run left, wherever that formula now is. A formula
 * Sheets can read never ends with `!`, so no formula typed by hand is
 * touched.
 *
 * @param {Object[]} sheets - The tabs to look in
 * @return {number} How many formulas it put back
 */
function restoreLeftovers_(sheets) {
  let restored = 0;
  for (const sheet of sheets) {
    const range = sheet.getDataRange();
    range.getFormulas().forEach((row, r) =>
      row.forEach((formula, c) => {
        if (!formula.endsWith("!")) return;
        const typed = formula.slice(0, -1);
        if (!PRICE_CALLS.any.test(typed)) return;
        sheet
          .getRange(range.getRow() + r, range.getColumn() + c)
          .setFormula(typed);
        restored += 1;
      }),
    );
  }
  if (restored > 0) SpreadsheetApp.flush();
  return restored;
}

/**
 * Runs the cells again, a block at a time: breaks each formula, pauses so
 * Sheets saves the edit, puts each formula back, and waits for the block's
 * cells to finish before the next block.
 *
 * @param {CallCell[]} cells - The cells
 * @param {number} startedAt - When the run started, in ms since 1970
 * @return {RunResult} What the run did, with nothing repaired yet
 */
function rerunInBlocks_(cells, startedAt) {
  const result = { reran: [], skipped: [], left: [], repaired: 0, notes: [] };
  for (let start = 0; start < cells.length; start += MENU_CONFIG.BLOCK_SIZE) {
    if (Date.now() - startedAt > MENU_CONFIG.RUN_BUDGET_MS) {
      result.left = cells.slice(start);
      break;
    }
    const block = cells.slice(start, start + MENU_CONFIG.BLOCK_SIZE);
    const broken = breakFormulas_(block, result.skipped);
    SpreadsheetApp.flush();
    Utilities.sleep(MENU_CONFIG.PAUSE_MS);
    const restored = restoreFormulas_(broken, result.skipped);
    SpreadsheetApp.flush();
    waitForCells_(restored);
    result.reran.push(...restored);
  }
  return result;
}

/**
 * Appends `!` to the formula of each cell whose formula still reads as it
 * did when the run found it.
 *
 * @param {CallCell[]} block - The cells
 * @param {CallCell[]} skipped - Takes each cell whose formula changed
 * @return {CallCell[]} The cells broken
 */
function breakFormulas_(block, skipped) {
  const broken = [];
  for (const cell of block) {
    const range = cell.sheet.getRange(cell.row, cell.column);
    if (range.getFormula() !== cell.formula) {
      skipped.push(cell);
      continue;
    }
    range.setFormula(`${cell.formula}!`);
    broken.push(cell);
  }
  return broken;
}

/**
 * Puts back each broken formula that is still where it was broken.
 *
 * @param {CallCell[]} broken - The cells broken
 * @param {CallCell[]} skipped - Takes each cell whose formula changed
 * @return {CallCell[]} The cells put back
 */
function restoreFormulas_(broken, skipped) {
  const restored = [];
  for (const cell of broken) {
    const range = cell.sheet.getRange(cell.row, cell.column);
    if (range.getFormula() !== `${cell.formula}!`) {
      skipped.push(cell);
      continue;
    }
    range.setFormula(cell.formula);
    restored.push(cell);
  }
  return restored;
}

/**
 * Waits until no cell shows that its function is still running, or until
 * `MENU_CONFIG.BLOCK_WAIT_MS` has passed.
 *
 * @param {CallCell[]} cells - The cells
 * @return {void}
 */
function waitForCells_(cells) {
  const deadline = Date.now() + MENU_CONFIG.BLOCK_WAIT_MS;
  while (Date.now() < deadline) {
    const running = cells.some(
      (cell) =>
        cell.sheet.getRange(cell.row, cell.column).getDisplayValue() ===
        LOADING_DISPLAY,
    );
    if (!running) return;
    Utilities.sleep(MENU_CONFIG.POLL_MS);
  }
}

/**
 * The last step of Refresh & freeze historical prices: replaces the
 * formula of each cell run again that gave a number with that number.
 *
 * @param {RunResult} result - What the run did; takes a note of the cells kept
 * @return {void}
 */
function freezeNumbers_(result) {
  let kept = 0;
  for (const cell of result.reran) {
    const range = cell.sheet.getRange(cell.row, cell.column);
    const value = range.getValue();
    if (typeof value === "number" && range.getFormula() === cell.formula) {
      range.setValue(value);
    } else kept += 1;
  }
  SpreadsheetApp.flush();
  result.notes.push(
    `froze ${counted_(result.reran.length - kept, "price")}`,
    ...(kept > 0
      ? [`kept ${counted_(kept, "formula")} that gave no number`]
      : []),
  );
}

/**
 * Says what an item did, in a message at the bottom right of the sheet and
 * in the log.
 *
 * @param {Object} spreadsheet - The spreadsheet
 * @param {string} title - The item's name
 * @param {RunResult} result - What the run did
 * @return {void}
 */
function report_(spreadsheet, title, result) {
  const where = (cell) =>
    `${cell.sheet.getName()}!${cell.sheet.getRange(cell.row, cell.column).getA1Notation()}`;
  const parts = [
    `ran ${counted_(result.reran.length, "cell")} again`,
    ...result.notes,
  ];
  if (result.skipped.length > 0) {
    parts.push(
      `left ${counted_(result.skipped.length, "cell")} alone, since the formulas changed during the run: ${result.skipped.map(where).join(", ")}`,
    );
  }
  if (result.left.length > 0) {
    parts.push(
      `${counted_(result.left.length, "more cell")} did not fit in Google's time for one run; choose the item again for them`,
    );
  }
  if (result.repaired > 0) {
    parts.push(
      `put back ${counted_(result.repaired, "formula")} an earlier run left broken`,
    );
  }
  const message = `${parts.join("; ")}.`;
  console.log(`${title}: ${message}`);
  spreadsheet.toast(message, title, 10);
}

/**
 * A count with its noun, the noun ending in s for any count but 1.
 *
 * @param {number} count - The count
 * @param {string} noun - The noun, for one
 * @return {string} Such as "1 cell" or "3 cells"
 */
function counted_(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
