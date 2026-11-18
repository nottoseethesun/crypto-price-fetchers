/**
 * The first file of a script split in two, for the runner's tests: a
 * top-level const the second file reads as it loads, and a function.
 */

const SHARED_GREETING = "hello from the first file";

function greetingFromFirst() {
  return SHARED_GREETING;
}
