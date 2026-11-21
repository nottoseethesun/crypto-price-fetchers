/**
 * Tests for apps-script-build/help-page.js, which makes the page the Help
 * item of the Crypto Price Fetchers menu shows.
 * @module test/help-page.test
 *
 * `helpSection` is tested on texts written here and on the repo's own
 * files, whose help sections the build reads; `helpPage` on Markdown
 * written here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  HELP_END,
  HELP_START,
  helpPage,
  helpSection,
} from "../apps-script-build/help-page.js";

/**
 * A script header holding the lines given between the two markers.
 *
 * @param {string[]} lines - The section's lines, without the comment's margin
 * @returns {string} The header
 */
function header(lines) {
  return [
    "/**",
    " * A script",
    " *",
    ` * ${HELP_START}`,
    ...lines.map((line) => (line === "" ? " *" : ` * ${line}`)),
    ` * ${HELP_END}`,
    " */",
    "function f() {}",
  ].join("\n");
}

/**
 * The page's body, without the head.
 *
 * @param {string[]} sections - The sections' Markdown
 * @returns {string} The body's HTML
 */
function bodyOf(sections) {
  const page = helpPage(sections);
  return page.slice(page.indexOf("<body>") + 6, page.indexOf("</body>")).trim();
}

describe("helpSection", () => {
  it("takes the lines between the markers, without the comment's margin, keeping the indent after it", () => {
    const section = helpSection(
      header(["## Title", "", "- item", "  more of the item"]),
      "a.gs",
    );
    assert.equal(section, "## Title\n\n- item\n  more of the item");
  });

  it("takes a Markdown file's section as written, its emphasis included", () => {
    const markdown = `# A file\n\n${HELP_START}\n## Title\n*word* stays\n${HELP_END}\n`;
    assert.equal(helpSection(markdown, "a.md"), "## Title\n*word* stays");
  });

  it("refuses a missing or doubled marker, markers out of order, and a section with no text", () => {
    assert.throws(
      () => helpSection("/** no help */", "a.gs"),
      /a\.gs must hold one <!-- HELP START --> line and one <!-- HELP END --> line, around the help section; it holds 0 and 0/,
    );
    assert.throws(
      () => helpSection(`${HELP_START}\n${HELP_START}\nx\n${HELP_END}`, "b.gs"),
      /it holds 2 and 1/,
    );
    assert.throws(
      () => helpSection(`${HELP_END}\nx\n${HELP_START}`, "c.gs"),
      /c\.gs's <!-- HELP END --> line comes before its <!-- HELP START --> line/,
    );
    assert.throws(
      () => helpSection(header(["", ""]), "d.gs"),
      /d\.gs's help section holds no text/,
    );
  });

  it("reads the help section of each file the build takes one from", () => {
    const files = {
      "crypto-price-fetchers-menu.gs": "## The Crypto Price Fetchers menu",
      "crypto-price-fetchers.gs":
        "## Current prices: dexToolsGetTokenPrice and dexToolsGetTokenFDV",
      "fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.gs":
        "## Past prices: getCryptoPrice",
      "apps-script-build/dex-screener-help.md": "## DEX Screener's functions",
    };
    for (const [file, heading] of Object.entries(files)) {
      const source = fs.readFileSync(
        new URL(`../${file}`, import.meta.url),
        "utf8",
      );
      const section = helpSection(source, file);
      assert.ok(section.startsWith(`${heading}\n`), file);
      assert.ok(!/^\s*\* /m.test(section), `${file} keeps a comment margin`);
    }
  });
});

describe("helpPage", () => {
  it("makes one page, whose links open in a new tab, from the sections in order", () => {
    const page = helpPage(["## One", "## Two"]);
    assert.match(
      page,
      /^<!DOCTYPE html>\n<html><head><meta charset="utf-8"><base target="_blank">/,
    );
    assert.ok(page.indexOf("<h2>One</h2>") < page.indexOf("<h2>Two</h2>"));
  });

  it("writes headings, paragraphs whose lines join, and lists whose items run on over indented lines", () => {
    assert.equal(
      bodyOf([
        "## Title\n\nA line\nand the next.\n\n### Part\n- first\n  still first\n- second\nAfter the list.",
      ]),
      [
        "<h2>Title</h2>",
        "<p>A line and the next.</p>",
        "<h3>Part</h3>",
        "<ul><li>first still first</li><li>second</li></ul>",
        "<p>After the list.</p>",
      ].join("\n"),
    );
  });

  it("escapes the text before it marks code and links, and links only an http or https url", () => {
    assert.equal(
      bodyOf([
        'Use `=f("<x>", 0)` & see [the docs](https://example.com/a?b=1), not [this](javascript:alert(1)).',
      ]),
      '<p>Use <code>=f(&quot;&lt;x&gt;&quot;, 0)</code> &amp; see <a href="https://example.com/a?b=1">the docs</a>, not [this](javascript:alert(1)).</p>',
    );
  });

  it("keeps a fenced block's lines as they are, escaped, and closes a block left open at the end", () => {
    assert.equal(
      bodyOf([
        'Before.\n```text\n=f("a")\n  =g(<b>)\n```\nAfter.',
        "```\nopen",
      ]),
      [
        "<p>Before.</p>",
        "<pre><code>=f(&quot;a&quot;)\n  =g(&lt;b&gt;)</code></pre>",
        "<p>After.</p>",
        "<pre><code>open</code></pre>",
      ].join("\n"),
    );
  });
});
