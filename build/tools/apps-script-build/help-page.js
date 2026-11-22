/**
 * The page the Help item of the Crypto Price Fetchers menu shows, made
 * from the help sections of the Sheets scripts' headers.
 * @module apps-script-build/help-page
 *
 * What: how to use the pasted script is written once, in a section of the
 * header of each Sheets script file that a person at the sheet needs.
 * `helpSection` takes one file's section, and `helpPage` turns the
 * sections into one HTML page, which the build sets as `HELP_PAGE.HTML` in the
 * file it gives, for the menu's Help item to show.
 *
 * How:
 *
 * - Two lines mark a section: `<!-- HELP START -->` before it and
 *   `<!-- HELP END -->` after it, in a script's header comment or in a
 *   Markdown file. Each line between them loses its leading ` * `, the
 *   comment's margin, where it has one, and keeps any indent after it. A marker
 *   that is missing or doubled, or a section with no text, stops the
 *   build, naming the file, so Help never ships blank.
 * - A section is written in a small part of Markdown, which stays readable
 *   as plain text in the Apps Script editor: `##` and `###` headings,
 *   paragraphs, `-` lists, `` `code` ``, fenced code blocks for formulas,
 *   and links written `[text](url)`. Anything else shows as plain text.
 * - `&`, `<` and `>` are escaped before anything else, since examples hold
 *   text such as `"<x1-pool-address>"`. Only an `http` or `https` url
 *   becomes a link, and the page's `<base target="_blank">` opens each link
 *   in a new tab, since a dialog's sandbox allows only `_blank` or `_top`.
 *
 * Fit: `index.js` builds the page from the scripts' files, and DEX
 * Screener's section (`dex-screener-help.md`) when its functions go in.
 */

/** The line that opens a help section. */
export const HELP_START = "<!-- HELP START -->";

/** The line that closes a help section. */
export const HELP_END = "<!-- HELP END -->";

/**
 * A comment line's margin: spaces, then an asterisk followed by a space or
 * nothing. A Markdown file's lines have none, and its emphasis, such as
 * `*word*`, does not match.
 */
const COMMENT_MARGIN = /^\s*\*(?: |$)/;

/** The page's style: the sheet's own font, code set apart. */
const STYLE = [
  "body{font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#202124;margin:12px 16px}",
  "h2{font-size:17px;margin:20px 0 6px;border-bottom:1px solid #dadce0;padding-bottom:3px}",
  "h3{font-size:14px;margin:14px 0 4px}",
  "code{font-family:Consolas,Menlo,monospace;background:#f1f3f4;padding:0 3px;border-radius:3px}",
  "pre{background:#f1f3f4;padding:8px 10px;border-radius:4px;overflow-x:auto}",
  "pre code{background:none;padding:0}",
  "ul{padding-left:20px;margin:4px 0}",
  "li{margin:2px 0}",
].join("");

/**
 * Escapes the characters HTML gives a meaning to.
 *
 * @param {string} text - The text
 * @returns {string} The text, safe inside an element or attribute
 */
function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Takes the help section of one file's header.
 *
 * @param {string} source - The file's text
 * @param {string} name - The file's name, for the error messages
 * @returns {string} The section's lines, without the comment's margin
 * @throws {Error} When a marker is missing or doubled, or the section holds no text
 */
export function helpSection(source, name) {
  const lines = source.split("\n");
  /**
   * The indexes of the lines that hold a marker.
   *
   * @param {string} marker - The marker
   * @returns {number[]} The indexes, in order
   */
  const at = (marker) =>
    lines.flatMap((line, index) => (line.includes(marker) ? [index] : []));
  const starts = at(HELP_START);
  const ends = at(HELP_END);
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error(
      `${name} must hold one ${HELP_START} line and one ${HELP_END} line, around the help section; it holds ${starts.length} and ${ends.length}`,
    );
  }
  if (ends[0] < starts[0]) {
    throw new Error(
      `${name}'s ${HELP_END} line comes before its ${HELP_START} line`,
    );
  }
  const section = lines
    .slice(starts[0] + 1, ends[0])
    .map((line) => line.replace(COMMENT_MARGIN, "").trimEnd())
    .join("\n")
    .trim();
  if (section === "") throw new Error(`${name}'s help section holds no text`);
  return section;
}

/**
 * Turns the inline parts of a line into HTML: code, then links. The text
 * is escaped first, so nothing in it becomes markup on its own.
 *
 * @param {string} text - The line's text
 * @returns {string} Its HTML
 */
function inlineHtml(text) {
  return text
    .split(/(`[^`]*`)/)
    .map((part) => {
      if (/^`[^`]*`$/.test(part)) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      return escapeHtml(part).replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        (_match, label, url) => `<a href="${url}">${label}</a>`,
      );
    })
    .join("");
}

/**
 * Turns one section's Markdown into HTML.
 *
 * @param {string} markdown - The section
 * @returns {string} Its HTML
 */
function sectionHtml(markdown) {
  const html = [];
  let paragraph = [];
  let list = null;
  let fence = null;
  /**
   * Writes the paragraph gathered so far, if any, and starts a new one.
   *
   * @returns {void}
   */
  const closeParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${inlineHtml(paragraph.join(" "))}</p>`);
    }
    paragraph = [];
  };
  /**
   * Writes the list gathered so far, if any, and ends it.
   *
   * @returns {void}
   */
  const closeList = () => {
    if (list !== null) {
      html.push(
        `<ul>${list.map((item) => `<li>${inlineHtml(item)}</li>`).join("")}</ul>`,
      );
    }
    list = null;
  };
  for (const line of markdown.split("\n")) {
    if (fence !== null) {
      if (/^\s*```/.test(line)) {
        html.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else fence.push(line);
      continue;
    }
    const heading = /^(#{2,3}) (.+)$/.exec(line);
    const item = /^- (.+)$/.exec(line);
    if (/^\s*```/.test(line)) {
      closeParagraph();
      closeList();
      fence = [];
    } else if (line.trim() === "") {
      closeParagraph();
      closeList();
    } else if (heading !== null) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineHtml(heading[2])}</h${level}>`);
    } else if (item !== null) {
      closeParagraph();
      list = list ?? [];
      list.push(item[1]);
    } else if (list !== null && /^\s+\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      closeList();
      paragraph.push(line.trim());
    }
  }
  if (fence !== null) {
    html.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
  }
  closeParagraph();
  closeList();
  return html.join("\n");
}

/**
 * Makes the help page from the sections, in order.
 *
 * @param {string[]} sections - The sections' Markdown
 * @returns {string} The page's HTML
 */
export function helpPage(sections) {
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><base target="_blank">',
    `<style>${STYLE}</style></head><body>`,
    ...sections.map(sectionHtml),
    "</body></html>",
  ].join("\n");
}
