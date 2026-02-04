const QR_EC_LEVEL = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2
};

const QR_MASK_PATTERN = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7
};

const PATTERN_POSITION_TABLE = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94]
];

const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
const G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

function getBCHTypeInfo(data){
  let d = data << 10;
  while (getBCHDigit(d) - getBCHDigit(G15) >= 0){
    d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15)));
  }
  return ((data << 10) | d) ^ G15_MASK;
}

function getBCHTypeNumber(data){
  let d = data << 12;
  while (getBCHDigit(d) - getBCHDigit(G18) >= 0){
    d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18)));
  }
  return (data << 12) | d;
}

function getBCHDigit(data){
  let digit = 0;
  while (data !== 0){
    digit++;
    data >>>= 1;
  }
  return digit;
}

function getPatternPosition(typeNumber){
  return PATTERN_POSITION_TABLE[typeNumber - 1] || [];
}

function getMask(maskPattern, i, j){
  switch (maskPattern){
    case QR_MASK_PATTERN.PATTERN000: return (i + j) % 2 === 0;
    case QR_MASK_PATTERN.PATTERN001: return i % 2 === 0;
    case QR_MASK_PATTERN.PATTERN010: return j % 3 === 0;
    case QR_MASK_PATTERN.PATTERN011: return (i + j) % 3 === 0;
    case QR_MASK_PATTERN.PATTERN100: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case QR_MASK_PATTERN.PATTERN101: return (i * j) % 2 + (i * j) % 3 === 0;
    case QR_MASK_PATTERN.PATTERN110: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
    case QR_MASK_PATTERN.PATTERN111: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
    default: return false;
  }
}

function getErrorCorrectPolynomial(errorCorrectLength){
  let a = new QRPolynomial([1], 0);
  for (let i = 0; i < errorCorrectLength; i++){
    a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
  }
  return a;
}

function getLengthInBits(mode, type){
  if (1 <= type && type < 10){
    switch (mode){
      case QRMode.BYTE: return 8;
      default: return 8;
    }
  } else if (type < 27){
    switch (mode){
      case QRMode.BYTE: return 16;
      default: return 16;
    }
  } else {
    switch (mode){
      case QRMode.BYTE: return 16;
      default: return 16;
    }
  }
}

const QRMode = { BYTE: 4 };

class QR8BitByte {
  constructor(data){
    this.mode = QRMode.BYTE;
    this.data = data;
    this.parsed = new TextEncoder().encode(data);
  }
  getLength(){
    return this.parsed.length;
  }
  write(buffer){
    for (const b of this.parsed) buffer.put(b, 8);
  }
}

class QRBitBuffer {
  constructor(){
    this.buffer = [];
    this.length = 0;
  }
  get(index){
    const bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - index % 8)) & 1) === 1;
  }
  put(num, length){
    for (let i = 0; i < length; i++){
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }
  putBit(bit){
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex){
      this.buffer.push(0);
    }
    if (bit){
      this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
    }
    this.length++;
  }
}

class QRPolynomial {
  constructor(num, shift){
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++){
      this.num[i] = num[i + offset];
    }
  }
  get(index){
    return this.num[index];
  }
  getLength(){
    return this.num.length;
  }
  multiply(e){
    const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++){
      for (let j = 0; j < e.getLength(); j++){
        num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
      }
    }
    return new QRPolynomial(num, 0);
  }
  mod(e){
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
    const num = this.num.slice();
    for (let i = 0; i < e.getLength(); i++){
      num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
    }
    return new QRPolynomial(num, 0).mod(e);
  }
}

const QRMath = {
  glog: (n) => {
    if (n < 1) throw new Error("glog");
    return QRMath.LOG_TABLE[n];
  },
  gexp: (n) => {
    while (n < 0) n += 255;
    while (n >= 256) n -= 255;
    return QRMath.EXP_TABLE[n];
  },
  EXP_TABLE: new Array(256),
  LOG_TABLE: new Array(256)
};

for (let i = 0; i < 8; i++) QRMath.EXP_TABLE[i] = 1 << i;
for (let i = 8; i < 256; i++){
  QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4] ^
    QRMath.EXP_TABLE[i - 5] ^
    QRMath.EXP_TABLE[i - 6] ^
    QRMath.EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i++){
  QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;
}

