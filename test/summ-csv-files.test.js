/**
 * Tests for the Summ csv utility's files: the template it reads, the
 * settings it ships, the file `writeSummCsv` writes, the command line,
 * `npm run summ-csv`, and what the package ships for it. Part one,
 * `summ-csv.test.js`, covers the rules and the text of a file.
 * @module test/summ-csv-files.test
 *
 * Every file a test writes goes in a temp folder of its own
 * (`helpers/temp-folders.js`), never in the repo or the owner's files.
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  readSummCsvSettings,
  readTemplateHeader,
  summCsvText,
  writeSummCsv,
} from "../summ-csv/index.js";
import { formText } from "../summ-csv/values.js";
import { runSummCsv } from "../summ-csv/command-line.js";
import { capturedOutput } from "./helpers/captured-output.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";
import {
  OTHER_HASH,
  summHeader,
  summTemplate,
  tokenRow,
} from "./helpers/summ-csv-rows.js";

after(removeTempFolders);

/** The repo's top folder. */
const REPO_TOP = path.resolve(import.meta.dirname, "..");

/**
 * Two rows as the rows file holds them: JSON, whose amounts are text.
 *
 * @returns {object[]} The rows
 */
function jsonRows() {
  return [
    tokenRow({ baseAmount: { raw: "8355037234293", decimals: 8 } }),
    tokenRow({ baseAmount: "1.5", id: OTHER_HASH }),
  ];
}

/**
 * Runs the command line with its output caught.
 *
 * @param {string[]} args - The arguments after the program's name
 * @returns {{exitCode: number, stdout: string, stderr: string}} What the
 *   run returned and printed
 */
function runWith(args) {
  const stdout = capturedOutput();
  const stderr = capturedOutput();
  const exitCode = runSummCsv(["node", "summ-csv.js", ...args], {
    stdout,
    stderr,
  });
  return { exitCode, stdout: stdout.text, stderr: stderr.text };
}

/**
 * A rows file and the path of a csv beside it, in a temp folder.
 *
 * @param {*} rows - What the rows file holds
 * @returns {{rows: string, out: string}} The two paths
 */
function rowsFile(rows) {
  const folder = makeTempFolder("summ-csv");
  const file = path.join(folder, "rows.json");
  fs.writeFileSync(file, JSON.stringify(rows));
  return { rows: file, out: path.join(folder, "out.csv") };
}

describe("the shipped settings", () => {
  it("hold PulseChain, its own coin and its forms, and USD for reference prices", () => {
    const settings = readSummCsvSettings();

    assert.deepEqual(settings.referencePriceCurrencies, ["USD"]);
    assert.equal(settings.chains.pulsechain.ownCoin, "PLS");
    assert.equal(
      formText(settings.chains.pulsechain.transactionHash),
      "0x and 64 hex digits",
    );
    assert.equal(
      formText(settings.chains.pulsechain.address),
      "0x and 40 hex digits",
    );
  });

  it("give every chain an own coin and forms of a known alphabet and a length", () => {
    for (const [name, chain] of Object.entries(readSummCsvSettings().chains)) {
      assert.equal(typeof chain.ownCoin, "string", name);
      for (const form of [chain.transactionHash, chain.address]) {
        assert.equal(typeof formText(form), "string", name);
        assert.ok(
          Number.isInteger(form.length) ||
            (Number.isInteger(form.minLength) &&
              Number.isInteger(form.maxLength)),
          name,
        );
      }
    }
  });
});

describe("readTemplateHeader", () => {
  it("gives the template's first line as it is written, padding and all", () => {
    assert.match(summHeader(), /^Timestamp \(UTC\),Type,/);
    assert.match(summHeader(), /, ID \(Optional\),/);
    assert.match(summHeader(), /, Contract Address \(Optional\)$/);
  });

  it("drops a byte-order mark, a Windows line ending and any line after", () => {
    const file = path.join(makeTempFolder("summ-csv"), "template.csv");
    const byteOrderMark = String.fromCodePoint(0xfeff);
    fs.writeFileSync(
      file,
      `${byteOrderMark}${summHeader()}\r\nan example row\r\n`,
    );

    assert.equal(readTemplateHeader(file), summHeader());
  });
});

describe("writeSummCsv", () => {
  it("writes the file's text, and says how many rows went where", () => {
    const outPath = path.join(makeTempFolder("summ-csv"), "out.csv");
    const rows = [tokenRow()];

    const written = writeSummCsv({
      rows,
      templatePath: summTemplate(),
      outPath,
    });

    assert.deepEqual(written, { rowCount: 1, outPath });
    assert.equal(
      fs.readFileSync(outPath, "utf8"),
      summCsvText(rows, summHeader()),
    );
  });

  it("leaves a file already there as it is, unless told to replace it", () => {
    const outPath = path.join(makeTempFolder("summ-csv"), "out.csv");
    fs.writeFileSync(outPath, "the owner's file");
    const file = { rows: [tokenRow()], templatePath: summTemplate(), outPath };

    assert.throws(
      () => writeSummCsv(file),
      /out\.csv exists already, and is written over only when the call says to replace it/,
    );
    assert.equal(fs.readFileSync(outPath, "utf8"), "the owner's file");

    writeSummCsv({ ...file, replace: true });

    assert.equal(
      fs.readFileSync(outPath, "utf8"),
      summCsvText(file.rows, summHeader()),
    );
    assert.equal(fs.existsSync(`${outPath}.tmp`), false);
  });

  it("writes nothing when a row breaks a rule", () => {
    const outPath = path.join(makeTempFolder("summ-csv"), "out.csv");

    assert.throws(
      () =>
        writeSummCsv({
          rows: [tokenRow({ contractAddress: "" })],
          templatePath: summTemplate(),
          outPath,
        }),
      (thrown) => thrown.problems.length === 1,
    );
    assert.equal(fs.existsSync(outPath), false);
  });

  it("passes on an error of the disk other than a file already there", () => {
    const outPath = path.join(makeTempFolder("summ-csv"), "no-folder", "x.csv");

    assert.throws(
      () =>
        writeSummCsv({
          rows: [tokenRow()],
          templatePath: summTemplate(),
          outPath,
        }),
      { code: "ENOENT" },
    );
  });
});

