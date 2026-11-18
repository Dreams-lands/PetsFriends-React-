/**
 * Bộ mã hóa QR Code chuẩn ISO/IEC 18004 (Byte Mode, Error Correction Level M - khôi phục 15%).
 * Hoạt động 100% độc lập ở client (không cần Internet hay thư viện ngoài),
 * hỗ trợ Version 1 -> 15 (tối đa ~412 byte UTF-8).
 */

interface VersionSpec {
  /** Số từ mã sửa lỗi (ECC codewords) cho mỗi khối */
  eccPerBlock: number;
  /** Các nhóm khối: [số khối, số từ mã dữ liệu mỗi khối] */
  groups: Array<[number, number]>;
  /** Tọa độ tâm các mẫu căn chỉnh (Alignment Patterns) */
  align: number[];
}

// Bảng thông số chuẩn ISO/IEC 18004 cho mức sửa lỗi M (ECC Level M = 00)
const VERSION_SPECS_M: Record<number, VersionSpec> = {
  1: { eccPerBlock: 10, groups: [[1, 16]], align: [] },
  2: { eccPerBlock: 16, groups: [[1, 28]], align: [6, 18] },
  3: { eccPerBlock: 26, groups: [[1, 44]], align: [6, 22] },
  4: { eccPerBlock: 18, groups: [[2, 32]], align: [6, 26] },
  5: { eccPerBlock: 24, groups: [[2, 43]], align: [6, 30] },
  6: { eccPerBlock: 16, groups: [[4, 27]], align: [6, 34] },
  7: { eccPerBlock: 18, groups: [[4, 31]], align: [6, 22, 38] },
  8: { eccPerBlock: 22, groups: [[2, 38], [2, 39]], align: [6, 24, 42] },
  9: { eccPerBlock: 22, groups: [[3, 36], [2, 37]], align: [6, 26, 46] },
  10: { eccPerBlock: 26, groups: [[4, 43], [1, 44]], align: [6, 28, 50] },
  11: { eccPerBlock: 30, groups: [[1, 50], [4, 51]], align: [6, 30, 54] },
  12: { eccPerBlock: 22, groups: [[6, 36], [2, 37]], align: [6, 32, 58] },
  13: { eccPerBlock: 22, groups: [[8, 37], [1, 38]], align: [6, 34, 62] },
  14: { eccPerBlock: 24, groups: [[4, 40], [5, 41]], align: [6, 26, 46, 66] },
  15: { eccPerBlock: 24, groups: [[5, 41], [5, 42]], align: [6, 26, 48, 70] },
};

// Phép nhân trên trường hữu hạn GF(256) với đa thức tối giản 0x11D
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >> 7) * 0x11d);
    z ^= ((y >> i) & 1) * x;
  }
  return z;
}

function buildReedSolomonDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) {
        result[j] ^= result[j + 1];
      }
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function computeReedSolomonRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[divisor.length - 1] = 0;
    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= gfMul(divisor[i], factor);
    }
  }
  return result;
}

function totalDataCodewords(spec: VersionSpec): number {
  return spec.groups.reduce((sum, [blocks, dataLen]) => sum + blocks * dataLen, 0);
}

function chooseVersion(byteLen: number): number {
  for (let v = 1; v <= 15; v++) {
    const capBytes = totalDataCodewords(VERSION_SPECS_M[v]);
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    const neededCodewords = Math.ceil((headerBits + byteLen * 8) / 8);
    if (neededCodewords <= capBytes) return v;
  }
  throw new Error('Nội dung mã QR vượt quá dung lượng tối đa hỗ trợ (Version 15).');
}

function appendBits(val: number, len: number, bits: number[]): void {
  for (let i = len - 1; i >= 0; i--) {
    bits.push((val >>> i) & 1);
  }
}

function maskCondition(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function drawFormatBits(
  modules: boolean[][],
  isFunction: boolean[][],
  mask: number,
  markOnly = false
): void {
  const size = modules.length;
  // ECL M = 00
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  const bits = ((data << 10) | rem) ^ 0x5412;

  const setModule = (r: number, c: number, dark: boolean) => {
    isFunction[r][c] = true;
    if (!markOnly) modules[r][c] = dark;
  };

  for (let i = 0; i <= 5; i++) setModule(i, 8, ((bits >>> i) & 1) === 1);
  setModule(7, 8, ((bits >>> 6) & 1) === 1);
  setModule(8, 8, ((bits >>> 7) & 1) === 1);
  setModule(8, 7, ((bits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) setModule(8, 14 - i, ((bits >>> i) & 1) === 1);

  for (let i = 0; i < 8; i++) setModule(8, size - 1 - i, ((bits >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) setModule(size - 15 + i, 8, ((bits >>> i) & 1) === 1);
  setModule(size - 8, 8, true);
}

function computePenalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;

  // Quy tắc 1: chuỗi cùng màu liên tiếp >= 5
  for (let r = 0; r < size; r++) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (modules[r][c] === runColor) {
        runLen++;
        if (runLen === 5) score += 3;
        else if (runLen > 5) score += 1;
      } else {
        runColor = modules[r][c];
        runLen = 1;
      }
    }
  }
  for (let c = 0; c < size; c++) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (modules[r][c] === runColor) {
        runLen++;
        if (runLen === 5) score += 3;
        else if (runLen > 5) score += 1;
      } else {
        runColor = modules[r][c];
        runLen = 1;
      }
    }
  }

  // Quy tắc 2: khối 2x2 cùng màu
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const color = modules[r][c];
      if (
        color === modules[r][c + 1] &&
        color === modules[r + 1][c] &&
        color === modules[r + 1][c + 1]
      ) {
        score += 3;
      }
    }
  }

  return score;
}

