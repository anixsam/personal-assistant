import { describe, expect, it } from "vitest";
import { encodeWav } from "../lib/recorder";

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM header and clamps samples", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
    const v = new DataView(wav);
    const str = (o: number) => String.fromCharCode(...new Uint8Array(wav, o, 4));
    expect(str(0)).toBe("RIFF");
    expect(str(8)).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });
});