describe("the command line", () => {
  it("writes the file from a JSON file of rows, and says so", () => {
    const paths = rowsFile(jsonRows());

    const run = runWith([
      "--rows",
      paths.rows,
      "--template",
      summTemplate(),
      "--out",
      paths.out,
    ]);

    assert.equal(run.exitCode, 0);
    assert.equal(run.stdout, `Wrote 2 rows to ${paths.out}.\n`);
    assert.equal(
      fs.readFileSync(paths.out, "utf8"),
      summCsvText(jsonRows(), summHeader()),
    );
  });

  it("says 1 row for one row", () => {
    const paths = rowsFile([tokenRow({ baseAmount: "2" })]);

    const run = runWith([
      "--rows",
      paths.rows,
      "--template",
      summTemplate(),
      "--out",
      paths.out,
    ]);

    assert.equal(run.stdout, `Wrote 1 row to ${paths.out}.\n`);
  });

  it("lists every problem and writes nothing, with exit code 1", () => {
    const paths = rowsFile([tokenRow({ baseAmount: "2", type: "gift-in" })]);

    const run = runWith([
      "--rows",
      paths.rows,
      "--template",
      summTemplate(),
      "--out",
      paths.out,
    ]);

    assert.equal(run.exitCode, 1);
    assert.equal(
      run.stderr,
      `Nothing was written: 1 problem.\nrow 1: type "gift-in" is not one Summ's csv import takes\n`,
    );
    assert.equal(fs.existsSync(paths.out), false);
  });

  it("writes over a file already at --out only with --replace", () => {
    const paths = rowsFile([tokenRow({ baseAmount: "2" })]);
    fs.writeFileSync(paths.out, "the owner's file");
    const args = [
      "--rows",
      paths.rows,
      "--template",
      summTemplate(),
      "--out",
      paths.out,
    ];

    assert.equal(runWith(args).exitCode, 1);
    assert.equal(fs.readFileSync(paths.out, "utf8"), "the owner's file");
    assert.equal(runWith([...args, "--replace"]).exitCode, 0);
    assert.match(fs.readFileSync(paths.out, "utf8"), /^Timestamp \(UTC\)/);
  });

  it("reports a rows file that holds no JSON", () => {
    const paths = rowsFile([]);
    fs.writeFileSync(paths.rows, "not json");

    const run = runWith([
      "--rows",
      paths.rows,
      "--template",
      summTemplate(),
      "--out",
      paths.out,
    ]);

    assert.equal(run.exitCode, 1);
    assert.match(run.stderr, /JSON/);
  });

  it("refuses a run without an option it needs", () => {
    const run = runWith(["--rows", "rows.json", "--template", "t.csv"]);

    assert.equal(run.exitCode, 1);
    assert.match(run.stderr, /required option '--out <file>' not specified/);
  });

  it("gives its help, with the keys of a row, and exit code 0", () => {
    const run = runWith(["--help"]);

    assert.equal(run.exitCode, 0);
    assert.match(run.stdout, /Usage: summ-csv \[options\]/);
    assert.match(run.stdout, /The rows file holds a JSON array/);
    assert.match(
      run.stdout,
      /Exit codes: 0 when the file was written; 1 when it was not\./,
    );
  });
});

describe("the package", () => {
  it("ships the utility, its settings and its bin to a project that installs it", () => {
    const packed = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: REPO_TOP,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    )[0];
    const files = packed.files.map((file) => file.path);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_TOP, "package.json"), "utf8"),
    );

    assert.equal(manifest.bin["summ-csv"], "summ-csv.js");
    assert.equal(manifest.exports["./summ-csv"], "./summ-csv/index.js");
    assert.equal(manifest.scripts["summ-csv"], "node summ-csv.js");
    for (const file of [
      "summ-csv.js",
      "summ-csv/index.js",
      "summ-csv/columns.js",
      "summ-csv/values.js",
      "summ-csv/rules.js",
      "summ-csv/command-line.js",
      "summ-csv/settings.json",
      "summ-csv/README.md",
    ])
      assert.ok(files.includes(file), file);
  });

  it("runs as a program, from its entry point", () => {
    const help = execFileSync(process.execPath, ["summ-csv.js", "--help"], {
      cwd: REPO_TOP,
      encoding: "utf8",
    });

    assert.match(help, /Usage: summ-csv/);
  });
});
