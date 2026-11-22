/*
 * A Sheets script for the tests of the runner's check of a Node version's
 * schemas (`configSchemaProblems`). Its config object has a field the
 * script reads as it loads, a field it reads each time it is called, and
 * an api key.
 */

const SETTINGS = {
  HOST: "https://placeholder.invalid",
  WAIT_MS: 100,
  API_KEY: "",
};

const BASE_URL = `${SETTINGS.HOST}/v1`;

function describeSettings() {
  return `${BASE_URL} ${SETTINGS.WAIT_MS} ${SETTINGS.API_KEY}`;
}
