import { scaledSize, sha256Hex } from '../../src/lib/receipts/prepareImage.js'

const cases = [
  ['landscape phone photo', scaledSize(4032, 3024), { width: 1600, height: 1200 }],
  ['portrait phone photo', scaledSize(3024, 4032), { width: 1200, height: 1600 }],
  ['small image is not upscaled', scaledSize(800, 600), { width: 800, height: 600 }],
  ['exactly max edge', scaledSize(1600, 1600), { width: 1600, height: 1600 }],
  ['sha256 of "abc"', await sha256Hex(new Blob(['abc'])), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
]

let failed = 0
for (const [name, actual, expected] of cases) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
if (failed) {
  console.error(`${failed}/${cases.length} cases failed`)
  process.exit(1)
}
console.log(`PASS — all ${cases.length} cases`)