export function encodeQrMatrix(text: string): boolean[][] {
  const rawBytes = new TextEncoder().encode(text || 'PETSFRIEND');
  const bytes = rawBytes.length > 410 ? rawBytes.slice(0, 410) : rawBytes;
  const version = chooseVersion(bytes.length);
  const spec = VERSION_SPECS_M[version];
  const size = version * 4 + 17;

  // 1. Tạo luồng bit dữ liệu (Byte Mode = 0100)
  const dataCapBytes = totalDataCodewords(spec);
  const dataCapBits = dataCapBytes * 8;
  const bits: number[] = [];
  appendBits(0b0100, 4, bits);
  appendBits(bytes.length, version <= 9 ? 8 : 16, bits);
  for (const b of bytes) appendBits(b, 8, bits);
  appendBits(0, Math.min(4, dataCapBits - bits.length), bits);
  appendBits(0, (8 - (bits.length % 8)) % 8, bits);

  for (let padIdx = 0; bits.length < dataCapBits; padIdx++) {
    appendBits(padIdx % 2 === 0 ? 0xec : 0x11, 8, bits);
  }

  const dataCodewords = new Uint8Array(dataCapBytes);
  for (let i = 0; i < bits.length; i++) {
    dataCodewords[i >>> 3] |= bits[i] << (7 - (i & 7));
  }

  // 2. Chia khối & tính Reed-Solomon ECC, sau đó đan xen (interleave)
  const divisor = buildReedSolomonDivisor(spec.eccPerBlock);
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;
  let maxDataLen = 0;

  for (const [blockCount, dataLen] of spec.groups) {
    if (dataLen > maxDataLen) maxDataLen = dataLen;
    for (let b = 0; b < blockCount; b++) {
      const block = dataCodewords.slice(offset, offset + dataLen);
      offset += dataLen;
      dataBlocks.push(block);
      eccBlocks.push(computeReedSolomonRemainder(block, divisor));
    }
  }

  const allCodewords: number[] = [];
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) allCodewords.push(block[i]);
    }
  }
  for (let i = 0; i < spec.eccPerBlock; i++) {
    for (const ecc of eccBlocks) {
      allCodewords.push(ecc[i]);
    }
  }

  // 3. Khởi tạo ma trận module và vẽ các mẫu chức năng (Function Patterns)
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = dark;
    isFunction[r][c] = true;
  };

  const drawFinder = (topR: number, leftC: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const dist = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        const dark = dist !== 2 && dist !== 4;
        setFunc(topR + dr, leftC + dc, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 0; i < size; i++) {
    if (!isFunction[6][i]) setFunc(6, i, i % 2 === 0);
    if (!isFunction[i][6]) setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const align = spec.align;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      const r = align[i];
      const c = align[j];
      if (
        (r <= 8 && c <= 8) ||
        (r <= 8 && c >= size - 9) ||
        (r >= size - 9 && c <= 8)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunc(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Version info (Version >= 7)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const vBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((vBits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(a, b, dark);
      setFunc(b, a, dark);
    }
  }

  // Đánh dấu vùng Format Info trước khi rải dữ liệu
  drawFormatBits(modules, isFunction, 0, true);

  // 4. Rải bit dữ liệu theo đường zíc-zắc 2 cột từ phải sang trái
  let bitIdx = 0;
  const totalBits = allCodewords.length * 8;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = right - dc;
        if (!isFunction[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            dark = ((allCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          modules[r][c] = dark;
        }
      }
    }
    upward = !upward;
  }

  // 5. Thử cả 8 mặt nạ (Mask 0..7) và chọn mặt nạ có điểm phạt thấp nhất
  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestMatrix = modules;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = modules.map((row, r) =>
      row.map((val, c) => (!isFunction[r][c] && maskCondition(mask, r, c) ? !val : val))
    );
    drawFormatBits(candidate, isFunction, mask, false);
    const penalty = computePenalty(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestMatrix = candidate;
    }
  }

  // Đảm bảo format bits của bestMask đã được vẽ chính xác
  drawFormatBits(bestMatrix, isFunction, bestMask, false);
  return bestMatrix;
}
