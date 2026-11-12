/*
 * A Sheets script for the runner's tests. Each function uses one Apps
 * Script service, or one way of passing values, and returns what it saw.
 */

const CONFIG = {
  BASE_URL: 'http://placeholder.invalid',
  KEY: 'placeholder',
  TRIES: [1, 2]
};

function getText(path) {
  const response = UrlFetchApp.fetch(CONFIG.BASE_URL + path, {
    headers: { 'X-Key': CONFIG.KEY },
    muteHttpExceptions: true
  });
  return response.getResponseCode() + ' ' + response.getContentText();
}

function postJson(path, body) {
  const response = UrlFetchApp.fetch(CONFIG.BASE_URL + path, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body)
  });
  return JSON.parse(response.getContentText());
}

function getStrict(path) {
  return UrlFetchApp.fetch(CONFIG.BASE_URL + path).getContentText();
}

function getOrMessage(path) {
  try {
    return getStrict(path);
  } catch (err) {
    return 'caught: ' + err.message;
  }
}

function countCalls(key) {
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(key) || '0') + 1;
  cache.put(key, String(count), 60);
  return count;
}

function sleepFor(milliseconds) {
  const started = Date.now();
  Utilities.sleep(milliseconds);
  return Date.now() - started;
}

function describeDate(value) {
  return value instanceof Date ? Utilities.formatDate(value, 'UTC', 'yyyy-MM-dd HH:mm:ss') : 'not a Date';
}

function firstCell(cells) {
  return cells instanceof Array && cells[0] instanceof Array ? cells[0][0] : 'not an Array';
}

function triesAreAnArray() {
  return CONFIG.TRIES instanceof Array;
}

function readKey() {
  return CONFIG.KEY;
}

function shout(text) {
  Logger.log('said %s', text);
  console.warn('warned ' + text);
  return text.toUpperCase();
}

function fail(message) {
  throw new Error(message);
}

function lockAndRelease() {
  const lock = LockService.getScriptLock();
  const got = lock.tryLock(1000);
  const held = lock.hasLock();
  lock.releaseLock();
  return got && held && !lock.hasLock();
}

function rememberAndRecall(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
  return PropertiesService.getScriptProperties().getProperty(key);
}

function giveFunction() {
  return function () {};
}
