/**
 * Ends a command line quietly when the program reading its output stops
 * reading, as when its help is piped into `head`.
 * @module lib/closed-output
 *
 * What: a program that reads another's output through a pipe, such as
 * `head`, which prints the first lines it gets and quits, can close the
 * pipe while the command line is still writing. The operating system
 * answers the next write with an EPIPE error, and Node, when nothing
 * listens for that error, prints a stack trace and exits with code 1.
 * `endQuietlyWhenOutputCloses` listens for it on standard output and exits
 * at once, with the exit code the run has set so far, or 0 when it has set
 * none. Any other error on the stream is thrown, as when nothing listens.
 *
 * Fit: every command line's entry point calls it before it starts; the
 * projects that install this repo call it as
 * `crypto-price-fetchers/lib/closed-output`, and their tests check each
 * command line with `helpIntoClosedPipe` (`lib/command-line-help.js`).
 */

/**
 * Makes the process end quietly when the reader of a stream closes it.
 *
 * @param {import('node:stream').Writable} [stream=process.stdout] - The stream the command line writes its output to
 */
export function endQuietlyWhenOutputCloses(stream = process.stdout) {
  stream.on("error", (error) => {
    if (error?.code === "EPIPE") process.exit();
    throw error;
  });
}
