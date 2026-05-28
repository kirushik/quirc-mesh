// Decode error codes, mirroring quirc's quirc_decode_error_t (quirc.h).
// 0 == success; any nonzero value is a failure the caller must treat as "no result".

export const ERR = {
  SUCCESS: 0,
  INVALID_GRID_SIZE: 1,
  INVALID_VERSION: 2,
  FORMAT_ECC: 3,
  DATA_ECC: 4,
  UNKNOWN_DATA_TYPE: 5,
  DATA_OVERFLOW: 6,
  DATA_UNDERFLOW: 7,
};

export const ERR_MSG = {
  [ERR.SUCCESS]: "Success",
  [ERR.INVALID_GRID_SIZE]: "Invalid grid size",
  [ERR.INVALID_VERSION]: "Invalid version",
  [ERR.FORMAT_ECC]: "Format data ECC failure",
  [ERR.DATA_ECC]: "ECC failure",
  [ERR.UNKNOWN_DATA_TYPE]: "Unknown data type",
  [ERR.DATA_OVERFLOW]: "Data overflow",
  [ERR.DATA_UNDERFLOW]: "Data underflow",
};

export function strerror(err) {
  return ERR_MSG[err] ?? "Unknown error";
}
