/**
 * The order of priority of a project's services, which the key manager
 * asks for and saves: where more than one service can do one job, as
 * CoinGecko and CoinPaprika can each give a past price, a program asks
 * them in this order.
 * @module api-key-store/key-ranking
 *
 * What: `askPriority` shows the services in their order of priority,
 * numbered from 1, asks for a new order, typed as those numbers, highest
 * priority first, and saves it in the key file (`savePriority`); Enter
 * alone keeps the order shown, and saves it. `typedOrder` reads what was
 * typed.
 *
 * How: what is typed must hold each number from 1 to the count of services
 * once, separated by spaces or commas; anything else is refused, saying
 * why, and asked again. The input ending before an order is typed saves
 * nothing. The order is no secret, so the question shows what is typed
 * (`lib/ask-line.js`).
 *
 * Fit: the key manager (`key-manager.js`) asks for an order when the key
 * file holds none for the services `config.json` lists
 * (`projectPriority`, `project-keys.js`), as it lists the keys or sets one,
 * and on `rank`.
 */

import { savePriority } from "./key-file.js";

/**
 * Reads an order of priority typed as the numbers of the services shown.
 *
 * @param {string} typed - What was typed, such as "2 1 3"
 * @param {number} count - How many services were shown
 * @returns {?Array<number>} The services' places in the order shown, from 0, highest priority first; null when what was typed is not each number from 1 to the count once
 */
export function typedOrder(typed, count) {
  const parts = typed.split(/[\s,]+/).filter((part) => part !== "");
  if (parts.length !== count || !parts.every((part) => /^\d+$/.test(part)))
    return null;
  const numbers = parts.map(Number);
  const each =
    numbers.every((number) => number >= 1 && number <= count) &&
    new Set(numbers).size === count;
  return each ? numbers.map((number) => number - 1) : null;
}

/**
 * An example of an order typed for so many services: the first two
 * swapped, then the rest in turn.
 *
 * @param {number} count - How many services there are, 2 or more
 * @returns {string} Such as "2 1 3 4 5"
 */
function exampleOrder(count) {
  const rest = Array.from({ length: count - 2 }, (_, index) => index + 3);
  return [2, 1, ...rest].join(" ");
}

/**
 * Where the order is kept and how to reach the person: what the manager,
 * or a test, gives `askPriority`.
 *
 * @typedef {Object} RankingSpec
 * @property {string} file - The key file
 * @property {{write: function(string): void}} stderr - Where the question and messages go
 * @property {function(string): Promise<?string>} askLine - Asks a question and gives the line typed, or null when the input ended first
 */

/**
 * Shows the services in their order of priority, asks for a new order,
 * and saves the one typed, or, for Enter alone, the one shown.
 *
 * @param {RankingSpec} spec - Where the order is kept, and how to reach the person
 * @param {Array<import('./services.js').Service>} services - The services, in their order of priority now, 2 or more
 * @param {boolean} saved - Whether that order is the one saved; else it is the order `config.json` lists them in
 * @returns {Promise<number>} The exit code: 0 once an order is saved, 1 when the input ended before one was typed
 * @throws {Error} When the key file cannot be read or written
 */
export async function askPriority(spec, services, saved) {
  spec.stderr.write(
    saved
      ? `The services' order of priority, saved in ${spec.file}:\n`
      : "No order of priority is saved for these services. Where more than one can do one job, the programs ask them in this order until one is:\n",
  );
  for (const [index, service] of services.entries())
    spec.stderr.write(`  ${index + 1}. ${service.name}\n`);
  for (;;) {
    const typed = await spec.askLine(
      `Order of priority, highest first, by number, such as ${exampleOrder(services.length)} (Enter alone keeps the order above): `,
    );
    if (typed === null) {
      spec.stderr.write(
        "The input ended before an order of priority was typed, so none was saved.\n",
      );
      return 1;
    }
    const order =
      typed.trim() === ""
        ? services.map((_, index) => index)
        : typedOrder(typed, services.length);
    if (order === null) {
      spec.stderr.write(
        `Type each number from 1 to ${services.length} once, highest priority first, or Enter alone to keep the order above.\n`,
      );
      continue;
    }
    const ranked = order.map((index) => services[index]);
    savePriority(
      spec.file,
      ranked.map((service) => service.service),
    );
    spec.stderr.write(
      `The order of priority is saved in ${spec.file}: ${ranked.map((service) => service.name).join(", ")}.\n`,
    );
    return 0;
  }
}
