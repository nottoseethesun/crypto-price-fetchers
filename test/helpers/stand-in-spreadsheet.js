/**
 * A spreadsheet held in memory, standing in for Apps Script's
 * `SpreadsheetApp` and `HtmlService`, for the tests of the menu items a
 * Sheets script adds.
 * @module test/helpers/stand-in-spreadsheet
 *
 * What: `standInSpreadsheet` builds tabs of cells from rows a test
 * describes, and gives the two services, to hand a Sheets script with the
 * runner's others, with a record of what the script did: each formula
 * written, each flush, each message shown, each menu and dialog.
 *
 * How it stands in for Sheets:
 *
 * - A cell holds a formula, a value and what it displays. A cell written
 *   as a string that starts with `=` holds that formula, which has not run
 *   yet; an object `{ formula, value, display }` holds a formula that has
 *   run, as a sheet opened with it does; any other value is a plain value.
 * - A formula written with `setFormula` waits for the next
 *   `SpreadsheetApp.flush()`, as Sheets' recalculation does; a formula
 *   ending in `!`, which Sheets cannot read, shows `#ERROR!` at once. At
 *   the flush, each waiting formula runs: the test's `evaluate` gives its
 *   value, and the run is counted for its cell (`runsOf`). After a run, a
 *   cell shows `Loading...`, or the test's `loadingText`, for the number of
 *   `getDisplayValue` reads the test sets (`loadingReads`), as a custom
 *   function still running does.
 * - Each formula and value written is recorded with `seq`, its place in
 *   the order of all writes, so a test can tell which came first.
 * - `onSetFormula`, when given, is called after each formula written, so a
 *   test can change other cells mid-run, as a person sorting the tab
 *   would.
 * - `getUi().alert` answers with the button the test names (`answer`).
 */

/**
 * One cell, as a test describes it: a formula, as a string starting with
 * `=`; a formula that has run, with its value and what it displays; or a
 * plain value.
 *
 * @typedef {string|number|boolean|{formula: string, value: *, display: string}} CellText
 */

/**
 * Column letters of a column number, from 1: 1 is A, 27 is AA.
 *
 * @param {number} column - The column
 * @returns {string} Its letters
 */
function columnLetters(column) {
  let letters = "";
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}

/**
 * A cell from a test's description.
 *
 * @param {CellText} text - The description
 * @returns {{formula: string, value: *, display: string, loadingLeft: number}} The cell
 */
function cellOf(text) {
  if (text !== null && typeof text === "object") {
    return {
      formula: text.formula,
      value: text.value ?? text.display,
      display: text.display ?? String(text.value),
      loadingLeft: 0,
    };
  }
  if (typeof text === "string" && text.startsWith("=")) {
    return { formula: text, value: "", display: "", loadingLeft: 0 };
  }
  return { formula: "", value: text, display: String(text), loadingLeft: 0 };
}

/**
 * Builds the stand-in spreadsheet.
 *
 * @param {Object} options - The spreadsheet
 * @param {Object<string, CellText[][]>} options.tabs - Each tab's rows, by the tab's name, in order
 * @param {function(string, {tab: string, a1: string}): *} [options.evaluate] - The value a formula gives when it runs; 0 when absent
 * @param {number} [options.loadingReads=0] - How many reads of a cell's display show `loadingText` after it runs
 * @param {string} [options.loadingText="Loading..."] - What a cell still running shows
 * @param {string} [options.activeTab] - The tab the person is on; the first when absent
 * @param {string} [options.answer="YES"] - The button `alert` answers with
 * @param {function({tab: string, a1: string, formula: string}, Object): void} [options.onSetFormula] - Called after each formula written, with the spreadsheet's `cellAt`
 * @returns {Object} The services (`SpreadsheetApp`, `HtmlService`) and what the script did
 */
