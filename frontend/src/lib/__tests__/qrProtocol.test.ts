import {
  splitPayloadIntoUrFrames,
  MultipartQrAssembler,
  computeChecksum,
  generateQrSvg,
} from "../qrProtocol";

describe("qrProtocol (Issue #1517)", () => {
  it("computes deterministic checksum for strings", () => {
    const c1 = computeChecksum("test-soroban-xdr");
    const c2 = computeChecksum("test-soroban-xdr");
    expect(c1).toBe(c2);
    expect(c1).toHaveLength(8);
  });

  it("splits large payload into animated multipart UR frames", () => {
    const largePayload = "A".repeat(300);
    const frames = splitPayloadIntoUrFrames(largePayload, 80);

    expect(frames.length).toBe(4);
    expect(frames[0].seq).toBe(1);
    expect(frames[0].total).toBe(4);
    expect(frames[0].urString).toContain("ur:bytes/1-4/");
  });

  it("reassembles multipart frames in order and verifies checksum", () => {
    const original = "AAAA_BBBB_CCCC_DDDD_EEEE_FFFF_GGGG_HHHH_IIII_JJJJ";
    const frames = splitPayloadIntoUrFrames(original, 15);
    expect(frames.length).toBeGreaterThan(1);

    const assembler = new MultipartQrAssembler();
    let lastResult;
    for (let i = 0; i < frames.length; i++) {
      lastResult = assembler.addPart(frames[i].urString);
      if (i < frames.length - 1) {
        expect(lastResult.completed).toBe(false);
      }
    }

    expect(lastResult?.completed).toBe(true);
    expect(lastResult?.payload).toBe(original);
    expect(lastResult?.progress).toBe(100);
  });

  it("handles out-of-order frame arrival correctly", () => {
    const original = "11112222333344445555";
    const frames = splitPayloadIntoUrFrames(original, 5);
    expect(frames.length).toBe(4);

    const assembler = new MultipartQrAssembler();
    // Ingest frames out of order: 3, 1, 4, 2
    expect(assembler.addPart(frames[2].urString).completed).toBe(false);
    expect(assembler.addPart(frames[0].urString).completed).toBe(false);
    expect(assembler.addPart(frames[3].urString).completed).toBe(false);
    const finalResult = assembler.addPart(frames[1].urString);

    expect(finalResult.completed).toBe(true);
    expect(finalResult.payload).toBe(original);
  });

  it("generates valid SVG XML string", () => {
    const svg = generateQrSvg("sample-data", 200);
    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0 200 200"');
    expect(svg).toContain("</svg>");
  });
});
