/**
 * The second file of a script split in two, for the runner's tests: it
 * reads the first file's const as it loads, and calls its function.
 */

/* global SHARED_GREETING, greetingFromFirst */

const SECOND_AT_LOAD = `${SHARED_GREETING}, read by the second`;

function greetingsFromBoth() {
  return [greetingFromFirst(), SECOND_AT_LOAD];
}
