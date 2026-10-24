// pdf.js runs `new DOMMatrix()` as soon as it loads. Browsers have DOMMatrix.
// On a server, pdf.js borrows it from the native @napi-rs/canvas package,
// which is missing on Amplify, so loading pdf.js failed with
// "DOMMatrix is not defined". We only extract text and never render, so a
// stand-in that holds the six matrix values is enough. This module must be
// imported before pdf-parse.
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = Array.isArray(init) ? init : []
      Object.assign(this, { a, b, c, d, e, f })
    }
  }
}