export function standInSpreadsheet({
  tabs,
  evaluate = () => 0,
  loadingReads = 0,
  loadingText = "Loading...",
  activeTab,
  answer = "YES",
  onSetFormula,
}) {
  const record = {
    formulasWritten: [],
    valuesWritten: [],
    flushes: 0,
    toasts: [],
    alerts: [],
    menus: [],
    dialogs: [],
  };
  const runs = new Map();
  let writes = 0;
  const waiting = [];
  const grid = new Map(
    Object.entries(tabs).map(([name, rows]) => [
      name,
      rows.map((row) => row.map(cellOf)),
    ]),
  );

  /**
   * A cell by its tab, row and column, made empty where the tab has none.
   *
   * @param {string} tab - The tab's name
   * @param {number} row - The row, from 1
   * @param {number} column - The column, from 1
   * @returns {Object} The cell
   */
  const cellAt = (tab, row, column) => {
    const rows = grid.get(tab);
    while (rows.length < row) rows.push([]);
    const cells = rows[row - 1];
    while (cells.length < column) cells.push(cellOf(""));
    return cells[column - 1];
  };
  /**
   * A cell's A1 notation.
   *
   * @param {number} row - The row, from 1
   * @param {number} column - The column, from 1
   * @returns {string} Such as "B2"
   */
  const a1Of = (row, column) => `${columnLetters(column)}${row}`;

  /**
   * The range of one cell, with the methods of Apps Script's that the
   * scripts call.
   *
   * @param {string} tab - The tab's name
   * @param {number} row - The row, from 1
   * @param {number} column - The column, from 1
   * @returns {Object} The range
   */
  const cellRange = (tab, row, column) => ({
    getFormula: () => cellAt(tab, row, column).formula,
    getValue: () => cellAt(tab, row, column).value,
    getDisplayValue: () => {
      const cell = cellAt(tab, row, column);
      if (cell.loadingLeft > 0) {
        cell.loadingLeft -= 1;
        return loadingText;
      }
      return cell.display;
    },
    getA1Notation: () => a1Of(row, column),
    setFormula: (formula) => {
      const cell = cellAt(tab, row, column);
      const a1 = a1Of(row, column);
      cell.formula = formula;
      if (formula.endsWith("!")) {
        cell.value = "#ERROR!";
        cell.display = "#ERROR!";
      } else waiting.push({ tab, row, column });
      writes += 1;
      record.formulasWritten.push({ tab, a1, formula, seq: writes });
      onSetFormula?.({ tab, a1, formula }, { cellAt: cellAtA1 });
    },
    setValue: (value) => {
      const cell = cellAt(tab, row, column);
      cell.formula = "";
      cell.value = value;
      cell.display = String(value);
      writes += 1;
      record.valuesWritten.push({
        tab,
        a1: a1Of(row, column),
        value,
        seq: writes,
      });
    },
  });

  /**
   * A cell by its tab and A1 notation.
   *
   * @param {string} tab - The tab's name
   * @param {string} a1 - Such as "B2"
   * @returns {Object} The cell
   */
  const cellAtA1 = (tab, a1) => {
    const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(a1);
    const column = [...letters].reduce(
      (sum, letter) => sum * 26 + letter.charCodeAt(0) - 64,
      0,
    );
    return cellAt(tab, Number(digits), column);
  };

  /**
   * A tab, with the methods of Apps Script's sheet that the scripts call.
   *
   * @param {string} tab - The tab's name
   * @returns {Object} The sheet
   */
  const sheetOf = (tab) => ({
    getName: () => tab,
    getRange: (row, column) => cellRange(tab, row, column),
    getDataRange: () => {
      const rows = grid.get(tab);
      const width = Math.max(1, ...rows.map((cells) => cells.length));
      const height = Math.max(1, rows.length);
      const read = (field) =>
        Array.from({ length: height }, (_, r) =>
          Array.from(
            { length: width },
            (_, c) => (rows[r]?.[c] ?? cellOf(""))[field],
          ),
        );
      return {
        getRow: () => 1,
        getColumn: () => 1,
        getFormulas: () => read("formula"),
        getDisplayValues: () => read("display"),
      };
    },
  });

  const sheets = [...grid.keys()].map(sheetOf);
  const spreadsheet = {
    getSheets: () => sheets,
    getActiveSheet: () =>
      sheets.find(
        (sheet) => sheet.getName() === (activeTab ?? sheets[0].getName()),
      ),
    toast: (message, title, seconds) =>
      record.toasts.push({ message, title, seconds }),
  };

  const ui = {
    ButtonSet: { YES_NO: "YES_NO", OK: "OK" },
    Button: { YES: "YES", NO: "NO", OK: "OK" },
    alert: (title, prompt, buttons) => {
      record.alerts.push({ title, prompt, buttons });
      return answer;
    },
    createMenu: (name) => {
      const menu = { name, items: [] };
      const builder = {
        addItem: (caption, functionName) => {
          menu.items.push({ caption, functionName });
          return builder;
        },
        addSeparator: () => {
          menu.items.push({ separator: true });
          return builder;
        },
        addToUi: () => {
          record.menus.push(menu);
        },
      };
      return builder;
    },
    showModelessDialog: (output, title) =>
      record.dialogs.push({ html: output.getContent(), title, output }),
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => spreadsheet,
    getUi: () => ui,
    flush: () => {
      record.flushes += 1;
      for (const { tab, row, column } of waiting.splice(0)) {
        const cell = cellAt(tab, row, column);
        if (cell.formula === "" || cell.formula.endsWith("!")) continue;
        const a1 = a1Of(row, column);
        const value = evaluate(cell.formula, { tab, a1 });
        cell.value = value;
        cell.display = String(value);
        cell.loadingLeft = loadingReads;
        const key = `${tab}!${a1}`;
        runs.set(key, (runs.get(key) ?? 0) + 1);
      }
    },
  };

  const HtmlService = {
    createHtmlOutput: (html) => {
      const output = {
        width: undefined,
        height: undefined,
        getContent: () => html,
        setWidth: (width) => {
          output.width = width;
          return output;
        },
        setHeight: (height) => {
          output.height = height;
          return output;
        },
      };
      return output;
    },
  };

  return {
    SpreadsheetApp,
    HtmlService,
    record,
    /** How many times a cell's formula ran, by `Tab!A1`. */
    runsOf: (key) => runs.get(key) ?? 0,
    /** A cell, by its tab and A1 notation. */
    cellAt: cellAtA1,
  };
}
