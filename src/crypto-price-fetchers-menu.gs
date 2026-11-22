/**
 * Crypto Price Fetchers – the menu of the one pasted script
 *
 * PURPOSE
 *   The crypto-price-fetchers repo's Sheets scripts price crypto tokens in
 *   Google Sheets, Google's spreadsheet app, as Apps Script, Google's
 *   platform for scripts that run inside its apps. Its build step,
 *   `npm run build apps-script` (npm is the package manager of Node, the
 *   program that runs JavaScript outside a browser), joins every Sheets
 *   script of the repo into one file to paste into a spreadsheet's Apps
 *   Script project. This file is that file's first
 *   part: the Crypto Price Fetchers menu, which `onOpen` builds each time
 *   the spreadsheet opens, and what its items do. They run the price cells
 *   again, clear cells stuck on #ERROR! or on a busy message, freeze
 *   historical prices, and show Help, a page the build makes from the help
 *   section below and those of the other scripts' headers.
 *
 * <!-- HELP START -->
 * ## The Crypto Price Fetchers menu
 *
 * The menu appears each time the spreadsheet opens. Its items run again
 * the cells that call this file's price functions: `dexToolsGetTokenPrice`
 * and `dexToolsGetTokenFDV`, a token's price and fully diluted value now,
 * from DexTools, a service that prices tokens from the pools of
 * decentralized exchanges, or from x1.ninja, which does the same for X1;
 * `getCryptoPrice`, a token's price at a past time, from centralized
 * exchanges; and the `DEX_SCREENER_` functions of DEX Screener, a service
 * that lists the pairs of decentralized exchanges with their prices, when
 * the file includes them. When an item ends, a message at the bottom right
 * of the sheet says what it did.
 *
 * - Clean up errors: runs again every cell, in every tab, whose own formula
 *   calls `dexToolsGetTokenPrice`, `dexToolsGetTokenFDV`, `getCryptoPrice`
 *   or a `DEX_SCREENER_` function, and that shows `#ERROR!` or one of the
 *   two busy messages, `⌛ Rate limit / busy – retry soon` and
 *   `Rate limit busy - retry later`. A cell that shows `#ERROR!` only
 *   because it reads such a cell clears once that cell has run again.
 * - Refresh: runs again every cell, in every tab, that calls
 *   `dexToolsGetTokenPrice`, `dexToolsGetTokenFDV` or a `DEX_SCREENER_`
 *   function. The scripts keep some answers for a time and give them
 *   again when asked within it: a DexTools or x1.ninja price or FDV above
 *   0 for 5 minutes, as the script is written, or for the seconds the
 *   cell's fourth argument gives, and a DEX Screener answer for 30
 *   seconds; a 0, an error or a busy message is asked for again. So a cell
 *   shows a value at most that old. Cells that call `getCryptoPrice`, a price at a past
 *   time, are left as they are.
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
 *   - Clean up errors takes the cells that show `#ERROR!` or a busy
 *     message. The busy messages are the other scripts' own constants,
 *     `DEXTOOLS_BUSY_MESSAGE` and `EXCHANGE_BUSY_MESSAGE`, which the built
 *     file declares after this part, so they are read when the item runs
 *     (`stuckDisplays_`), never as this file loads.
 *   - A cell runs again when its formula is broken and put back
 *     (`rerunInBlocks_`), in blocks of `MENU_CONFIG.BLOCK_SIZE`. Before each
 *     write, the cell's formula is read again, so a cell that changed, as
 *     when a sort moves the rows, is skipped and reported, never written
 *     into. After a block's formulas are back, the item waits while any of
 *     its cells shows `MENU_CONFIG.LOADING_TEXT`, Sheets' text for a custom
 *     function still running. That text is English as written here; a
 *     spreadsheet set to another language shows its own, which goes in that
 *     field instead, or no block waits for its cells.
 *   - Refresh & freeze historical prices freezes each block's numbers as
 *     soon as the block has run again, so the freeze, too, falls inside the
 *     run's time.
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
 *   gives a price. The repo's tests load it, with the scripts whose busy
 *   messages it reads, against a stand-in of the spreadsheet
 *   (`test/helpers/stand-in-spreadsheet.js`).
 *
 * PROJECT & LICENSE INFORMATION
 *
 *   Part of https://github.com/nottoseethesun/crypto-price-fetchers, under
 *   the Apache 2.0 License. Use at your own risk.
 */

// Declared in crypto-price-fetchers.gs and
// getCryptoPriceFromCentralizedExchange.gs, which the built file holds
// after this part:
/* global DEXTOOLS_BUSY_MESSAGE, EXCHANGE_BUSY_MESSAGE */

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
 * @property {string} LOADING_TEXT   What Sheets shows in a cell whose custom function is still running, in the spreadsheet's language
 */
