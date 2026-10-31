'use strict';
// Validate the backing storage too: detached and out-of-bounds views can report
// zero length, but must never be silently converted into an empty message.
const values = Uint8Array.prototype.values;
function isBytes(value) {
  if (!(value instanceof Uint8Array)) return false;
  try { values.call(value); return true; } catch { return false; }
}
module.exports = {isBytes};