function getRSBlocks(typeNumber, errorCorrectLevel){
  const rsBlockTable = [
    // L  M  Q  H
    // 1
    [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
    // 2
    [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
    // 3
    [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
    // 4
    [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
    // 5
    [1, 134, 108], [2, 67, 43], [2, 33, 15], [2, 33, 11],
    // 6
    [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
    // 7
    [2, 98, 78], [4, 49, 31], [2, 32, 14], [4, 39, 13],
    // 8
    [2, 121, 97], [2, 60, 38], [4, 40, 18], [4, 40, 14],
    // 9
    [2, 146, 116], [3, 58, 36], [4, 36, 16], [4, 36, 12],
    // 10
    [2, 86, 68], [4, 69, 43], [6, 43, 19], [6, 43, 15],
    // 11
    [4, 101, 81], [1, 80, 50], [4, 50, 22], [3, 36, 12],
    // 12
    [2, 116, 92], [6, 58, 36], [4, 46, 20], [7, 42, 14],
    // 13
    [4, 133, 107], [8, 59, 37], [8, 44, 20], [12, 33, 11],
    // 14
    [3, 145, 115], [4, 64, 40], [11, 36, 16], [11, 36, 12],
    // 15
    [5, 109, 87], [5, 65, 41], [5, 54, 24], [11, 36, 12],
    // 16
    [5, 122, 98], [7, 73, 45], [15, 43, 19], [3, 45, 15],
    // 17
    [1, 135, 107], [10, 74, 46], [1, 50, 22], [2, 42, 14],
    // 18
    [5, 150, 120], [9, 69, 43], [17, 50, 22], [2, 42, 14],
    // 19
    [3, 141, 113], [3, 70, 44], [17, 47, 21], [9, 39, 13],
    // 20
    [3, 135, 107], [3, 67, 41], [15, 54, 24], [15, 43, 15],
  ];

  const offset = (typeNumber - 1) * 4 + errorCorrectLevel;
  const rs = rsBlockTable[offset];
  if (!rs) throw new Error("RS table");
  return [{ totalCount: rs[1], dataCount: rs[2] }];
}

function createData(typeNumber, errorCorrectLevel, dataList){
  const rsBlocks = getRSBlocks(typeNumber, errorCorrectLevel);
  const buffer = new QRBitBuffer();
  for (const data of dataList){
    buffer.put(data.mode, 4);
    buffer.put(data.getLength(), getLengthInBits(data.mode, typeNumber));
    data.write(buffer);
  }
  let totalDataCount = 0;
  for (const rsBlock of rsBlocks) totalDataCount += rsBlock.dataCount;
  if (buffer.length + 4 <= totalDataCount * 8){
    buffer.put(0, 4);
  }
  while (buffer.length % 8 !== 0){
    buffer.putBit(false);
  }
  const paddingBytes = [0xec, 0x11];
  let i = 0;
  while (buffer.buffer.length < totalDataCount){
    buffer.put(paddingBytes[i % 2], 8);
    i++;
  }

  return createBytes(buffer, rsBlocks);
}

function createBytes(buffer, rsBlocks){
  let offset = 0;
  let maxDcCount = 0;
  let maxEcCount = 0;
  const dcdata = [];
  const ecdata = [];
  for (const rsBlock of rsBlocks){
    const dcCount = rsBlock.dataCount;
    const ecCount = rsBlock.totalCount - rsBlock.dataCount;
    maxDcCount = Math.max(maxDcCount, dcCount);
    maxEcCount = Math.max(maxEcCount, ecCount);
    dcdata.push(buffer.buffer.slice(offset, offset + dcCount));
    offset += dcCount;
    const rsPoly = getErrorCorrectPolynomial(ecCount);
    const rawPoly = new QRPolynomial(dcdata[dcdata.length - 1], rsPoly.getLength() - 1);
    const modPoly = rawPoly.mod(rsPoly);
    const ec = new Array(rsPoly.getLength() - 1).fill(0);
    const modOffset = modPoly.getLength() - ec.length;
    for (let i = 0; i < modPoly.getLength(); i++){
      ec[i + ec.length - modPoly.getLength()] = modPoly.get(i);
    }
    ecdata.push(ec);
  }

  const totalCodeCount = rsBlocks.reduce((s, r) => s + r.totalCount, 0);
  const data = new Array(totalCodeCount);
  let index = 0;
  for (let i = 0; i < maxDcCount; i++){
    for (let r = 0; r < dcdata.length; r++){
      if (i < dcdata[r].length) data[index++] = dcdata[r][i];
    }
  }
  for (let i = 0; i < maxEcCount; i++){
    for (let r = 0; r < ecdata.length; r++){
      if (i < ecdata[r].length) data[index++] = ecdata[r][i];
    }
  }
  return data;
}

class QRCode {
  constructor(typeNumber, errorCorrectLevel){
    this.typeNumber = typeNumber;
    this.errorCorrectLevel = errorCorrectLevel;
    this.modules = null;
    this.moduleCount = 0;
    this.dataCache = null;
    this.dataList = [];
  }

  addData(data){
    this.dataList.push(new QR8BitByte(data));
    this.dataCache = null;
  }

  isDark(row, col){
    if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col){
      throw new Error("out of bounds");
    }
    return this.modules[row][col];
  }

  getModuleCount(){
    return this.moduleCount;
  }

  make(){
    if (this.typeNumber < 1){
      this.typeNumber = 1;
      while (this.typeNumber < 21){
        const rsBlocks = getRSBlocks(this.typeNumber, this.errorCorrectLevel);
        const buffer = new QRBitBuffer();
        for (const data of this.dataList){
          buffer.put(data.mode, 4);
          buffer.put(data.getLength(), getLengthInBits(data.mode, this.typeNumber));
          data.write(buffer);
        }
        let totalDataCount = 0;
        for (const rsBlock of rsBlocks) totalDataCount += rsBlock.dataCount;
        if (buffer.length <= totalDataCount * 8) break;
        this.typeNumber++;
      }
      if (this.typeNumber >= 21) throw new Error("QR data too large");
    }
    this.makeImpl(false, this.getBestMaskPattern());
  }

  makeImpl(test, maskPattern){
    this.moduleCount = this.typeNumber * 4 + 17;
    this.modules = new Array(this.moduleCount);
    for (let row = 0; row < this.moduleCount; row++){
      this.modules[row] = new Array(this.moduleCount).fill(null);
    }
    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupPositionAdjustPattern();
    this.setupTimingPattern();
    this.setupTypeInfo(test, maskPattern);
    if (this.typeNumber >= 7) this.setupTypeNumber(test);
    if (this.dataCache === null){
      this.dataCache = createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
    }
    this.mapData(this.dataCache, maskPattern);
  }

  setupPositionProbePattern(row, col){
    for (let r = -1; r <= 7; r++){
      if (row + r <= -1 || this.moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++){
        if (col + c <= -1 || this.moduleCount <= col + c) continue;
        if (
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4)
        ){
          this.modules[row + r][col + c] = true;
        } else {
          this.modules[row + r][col + c] = false;
        }
      }
    }
  }

  getBestMaskPattern(){
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i++){
      this.makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(this);
      if (i === 0 || minLostPoint > lostPoint){
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  }

  setupTimingPattern(){
    for (let i = 8; i < this.moduleCount - 8; i++){
      if (this.modules[i][6] === null){
        this.modules[i][6] = i % 2 === 0;
      }
      if (this.modules[6][i] === null){
        this.modules[6][i] = i % 2 === 0;
      }
    }
  }

  setupPositionAdjustPattern(){
    const pos = getPatternPosition(this.typeNumber);
    for (let i = 0; i < pos.length; i++){
      for (let j = 0; j < pos.length; j++){
        const row = pos[i];
        const col = pos[j];
        if (this.modules[row][col] !== null) continue;
        for (let r = -2; r <= 2; r++){
          for (let c = -2; c <= 2; c++){
            if (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)){
              this.modules[row + r][col + c] = true;
            } else {
              this.modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  }

  setupTypeNumber(test){
    const bits = getBCHTypeNumber(this.typeNumber);
    for (let i = 0; i < 18; i++){
      const mod = (!test && ((bits >>> i) & 1) === 1);
      this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
      this.modules[i % 3 + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  }

  setupTypeInfo(test, maskPattern){
    const data = (this.errorCorrectLevel << 3) | maskPattern;
    const bits = getBCHTypeInfo(data);
    for (let i = 0; i < 15; i++){
      const mod = (!test && ((bits >>> i) & 1) === 1);
      if (i < 6){
        this.modules[i][8] = mod;
      } else if (i < 8){
        this.modules[i + 1][8] = mod;
      } else {
        this.modules[this.moduleCount - 15 + i][8] = mod;
      }
    }
    for (let i = 0; i < 15; i++){
      const mod = (!test && ((bits >>> i) & 1) === 1);
      if (i < 8){
        this.modules[8][this.moduleCount - i - 1] = mod;
      } else if (i < 9){
        this.modules[8][15 - i - 1 + 1] = mod;
      } else {
        this.modules[8][15 - i - 1] = mod;
      }
    }
    this.modules[this.moduleCount - 8][8] = !test;
  }

  mapData(data, maskPattern){
    let inc = -1;
    let row = this.moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    for (let col = this.moduleCount - 1; col > 0; col -= 2){
      if (col === 6) col--;
      while (true){
        for (let c = 0; c < 2; c++){
          if (this.modules[row][col - c] === null){
            let dark = false;
            if (byteIndex < data.length){
              dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            }
            const mask = getMask(maskPattern, row, col - c);
            if (mask) dark = !dark;
            this.modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1){
              byteIndex++;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || this.moduleCount <= row){
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }
}

const QRUtil = {
  getLostPoint(qr){
    const moduleCount = qr.getModuleCount();
    let lostPoint = 0;
    for (let row = 0; row < moduleCount; row++){
      for (let col = 0; col < moduleCount; col++){
        let sameCount = 0;
        const dark = qr.isDark(row, col);
        for (let r = -1; r <= 1; r++){
          if (row + r < 0 || moduleCount <= row + r) continue;
          for (let c = -1; c <= 1; c++){
            if (col + c < 0 || moduleCount <= col + c) continue;
            if (r === 0 && c === 0) continue;
            if (dark === qr.isDark(row + r, col + c)) sameCount++;
          }
        }
        if (sameCount > 5) lostPoint += (3 + sameCount - 5);
      }
    }
    for (let row = 0; row < moduleCount - 1; row++){
      for (let col = 0; col < moduleCount - 1; col++){
        const count =
          (qr.isDark(row, col) ? 1 : 0) +
          (qr.isDark(row + 1, col) ? 1 : 0) +
          (qr.isDark(row, col + 1) ? 1 : 0) +
          (qr.isDark(row + 1, col + 1) ? 1 : 0);
        if (count === 0 || count === 4) lostPoint += 3;
      }
    }
    for (let row = 0; row < moduleCount; row++){
      for (let col = 0; col < moduleCount - 6; col++){
        if (
          qr.isDark(row, col) &&
          !qr.isDark(row, col + 1) &&
          qr.isDark(row, col + 2) &&
          qr.isDark(row, col + 3) &&
          qr.isDark(row, col + 4) &&
          !qr.isDark(row, col + 5) &&
          qr.isDark(row, col + 6)
        ){
          lostPoint += 40;
        }
      }
    }
    for (let col = 0; col < moduleCount; col++){
      for (let row = 0; row < moduleCount - 6; row++){
        if (
          qr.isDark(row, col) &&
          !qr.isDark(row + 1, col) &&
          qr.isDark(row + 2, col) &&
          qr.isDark(row + 3, col) &&
          qr.isDark(row + 4, col) &&
          !qr.isDark(row + 5, col) &&
          qr.isDark(row + 6, col)
        ){
          lostPoint += 40;
        }
      }
    }
    let darkCount = 0;
    for (let col = 0; col < moduleCount; col++){
      for (let row = 0; row < moduleCount; row++){
        if (qr.isDark(row, col)) darkCount++;
      }
    }
    const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  }
};

export function makeQrMatrix(dataStr, ecLevel = "M"){
  const level = QR_EC_LEVEL[ecLevel] ?? QR_EC_LEVEL.M;
  const qr = new QRCode(0, level);
  qr.addData(dataStr);
  qr.make();
  const size = qr.getModuleCount();
  const matrix = new Array(size);
  for (let r = 0; r < size; r++){
    matrix[r] = new Array(size);
    for (let c = 0; c < size; c++){
      matrix[r][c] = qr.isDark(r, c);
    }
  }
  return matrix;
}

export function drawQrToCanvas(canvas, dataStr, ecLevel = "M"){
  if (!canvas) return;
  const matrix = makeQrMatrix(dataStr, ecLevel);
  const size = matrix.length;
  const quiet = 2;
  const scale = Math.floor(Math.min(canvas.width, canvas.height) / (size + quiet * 2)) || 4;
  const ctx = canvas.getContext("2d");
  const qrSize = (size + quiet * 2) * scale;
  canvas.width = qrSize;
  canvas.height = qrSize;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, qrSize, qrSize);
  ctx.fillStyle = "#000";
  for (let r = 0; r < size; r++){
    for (let c = 0; c < size; c++){
      if (!matrix[r][c]) continue;
      const x = (c + quiet) * scale;
      const y = (r + quiet) * scale;
      ctx.fillRect(x, y, scale, scale);
    }
  }
}
