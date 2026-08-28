// MD5 is retained here because native Rizu identifies chartfiles by their MD5 hash.
export function md5(bytes: Uint8Array): string {
  const original_length = bytes.length;
  const padded_length = Math.ceil((original_length + 9) / 64) * 64;
  const data = new Uint8Array(padded_length);
  data.set(bytes);
  data[original_length] = 0x80;
  const bit_length = original_length * 8;
  const view = new DataView(data.buffer);
  view.setUint32(padded_length - 8, bit_length >>> 0, true);
  view.setUint32(padded_length - 4, Math.floor(bit_length / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = Array.from({ length: 64 }, (_, index) =>
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);

  for (let offset = 0; offset < data.length; offset += 64) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f: number;
      let word_index: number;
      if (index < 16) {
        f = (b & c) | (~b & d);
        word_index = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        word_index = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        word_index = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        word_index = (7 * index) % 16;
      }
      const shift = shifts[Math.floor(index / 16) * 4 + index % 4]!;
      const sum = (a + f + constants[index]! + view.getUint32(offset + word_index * 4, true)) >>> 0;
      const rotated = (sum << shift | sum >>> (32 - shift)) >>> 0;
      [a, b, c, d] = [d, (b + rotated) >>> 0, b, c];
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map((value) =>
    Array.from({ length: 4 }, (_, index) => ((value >>> (index * 8)) & 0xff).toString(16).padStart(2, "0")).join(""),
  ).join("");
}