const MENU_CONFIG = {
  BLOCK_SIZE: 20,
  PAUSE_MS: 1000,
  BLOCK_WAIT_MS: 30000,
  POLL_MS: 1000,
  RUN_BUDGET_MS: 300000,
  LOADING_TEXT: "Loading...",
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

/** A call of a function that gives a current value. */
const CURRENT_CALLS =
  /\b(?:dexToolsGetTokenPrice|dexToolsGetTokenFDV|DEX_SCREENER_\w*)\s*\(/i;

/** A call of the function that gives a price at a past time. */
const HISTORICAL_CALLS = /\bgetCryptoPrice\s*\(/i;

/**
 * The calls the items look for: current values, past prices, and either,
 * each with the `test` of a regular expression.
 */
const PRICE_CALLS = Object.freeze({
  current: CURRENT_CALLS,
  historical: HISTORICAL_CALLS,
  any: Object.freeze({
    test: (formula) =>
      CURRENT_CALLS.test(formula) || HISTORICAL_CALLS.test(formula),
  }),
});

/** What Sheets shows in a cell whose custom function failed. */
const ERROR_DISPLAY = "#ERROR!";

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
 * calls one of the price functions and shows #ERROR! or a busy message.
 *
 * @return {void}
 */
function cleanUpErrors() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = spreadsheet.getSheets();
  const stuck = stuckDisplays_();
  runItem_(spreadsheet, "Clean up errors", sheets, () =>
    findCalls_(sheets, PRICE_CALLS.any, stuck),
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
    findCalls_(sheets, PRICE_CALLS.current, null),
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
    () => findCalls_([sheet], PRICE_CALLS.historical, null),
    { eachBlock: freezeNumbers_, notes: freezeNotes_ },
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
 * What an item does after each block, beside running its cells again.
 *
 * @typedef {Object} BlockStep
 * @property {function(CallCell[]): Object} eachBlock  Takes the block's cells once they have run again; gives what it did
 * @property {function(Object[]): string[]} notes      What the message says of what `eachBlock` gave, block by block
 */

/**
 * What a run did.
 *
 * @typedef {Object} RunResult
 * @property {CallCell[]} reran    The cells run again
 * @property {CallCell[]} skipped  The cells left alone, since their formulas changed during the run
 * @property {CallCell[]} left     The cells no block reached within the run's time
 * @property {Object[]} outcomes   What the item's step gave for each block, in order
 */

/**
 * What a cell shows when it needs to run again: Sheets' error, or one of
 * the price scripts' busy messages.
 *
 * @return {string[]} The texts
 */
function stuckDisplays_() {
  return [ERROR_DISPLAY, DEXTOOLS_BUSY_MESSAGE, EXCHANGE_BUSY_MESSAGE];
}

/**
 * Runs one item: puts back broken formulas left behind, finds the cells,
 * runs them again, a block at a time with the item's step after each, puts
 * back any broken formula left again, and reports.
 *
 * @param {Object} spreadsheet - The spreadsheet
 * @param {string} title - The item's name, for the message
 * @param {Object[]} sheets - The tabs it works on
 * @param {function(): CallCell[]} find - Finds the cells to run again
 * @param {BlockStep} [step] - What it does after each block
 * @return {void}
 */
function runItem_(spreadsheet, title, sheets, find, step) {
  const startedAt = Date.now();
  const repairedBefore = restoreLeftovers_(sheets);
  const eachBlock = step === undefined ? undefined : step.eachBlock;
  const run = rerunInBlocks_(find(), startedAt, eachBlock);
  const repaired = repairedBefore + restoreLeftovers_(sheets);
  const notes = step === undefined ? [] : step.notes(run.outcomes);
  report_(spreadsheet, title, run, notes, repaired);
}

/**
 * Finds the cells whose formula calls one of the functions a pattern
 * names.
 *
 * @param {Object[]} sheets - The tabs to look in
 * @param {{test: function(string): boolean}} pattern - Tells whether a formula holds a call, as `PRICE_CALLS`' members do
 * @param {?string[]} shownAs - The displayed texts a cell must show to count, or null for any
 * @return {CallCell[]} The cells, tab by tab, row by row
 */
function findCalls_(sheets, pattern, shownAs) {
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
    const displays = shownAs === null ? null : range.getDisplayValues();
    for (const hit of hits) {
      if (shownAs !== null && !shownAs.includes(displays[hit.r][hit.c])) {
        continue;
      }
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
 * Sheets saves the edit, puts each formula back, waits for the block's
 * cells to finish, and hands them to the item's step, before the next
 * block.
 *
 * @param {CallCell[]} cells - The cells
 * @param {number} startedAt - When the run started, in ms since 1970
 * @param {function(CallCell[]): Object} [eachBlock] - The item's step after each block
 * @return {RunResult} What the run did
 */
function rerunInBlocks_(cells, startedAt, eachBlock) {
  const reran = [];
  const skipped = [];
  const outcomes = [];
  for (let start = 0; start < cells.length; start += MENU_CONFIG.BLOCK_SIZE) {
    if (Date.now() - startedAt > MENU_CONFIG.RUN_BUDGET_MS) {
      return { reran, skipped, left: cells.slice(start), outcomes };
    }
    const block = cells.slice(start, start + MENU_CONFIG.BLOCK_SIZE);
    const broke = breakFormulas_(block);
    SpreadsheetApp.flush();
    Utilities.sleep(MENU_CONFIG.PAUSE_MS);
    const put = restoreFormulas_(broke.broken);
    SpreadsheetApp.flush();
    waitForCells_(put.restored);
    if (eachBlock !== undefined) outcomes.push(eachBlock(put.restored));
    reran.push(...put.restored);
    skipped.push(...broke.changed, ...put.changed);
  }
  return { reran, skipped, left: [], outcomes };
}

/**
 * Appends `!` to the formula of each cell whose formula still reads as it
 * did when the run found it.
 *
 * @param {CallCell[]} block - The cells
 * @return {{broken: CallCell[], changed: CallCell[]}} The cells broken, and those whose formula had changed
 */
function breakFormulas_(block) {
  const broken = [];
  const changed = [];
  for (const cell of block) {
    const range = cell.sheet.getRange(cell.row, cell.column);
    if (range.getFormula() !== cell.formula) {
      changed.push(cell);
      continue;
    }
    range.setFormula(`${cell.formula}!`);
    broken.push(cell);
  }
  return { broken, changed };
}

/**
 * Puts back each broken formula that is still where it was broken.
 *
 * @param {CallCell[]} broken - The cells broken
 * @return {{restored: CallCell[], changed: CallCell[]}} The cells put back, and those whose formula had changed
 */
function restoreFormulas_(broken) {
  const restored = [];
  const changed = [];
  for (const cell of broken) {
    const range = cell.sheet.getRange(cell.row, cell.column);
    if (range.getFormula() !== `${cell.formula}!`) {
      changed.push(cell);
      continue;
    }
    range.setFormula(cell.formula);
    restored.push(cell);
  }
  return { restored, changed };
}

/**
 * Waits until no cell shows `MENU_CONFIG.LOADING_TEXT`, or until
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
        MENU_CONFIG.LOADING_TEXT,
    );
    if (!running) return;
    Utilities.sleep(MENU_CONFIG.POLL_MS);
  }
}

/**
 * Refresh & freeze historical prices' step after each block: replaces the
 * formula of each cell that gave a number with that number.
 *
 * @param {CallCell[]} cells - The block's cells, run again
 * @return {{frozen: number, kept: number}} How many it froze, and how many formulas it kept
 */
function freezeNumbers_(cells) {
  let frozen = 0;
  for (const cell of cells) {
    const range = cell.sheet.getRange(cell.row, cell.column);
    const value = range.getValue();
    if (typeof value === "number" && range.getFormula() === cell.formula) {
      range.setValue(value);
      frozen += 1;
    }
  }
  SpreadsheetApp.flush();
  return { frozen, kept: cells.length - frozen };
}

/**
 * What the message of Refresh & freeze historical prices says of its
 * blocks.
 *
 * @param {Array<{frozen: number, kept: number}>} outcomes - What `freezeNumbers_` gave, block by block
 * @return {string[]} The notes
 */
function freezeNotes_(outcomes) {
  const frozen = outcomes.reduce((sum, outcome) => sum + outcome.frozen, 0);
  const kept = outcomes.reduce((sum, outcome) => sum + outcome.kept, 0);
  const notes = [`froze ${counted_(frozen, "price")}`];
  if (kept > 0) {
    notes.push(`kept ${counted_(kept, "formula")} that gave no number`);
  }
  return notes;
}

/**
 * Says what an item did, in a message at the bottom right of the sheet and
 * in the log.
 *
 * @param {Object} spreadsheet - The spreadsheet
 * @param {string} title - The item's name
 * @param {RunResult} run - What the run did
 * @param {string[]} notes - What the item's step adds
 * @param {number} repaired - How many formulas an earlier run left broken it put back
 * @return {void}
 */
function report_(spreadsheet, title, run, notes, repaired) {
  const where = (cell) =>
    `${cell.sheet.getName()}!${cell.sheet.getRange(cell.row, cell.column).getA1Notation()}`;
  const parts = [`ran ${counted_(run.reran.length, "cell")} again`, ...notes];
  if (run.skipped.length > 0) {
    parts.push(
      `left ${counted_(run.skipped.length, "cell")} alone, since the formulas changed during the run: ${run.skipped.map(where).join(", ")}`,
    );
  }
  if (run.left.length > 0) {
    parts.push(
      `${counted_(run.left.length, "more cell")} did not fit in Google's time for one run; choose the item again for them`,
    );
  }
  if (repaired > 0) {
    parts.push(
      `put back ${counted_(repaired, "formula")} an earlier run left broken`,
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
