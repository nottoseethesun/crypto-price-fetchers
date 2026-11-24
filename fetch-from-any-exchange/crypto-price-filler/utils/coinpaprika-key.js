/**
 * Whether a run of crypto-price-filler goes on without CoinPaprika's
 * prices, when CoinPaprika can give it none.
 * @module utils/coinpaprika-key
 *
 * What: CoinPaprika gives a day's high or low only from the day's candle,
 * and its free server, which a run asks when no CoinPaprika key is saved,
 * keeps a candle only for the 24 hours after the candle begins, so it
 * holds none of a day already over. A run with `--mode high` or
 * `--mode low`, for a token with a CoinPaprika id, and with no CoinPaprika
 * key saved, says so and asks whether to go on without CoinPaprika's
 * prices: y goes on, and a row no other source prices then gets `Error`;
 * Enter, n, or an input that ends with no answer stops the run, so that a
 * key can be saved first. For close, which the free server gives, from a
 * day's price at 00:00 UTC (see the exchange script's `-sources.gs`), the
 * run asks nothing.
 *
 * Fit: `index.js` asks once the run's keys are open, before any price is
 * asked for, with `lib/ask-line.js`, which takes a line typed or piped.
 */
import { askLine } from "../../../lib/ask-line.js";

/** What a run says before it asks. */
export const NO_COINPAPRIKA_KEY =
  "CoinPaprika gives a day's high or low only with an api key, and none is saved:\n" +
  "save one with npm run api-keys -- set coinpaprika, in the repo's top folder, then run again\n" +
  "to have CoinPaprika's prices. Without one, a row no other source prices gets Error.";

/**
 * Whether a run goes on: at once, when CoinPaprika can give it prices;
 * else, once it has said why CoinPaprika cannot, as its question is
 * answered.
 *
 * @param {Object} run - What decides it
 * @param {string} run.mode - The price asked for: "high", "low" or "close"
 * @param {?string} run.coinpaprikaId - The token's CoinPaprika id, or null when it has none
 * @param {boolean} run.keySaved - Whether a CoinPaprika key is saved
 * @param {{input: NodeJS.ReadableStream, output: NodeJS.WritableStream}} terminal - Where it asks
 * @returns {Promise<boolean>} Whether to go on
 */
export async function goOnWithoutCoinPaprika(
  { mode, coinpaprikaId, keySaved },
  { input, output },
) {
  if (mode === "close" || coinpaprikaId === null || keySaved) return true;
  output.write(`${NO_COINPAPRIKA_KEY}\n`);
  for (;;) {
    const answer = await askLine("Go on without CoinPaprika's prices? (y/N) ", {
      input,
      output,
    });
    if (answer === null) return false;
    const typed = answer.trim();
    if (/^y(es)?$/i.test(typed)) return true;
    if (typed === "" || /^no?$/i.test(typed)) return false;
    output.write("Answer y or n, or press Enter for n.\n");
  }
}
