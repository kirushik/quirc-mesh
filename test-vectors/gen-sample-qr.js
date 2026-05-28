"use strict";
// Generate representative v2 shard QR PNGs at the benchmarked sizes, so they can
// be printed (one per A4 page) and scan-tested on real phones (F12/F13).
const QRCode = require("qrcode");
const crypto = require("crypto");

const B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
function base45Encode(buf) {
  let out = "";
  for (let i = 0; i < buf.length; i += 2) {
    if (i + 1 < buf.length) {
      let x = buf[i] * 256 + buf[i + 1];
      const c = x % 45; x = (x - c) / 45; const d = x % 45; x = (x - d) / 45;
      out += B45[c] + B45[d] + B45[x % 45];
    } else { let x = buf[i]; const c = x % 45; x = (x - c) / 45; out += B45[c] + B45[x % 45]; }
  }
  return out;
}
function payload(shardBytes) { return "BS2 05 3 02 " + base45Encode(crypto.randomBytes(shardBytes)); }

// (label, shard bytes, EC) from the §8 benchmark
const cases = [
  ["worst_2of3_fullkey_ECL", 2844, "L"], // 2-of-3 full two-key 4096 export -> v40 EC-L
  ["mid_3of5_fullkey_ECM",   1910, "M"], // 3-of-5 -> v37 EC-M
  ["easy_3of5_seedphrase_ECH", 60 + 41, "H"], // ~60B seed phrase, 3-of-5 -> tiny, EC-H
];

(async () => {
  for (const [name, bytes, ec] of cases) {
    const str = payload(bytes);
    const meta = QRCode.create([{ data: str, mode: "alphanumeric" }], { errorCorrectionLevel: ec });
    const file = __dirname + "/qr_" + name + ".png";
    await QRCode.toFile(file, [{ data: str, mode: "alphanumeric" }], {
      errorCorrectionLevel: ec, scale: 8, margin: 4, version: meta.version,
    });
    console.log(`${name}: ${str.length} chars -> v${meta.version} EC-${ec} -> ${file} (${meta.version * 4 + 17} modules)`);
  }
  console.log("\nPrint each ~full A4 and scan-test on phone cameras (F12/F13).");
})();
