/**
 * DEX Screener's Google Sheets functions, downloaded at one commit, checked
 * and compiled into the one file the build gives, when the person building
 * asks for them.
 * @module apps-script-build/dex-screener
 *
 * What: DEX Screener, a service that lists the pairs of decentralized
 * exchanges with their prices, published Google Sheets functions of its
 * own, such as `DEX_SCREENER_PAIR_PROP`, written in TypeScript. That code
 * is DEX Screener's, and its repo carries no license, so this repo holds
 * none of it: `dexScreenerPart` runs the audit that
 * `npm run audit:dex-screener` runs, which downloads its files at the
 * commit `dex-screener-files.js` names and checks each one's SHA-256,
 * compiles the files the audit gives, and gives the text the build puts in
 * the file, which stays on the computer of the person building.
 *
 * How:
 *
 * - First, the audit (`auditDexScreenerFiles`): every file is downloaded
 *   and checked, and the line `npm run audit:dex-screener` prints when all
 *   match is said to the person building.
 * - The files are compiled as DEX Screener's own build compiles them, with
 *   esbuild: one bundle, ES2018. esbuild asks for the entry, then for each
 *   file a file imports by a relative path, written without its `.ts`, as
 *   TypeScript imports are, and is handed each from the audited files in
 *   memory, so nothing of DEX Screener's is written to disk and nothing
 *   the audit did not check is compiled. The two packages the code
 *   imports, zod and lodash, come from this repo's development packages.
 * - The bundle runs inside a function of its own, so none of its names
 *   reaches the rest of the file. Its `global`, where DEX Screener's code
 *   puts each function it offers, is an object of that function's own,
 *   whose prototype is the real global object, so code that reads the
 *   global object through `global`, as lodash does, finds what the real
 *   one holds. DEX Screener's `onOpen`, which would replace the Crypto
 *   Price Fetchers menu, stays on that object, and Sheets never calls it.
 * - Each custom function then gets a top-level function of the same name,
 *   as Sheets needs, which hands its arguments to DEX Screener's, with the
 *   comment Sheets shows when the function is typed in a cell.
 * - A failed download, a file whose checksum differs or a failed compile
 *   stops the build with a message that ends by saying the step is
 *   optional, and to run the build again without it (`RETRY_ADVICE`).
 *
 * Fit: `index.js` asks, at every build, whether to include these
 * functions, and adds this part to the file when the answer is yes.
 */

import path from "node:path";
import { build } from "esbuild";
import {
  DEX_SCREENER,
  auditDexScreenerFiles,
  auditPassed,
} from "./dex-screener-files.js";

/** What the person building is told when the step fails. */
export const RETRY_ADVICE =
  "Including DEX Screener's functions is optional: run the build again and answer n to leave them out.";

/** The top-level name of the object that holds DEX Screener's functions. */
export const HOLDER = "DEX_SCREENER_FUNCTIONS";

/** esbuild's namespace for the downloaded files, which live in memory. */
const NAMESPACE = "dex-screener";

/**
 * The esbuild plugin that hands esbuild the audited files: the entry, and
 * each file one of them imports by a relative path, found among them. A
 * bare import, such as `zod`, is left to esbuild, which finds it in this
 * repo's packages.
 *
 * @param {import('./dex-screener-files.js').DexScreenerVersion} version - The version
 * @param {Object<string, string>} sources - The audited files' text, by their paths in the repo
 * @param {string} projectTop - This repo's top folder
 * @returns {import('esbuild').Plugin} The plugin
 */
function sourcesPlugin(version, sources, projectTop) {
  return {
    name: "dex-screener-sources",
    setup(esbuild) {
      esbuild.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") {
          return { path: args.path, namespace: NAMESPACE };
        }
        if (args.namespace !== NAMESPACE || !args.path.startsWith(".")) {
          return undefined;
        }
        const base = path.posix.join(
          path.posix.dirname(args.importer),
          args.path,
        );
        const file = [`${base}.ts`, `${base}/index.ts`, base].find((name) =>
          Object.hasOwn(sources, name),
        );
        if (file === undefined) {
          return {
            errors: [
              {
                text: `${args.importer} imports ${args.path}, which is not among the files of ${version.repo} whose SHA-256 this build knows`,
              },
            ],
          };
        }
        return { path: file, namespace: NAMESPACE };
      });
      esbuild.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => ({
        contents: sources[args.path],
        loader: "ts",
        resolveDir: projectTop,
      }));
    },
  };
}

