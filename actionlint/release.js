/**
 * The release of actionlint that `run-actionlint` runs, with the SHA-256
 * of each archive it may download.
 * @module actionlint/release
 *
 * What: actionlint, rhysd's checker of GitHub Actions workflow files,
 * publishes each release on GitHub as one archive per system, each holding
 * the program, built for that system. npm audit does not cover it, since
 * it is not installed from npm, so this names one release and the SHA-256
 * of each archive the owner's systems and CI's need, as the release's own
 * checksums file lists them. `run-actionlint` checks each download against
 * them before it runs anything from it, and `npm run audit:actionlint`
 * checks every archive.
 *
 * A new release is taken by writing its version and the four checksums
 * from its `actionlint_<version>_checksums.txt`.
 */

/**
 * One archive of a release.
 *
 * @typedef {Object} ActionlintArchive
 * @property {string} file - Its file name in the release
 * @property {string} sha256 - Its SHA-256, in hex
 */

/**
 * A release of actionlint.
 *
 * @typedef {Object} ActionlintRelease
 * @property {string} version - Its version, without a v
 * @property {Object<string, ActionlintArchive>} archives - Its archives, by Node's platform and arch, as `linux-x64`
 */

/** @type {ActionlintRelease} The release `run-actionlint` runs. */
export const ACTIONLINT = Object.freeze({
  version: "1.7.12",
  archives: Object.freeze({
    "linux-x64": Object.freeze({
      file: "actionlint_1.7.12_linux_amd64.tar.gz",
      sha256:
        "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
    }),
    "linux-arm64": Object.freeze({
      file: "actionlint_1.7.12_linux_arm64.tar.gz",
      sha256:
        "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6",
    }),
    "darwin-x64": Object.freeze({
      file: "actionlint_1.7.12_darwin_amd64.tar.gz",
      sha256:
        "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644",
    }),
    "darwin-arm64": Object.freeze({
      file: "actionlint_1.7.12_darwin_arm64.tar.gz",
      sha256:
        "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f",
    }),
  }),
});

/**
 * The url of one of a release's archives.
 *
 * @param {ActionlintRelease} release - The release
 * @param {string} file - The archive's file name
 * @returns {string} Its url on GitHub
 */
export function archiveUrl(release, file) {
  return `https://github.com/rhysd/actionlint/releases/download/v${release.version}/${file}`;
}
