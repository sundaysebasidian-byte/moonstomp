'use strict';

// Array#some skips holes. Inspect every pair and both fields explicitly so
// malformed caller input is rejected before a healthy protocol session changes.
function isHeaderPairs(headers) {
  if (!Array.isArray(headers)) return false;
  for (const pair of headers) {
    if (!Array.isArray(pair) || pair.length !== 2 ||
        typeof pair[0] !== 'string' || typeof pair[1] !== 'string') return false;
  }
  return true;
}

module.exports = {isHeaderPairs};