/**
 * Compiles the audited files into one bundle, as DEX Screener's build
 * does.
 *
 * @param {import('./dex-screener-files.js').DexScreenerVersion} version - The version
 * @param {Object<string, string>} sources - The audited files' text, by their paths in the repo
 * @param {string} projectTop - This repo's top folder, whose packages hold zod and lodash
 * @returns {Promise<string>} The bundle's code
 * @throws {Error} When the compile fails
 */
async function compiledBundle(version, sources, projectTop) {
  try {
    const result = await build({
      entryPoints: [version.entry],
      absWorkingDir: projectTop,
      bundle: true,
      format: "esm",
      target: "es2018",
      write: false,
      legalComments: "inline",
      logLevel: "silent",
      plugins: [sourcesPlugin(version, sources, projectTop)],
    });
    return result.outputFiles[0].text;
  } catch (error) {
    throw new Error(`Could not compile DEX Screener's code: ${error.message}`, {
      cause: error,
    });
  }
}

/**
 * Writes the top-level function that hands its arguments to one of DEX
 * Screener's, with the comment Sheets shows.
 *
 * @param {import('./dex-screener-files.js').DexScreenerFunction} fn - The function
 * @returns {string} Its code
 */
function callerOf(fn) {
  return [
    "/**",
    ` * ${fn.summary}`,
    " *",
    ...fn.params.map((line) => ` * ${line}`),
    ` * @return {*} What DEX Screener's ${fn.name} gives`,
    " * @customfunction",
    " */",
    `function ${fn.name}(...args) {`,
    `  return ${HOLDER}.${fn.name}(...args);`,
    "}",
  ].join("\n");
}

/**
 * Runs the audit of DEX Screener's files, compiles the files it gives, and
 * gives the text that goes in the file.
 *
 * @param {Object} options - How
 * @param {string} options.projectTop - This repo's top folder
 * @param {function(string): Promise<Response>} [options.fetch=globalThis.fetch] - Does the downloads
 * @param {import('./dex-screener-files.js').DexScreenerVersion} [options.version=DEX_SCREENER] - The version to download
 * @param {function(string): void} [options.say] - Takes the line the audit gives when every file matches
 * @returns {Promise<{text: string, required: string[]}>} The text, and the functions the built file must hold once loaded, by dotted name
 * @throws {Error} When a step fails; its message ends with `RETRY_ADVICE`
 */
export async function dexScreenerPart({
  projectTop,
  fetch = globalThis.fetch,
  version = DEX_SCREENER,
  say = () => {},
}) {
  let bundle;
  try {
    const sources = await auditDexScreenerFiles({ fetch, version });
    say(auditPassed(Object.keys(sources).length, version));
    bundle = await compiledBundle(version, sources, projectTop);
  } catch (error) {
    throw new Error(`${error.message}\n${RETRY_ADVICE}`, { cause: error });
  }
  const text = [
    "/**",
    " * DEX Screener's Google Sheets functions, downloaded from",
    ` * https://github.com/${version.repo}/tree/${version.commit}`,
    ` * (the commit of ${version.date}), each file checked against its SHA-256,`,
    " * and compiled by npm run build apps-script. This code is DEX Screener's,",
    " * not crypto-price-fetchers', and the license of crypto-price-fetchers",
    " * does not cover it. It runs inside the function below, so its names stay",
    ` * there; ${HOLDER} holds the functions it offers, and`,
    " * the functions after it hand each call to them.",
    " */",
    `const ${HOLDER} = (() => {`,
    "  const global = Object.create(globalThis);",
    bundle.trimEnd(),
    "  return global;",
    "})();",
    "",
    ...version.functions.flatMap((fn) => [callerOf(fn), ""]),
  ].join("\n");
  return {
    text,
    required: version.functions.flatMap((fn) => [
      fn.name,
      `${HOLDER}.${fn.name}`,
    ]),
  };
}
