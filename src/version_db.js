// QR version information database — verbatim port of quirc's version_db.c.
//
// Each entry:
//   dataBytes : total number of codewords (data + EC) in the symbol for this
//               version (independent of EC level).
//   apat      : alignment-pattern center coordinates (module indices). Empty for
//               v1. The full grid of alignment patterns sits at every (ax,ay)
//               pair drawn from these coords, minus the three finder corners.
//   ecc       : Reed-Solomon block params per EC level, in quirc's internal
//               order [M, L, H, Q] (i.e. ecc[ECC_LEVEL]). Each is [bs, dw, ns]:
//                 bs = small block total size (codewords)
//                 dw = small block data words
//                 ns = number of small blocks
//               (large blocks, if any, are bs+1/dw+1; count derived at decode.)
//
// EC level integer mapping (quirc.h): M=0, L=1, H=2, Q=3.

export const ECC_LEVEL = { M: 0, L: 1, H: 2, Q: 3 };
// Map quirc's internal EC index -> spec letter (for the public API).
export const ECC_LETTER = ["M", "L", "H", "Q"];

export const MAX_VERSION = 40;
export const MAX_ALIGNMENT = 7;

// index 0 is a placeholder so VERSION_DB[v] addresses version v directly.
export const VERSION_DB = [
  null,
  { dataBytes: 26,   apat: [],                          ecc: [[26,16,1],[26,19,1],[26,9,1],[26,13,1]] },   // v1
  { dataBytes: 44,   apat: [6,18],                      ecc: [[44,28,1],[44,34,1],[44,16,1],[44,22,1]] },   // v2
  { dataBytes: 70,   apat: [6,22],                      ecc: [[70,44,1],[70,55,1],[35,13,2],[35,17,2]] },   // v3
  { dataBytes: 100,  apat: [6,26],                      ecc: [[50,32,2],[100,80,1],[25,9,4],[50,24,2]] },   // v4
  { dataBytes: 134,  apat: [6,30],                      ecc: [[67,43,2],[134,108,1],[33,11,2],[33,15,2]] }, // v5
  { dataBytes: 172,  apat: [6,34],                      ecc: [[43,27,4],[86,68,2],[43,15,4],[43,19,4]] },   // v6
  { dataBytes: 196,  apat: [6,22,38],                   ecc: [[49,31,4],[98,78,2],[39,13,4],[32,14,2]] },   // v7
  { dataBytes: 242,  apat: [6,24,42],                   ecc: [[60,38,2],[121,97,2],[40,14,4],[40,18,4]] },  // v8
  { dataBytes: 292,  apat: [6,26,46],                   ecc: [[58,36,3],[146,116,2],[36,12,4],[36,16,4]] }, // v9
  { dataBytes: 346,  apat: [6,28,50],                   ecc: [[69,43,4],[86,68,2],[43,15,6],[43,19,6]] },   // v10
  { dataBytes: 404,  apat: [6,30,54],                   ecc: [[80,50,1],[101,81,4],[36,12,3],[50,22,4]] },  // v11
  { dataBytes: 466,  apat: [6,32,58],                   ecc: [[58,36,6],[116,92,2],[42,14,7],[46,20,4]] },  // v12
  { dataBytes: 532,  apat: [6,34,62],                   ecc: [[59,37,8],[133,107,4],[33,11,12],[44,20,8]] },// v13
  { dataBytes: 581,  apat: [6,26,46,66],                ecc: [[64,40,4],[145,115,3],[36,12,11],[36,16,11]] },// v14
  { dataBytes: 655,  apat: [6,26,48,70],                ecc: [[65,41,5],[109,87,5],[36,12,11],[54,24,5]] }, // v15
  { dataBytes: 733,  apat: [6,26,50,74],                ecc: [[73,45,7],[122,98,5],[45,15,3],[43,19,15]] }, // v16
  { dataBytes: 815,  apat: [6,30,54,78],                ecc: [[74,46,10],[135,107,1],[42,14,2],[50,22,1]] },// v17
  { dataBytes: 901,  apat: [6,30,56,82],                ecc: [[69,43,9],[150,120,5],[42,14,2],[50,22,17]] },// v18
  { dataBytes: 991,  apat: [6,30,58,86],                ecc: [[70,44,3],[141,113,3],[39,13,9],[47,21,17]] },// v19
  { dataBytes: 1085, apat: [6,34,62,90],                ecc: [[67,41,3],[135,107,3],[43,15,15],[54,24,15]] },// v20
  { dataBytes: 1156, apat: [6,28,50,72,92],             ecc: [[68,42,17],[144,116,4],[46,16,19],[50,22,17]] },// v21
  { dataBytes: 1258, apat: [6,26,50,74,98],             ecc: [[74,46,17],[139,111,2],[37,13,34],[54,24,7]] },// v22
  { dataBytes: 1364, apat: [6,30,54,78,102],            ecc: [[75,47,4],[151,121,4],[45,15,16],[54,24,11]] },// v23
  { dataBytes: 1474, apat: [6,28,54,80,106],            ecc: [[73,45,6],[147,117,6],[46,16,30],[54,24,11]] },// v24
  { dataBytes: 1588, apat: [6,32,58,84,110],            ecc: [[75,47,8],[132,106,8],[45,15,22],[54,24,7]] },// v25
  { dataBytes: 1706, apat: [6,30,58,86,114],            ecc: [[74,46,19],[142,114,10],[46,16,33],[50,22,28]] },// v26
  { dataBytes: 1828, apat: [6,34,62,90,118],            ecc: [[73,45,22],[152,122,8],[45,15,12],[53,23,8]] },// v27
  { dataBytes: 1921, apat: [6,26,50,74,98,122],         ecc: [[73,45,3],[147,117,3],[45,15,11],[54,24,4]] },// v28
  { dataBytes: 2051, apat: [6,30,54,78,102,126],        ecc: [[73,45,21],[146,116,7],[45,15,19],[53,23,1]] },// v29
  { dataBytes: 2185, apat: [6,26,52,78,104,130],        ecc: [[75,47,19],[145,115,5],[45,15,23],[54,24,15]] },// v30
  { dataBytes: 2323, apat: [6,30,56,82,108,134],        ecc: [[74,46,2],[145,115,13],[45,15,23],[54,24,42]] },// v31
  { dataBytes: 2465, apat: [6,34,60,86,112,138],        ecc: [[74,46,10],[145,115,17],[45,15,19],[54,24,10]] },// v32
  { dataBytes: 2611, apat: [6,30,58,86,114,142],        ecc: [[74,46,14],[145,115,17],[45,15,11],[54,24,29]] },// v33
  { dataBytes: 2761, apat: [6,34,62,90,118,146],        ecc: [[74,46,14],[145,115,13],[46,16,59],[54,24,44]] },// v34
  { dataBytes: 2876, apat: [6,30,54,78,102,126,150],    ecc: [[75,47,12],[151,121,12],[45,15,22],[54,24,39]] },// v35
  { dataBytes: 3034, apat: [6,24,50,76,102,128,154],    ecc: [[75,47,6],[151,121,6],[45,15,2],[54,24,46]] },// v36
  { dataBytes: 3196, apat: [6,28,54,80,106,132,158],    ecc: [[74,46,29],[152,122,17],[45,15,24],[54,24,49]] },// v37
  { dataBytes: 3362, apat: [6,32,58,84,110,136,162],    ecc: [[74,46,13],[152,122,4],[45,15,42],[54,24,48]] },// v38
  { dataBytes: 3532, apat: [6,26,54,82,110,138,166],    ecc: [[75,47,40],[147,117,20],[45,15,10],[54,24,43]] },// v39
  { dataBytes: 3706, apat: [6,30,58,86,114,142,170],    ecc: [[75,47,18],[148,118,19],[45,15,20],[54,24,34]] },// v40
];

export function gridSize(version) {
  return version * 4 + 17;
}

export function versionForGrid(gridSize) {
  return (gridSize - 17) / 4;
}

// RS params {bs,dw,ns} for a version + EC level (quirc internal index).
export function eccParams(version, eccLevel) {
  const [bs, dw, ns] = VERSION_DB[version].ecc[eccLevel];
  return { bs, dw, ns };
}
