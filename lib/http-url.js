/**
 * Whether a text is an http or https url, as a command line takes the
 * address of a service it asks, such as a chain's rpc endpoint.
 * @module lib/http-url
 *
 * Fit: the command lines of the projects that install this repo check such
 * an option with it, as `crypto-price-fetchers/lib/http-url`, so a mistyped
 * address is refused as it is parsed, before anything is asked.
 */

/**
 * Whether a text is an http or https url.
 *
 * @param {*} text - The text
 * @returns {boolean} Whether it is a url whose scheme is http or https
 */
export function isHttpUrl(text) {
  return (
    typeof text === "string" &&
    URL.canParse(text) &&
    /^https?:$/.test(new URL(text).protocol)
  );
}
