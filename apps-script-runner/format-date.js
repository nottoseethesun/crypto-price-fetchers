/**
 * `Utilities.formatDate` for running a Sheets script under Node.
 * @module apps-script-runner/format-date
 *
 * What: Apps Script's `Utilities.formatDate(date, timeZone, pattern)`
 * writes a date as text, in a time zone, from a Java SimpleDateFormat
 * pattern such as `yyyy-MM-dd HH:mm:ss`.
 *
 * How: the pattern is read as Java reads it. Each run of one letter is a
 * field, its length the field's width: `yyyy` is the four-digit year, `yy`
 * its last two digits, `MM` the month padded to two digits and `M` the
 * month unpadded. The letters known are the ones of a numeric date and
 * time: y, M, d, H, m, s and S (milliseconds). Text in single quotes is
 * copied as it stands, `''` writes a quote, and any character that is not
 * a letter is copied too. Any other letter, or a month written as a name
 * (`MMM`), is refused by name, so a pattern this cannot write fails
 * instead of coming out wrong. The date's fields in the time zone come
 * from the platform's `Intl`, so the zone is any name `Intl` knows: an
 * IANA name such as `America/Chicago`, or `UTC`.
 *
 * Fit: `apps-script-services.js` hands this to the script as
 * `Utilities.formatDate`.
 */

/** The fields a pattern letter writes, by letter. */
const FIELD_OF_LETTER = Object.freeze({
  y: 'year',
  M: 'month',
  d: 'day',
  H: 'hour',
  m: 'minute',
  s: 'second',
  S: 'millisecond'
});

/**
 * Reads a pattern into its pieces: fields, each a letter and a width, and
 * text to copy as it stands.
 *
 * @param {string} pattern - A Java SimpleDateFormat pattern
 * @returns {Array<{letter: string, width: number}|{text: string}>} The pieces, in order
 * @throws {Error} When a quote is left open
 */
export function readPattern(pattern) {
  const pieces = [];
  let at = 0;
  while (at < pattern.length) {
    const character = pattern[at];
    if (character === "'") {
      const quoted = readQuoted(pattern, at);
      pieces.push({ text: quoted.text });
      at = quoted.end;
    } else if (/[A-Za-z]/.test(character)) {
      let end = at;
      while (pattern[end] === character) end += 1;
      pieces.push({ letter: character, width: end - at });
      at = end;
    } else {
      pieces.push({ text: character });
      at += 1;
    }
  }
  return pieces;
}

/**
 * Reads quoted text from a pattern, from the quote at `start`: `''` is a
 * quote, and so is `''` inside quoted text.
 *
 * @param {string} pattern - The pattern
 * @param {number} start - The index of the opening quote
 * @returns {{text: string, end: number}} The text, and the index after the closing quote
 * @throws {Error} When the quote is never closed
 */
function readQuoted(pattern, start) {
  if (pattern[start + 1] === "'") return { text: "'", end: start + 2 };
  let text = '';
  let at = start + 1;
  while (at < pattern.length) {
    if (pattern[at] !== "'") {
      text += pattern[at];
      at += 1;
    } else if (pattern[at + 1] === "'") {
      text += "'";
      at += 2;
    } else {
      return { text, end: at + 1 };
    }
  }
  throw new Error(`Utilities.formatDate: the pattern "${pattern}" leaves a quote open`);
}

/**
 * The fields of a moment in a time zone, as numbers.
 *
 * @param {Date} moment - The moment
 * @param {string} timeZone - A time zone `Intl` knows
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number}} Its fields in that zone
 * @throws {RangeError} When `Intl` does not know the time zone
 */
function fieldsInZone(moment, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  });
  const fields = { millisecond: moment.getUTCMilliseconds() };
  for (const part of formatter.formatToParts(moment)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return fields;
}

/**
 * Writes one field of a pattern.
 *
 * @param {{letter: string, width: number}} piece - The field's letter and width
 * @param {Object<string, number>} fields - The moment's fields in the time zone
 * @returns {string} The field as text
 * @throws {Error} When the letter is not one this knows, or asks for a month's name
 */
function writeField(piece, fields) {
  const field = FIELD_OF_LETTER[piece.letter];
  if (field === undefined || (piece.letter === 'M' && piece.width > 2)) {
    throw new Error(
      `Utilities.formatDate under Node writes numeric dates and times only, and has no "${piece.letter.repeat(piece.width)}"`
    );
  }
  const value = fields[field];
  if (piece.letter === 'y' && piece.width === 2) return String(value % 100).padStart(2, '0');
  return String(value).padStart(piece.width, '0');
}

/**
 * Writes a date as text in a time zone, as Apps Script's
 * `Utilities.formatDate` does.
 *
 * @param {Date} date - The date; a Date from any realm, such as the script's
 * @param {string} timeZone - A time zone `Intl` knows, such as `UTC` or `America/Chicago`
 * @param {string} pattern - A Java SimpleDateFormat pattern of numeric fields, such as `yyyy-MM-dd HH:mm:ss`
 * @returns {string} The date as text
 * @throws {Error} When the date is not a valid date, or the pattern has a letter this does not know
 */
export function formatDate(date, timeZone, pattern) {
  if (date === null || typeof date !== 'object' || typeof date.getTime !== 'function') {
    throw new Error('Utilities.formatDate needs a date');
  }
  const moment = new Date(date.getTime());
  if (Number.isNaN(moment.getTime())) throw new Error('Utilities.formatDate needs a valid date');
  const pieces = readPattern(String(pattern));
  const fields = fieldsInZone(moment, String(timeZone));
  return pieces.map((piece) => ('text' in piece ? piece.text : writeField(piece, fields))).join('');
}
