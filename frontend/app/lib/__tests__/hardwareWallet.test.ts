import {
  connectHardwareWallet,
  detectLedgerSupport,
  isLedgerWebUsbSupported,
  LedgerStellarBridge,
  buildApdu,
  buildStellarPath,
  bytesToBase64,
  claimLedgerDevice,
  describeLedgerState,
  encodeDerivationPath,
  encodeSignatureForRpc,
  encodeStellarAddress,
  framePackets,
  openLedgerDevice,
  parseResponsePackets,
  statusWordToState,
  LEDGER_LOCK_TIMEOUT_MS,
  DEFAULT_LEDGER_TIMEOUT_MS,
  STELLAR_COIN_TYPE,
} from "../hardwareWallet";

/**
 * Build a response shaped like a real Ledger reply: a 64-byte header packet
 * followed by payload packets, with the final packet short because the device
 * stops as soon as the response is complete.
 */
function responsePackets(body: Uint8Array, statusWord: number): Uint8Array[] {
  const full = new Uint8Array(body.length + 2);
  full.set(body, 0);
  full[body.length] = (statusWord >> 8) & 0xff;
  full[body.length + 1] = statusWord & 0xff;

  const packets: Uint8Array[] = [new Uint8Array(64)];
  for (let offset = 0; offset < full.length; offset += 59) {
    const chunk = full.slice(offset, offset + 59);
    const packet = new Uint8Array(5 + chunk.length);
    packet[0] = 0x01;
    packet[1] = 0x01;
    packet[2] = 0x05;
    packet.set(chunk, 5);
    packets.push(packet);
  }
  return packets;
}

/** In-memory WebUSB double; answers transferIn from a queue. */
class FakeLedger {
  opened = false;
  configuration: unknown | null = null;
  productName = "Ledger Nano X";
  serialNumber = "serial-1";
  vendorId = 0x2c97;
  readonly outPackets: Uint8Array[] = [];
  private inbox: Uint8Array[] = [];
  hangForever = false;

  async open() {
    this.opened = true;
  }
  async selectConfiguration() {
    this.configuration = { configurationValue: 1 };
  }
  async claimInterface() {}
  async transferOut(_endpoint: number, data: BufferSource) {
    this.outPackets.push(new Uint8Array(data as ArrayBuffer));
  }
  async transferIn() {
    if (this.hangForever) return new Promise<never>(() => {});
    const next = this.inbox.shift();
    if (!next) throw new Error("FakeLedger: no queued response packet");
    return { data: { buffer: next.buffer as ArrayBuffer } };
  }
  queueOk(body: Uint8Array) {
    this.inbox.push(...responsePackets(body, 0x9000));
  }
  queueStatus(statusWord: number) {
    this.inbox.push(...responsePackets(new Uint8Array(0), statusWord));
  }
}

function bridgeFor(device: FakeLedger): LedgerStellarBridge {
  return new LedgerStellarBridge(
    device as unknown as ConstructorParameters<typeof LedgerStellarBridge>[0],
    device.productName,
  );
}

const PUBLIC_KEY = new Uint8Array(32).fill(3);
const PUBLIC_KEY_ADDRESS = encodeStellarAddress(PUBLIC_KEY);

describe("hardwareWallet", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports Ledger WebUSB unsupported in jsdom", async () => {
    expect(await isLedgerWebUsbSupported()).toBe(false);
    expect(await detectLedgerSupport()).toBe(false);
  });

  it("connects to a selected Ledger device through WebUSB", async () => {
    const device = {
      opened: false,
      configuration: null,
      open: jest.fn(async function open(this: { opened: boolean }) {
        this.opened = true;
      }),
      selectConfiguration: jest.fn(async function selectConfiguration(
        this: { configuration: unknown },
      ) {
        this.configuration = { configurationValue: 1 };
      }),
      claimInterface: jest.fn(),
      productName: "Ledger Nano X",
      serialNumber: "serial-1",
    };
    const requestDevice = jest.fn().mockResolvedValue(device);
    Object.defineProperty(global.navigator, "usb", {
      configurable: true,
      value: { requestDevice },
    });

    const session = await connectHardwareWallet("ledger");

    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ vendorId: 0x2c97 }],
    });
    expect(device.open).toHaveBeenCalled();
    expect(device.selectConfiguration).toHaveBeenCalledWith(1);
    expect(device.claimInterface).toHaveBeenCalledWith(0);
    expect(session).toEqual({
      kind: "ledger",
      address: "Ledger Nano X",
      transport: "webusb",
      device: {
        productName: "Ledger Nano X",
        serialNumber: "serial-1",
        vendorId: 0x2c97,
      },
    });
  });

  it("throws a classified error when the user does not select a Ledger device", async () => {
    Object.defineProperty(global.navigator, "usb", {
      configurable: true,
      value: {
        requestDevice: jest
          .fn()
          .mockRejectedValue(new DOMException("No device selected", "NotFoundError")),
      },
    });

    await expect(connectHardwareWallet("ledger")).rejects.toMatchObject({
      name: "HardwareWalletConnectionError",
      code: "device_not_selected",
      retriable: true,
    });
  });

  it("throws a classified error when the Ledger interface cannot be claimed", async () => {
    Object.defineProperty(global.navigator, "usb", {
      configurable: true,
      value: {
        requestDevice: jest.fn().mockResolvedValue({
          opened: false,
          configuration: { configurationValue: 1 },
          open: jest.fn(),
          claimInterface: jest.fn().mockRejectedValue(new Error("busy")),
          productName: "Ledger Nano S",
        }),
      },
    });

    await expect(connectHardwareWallet("ledger")).rejects.toMatchObject({
      name: "HardwareWalletConnectionError",
      code: "device_unavailable",
      retriable: true,
    });
  });
});

describe("BIP-44 Stellar key derivation", () => {
  it("builds the hardened three-level Ledger Stellar path", () => {
    expect(buildStellarPath()).toBe("m/44'/148'/0'");
    expect(buildStellarPath(5)).toBe("m/44'/148'/5'");
  });

  it("encodes each level as a big-endian hardened word", () => {
    const words = Array.from(encodeDerivationPath(buildStellarPath(2)));
    expect(words).toHaveLength(12);
    expect(words.slice(0, 4)).toEqual([128, 0, 0, 44]);
    expect(words.slice(4, 8)).toEqual([128, 0, 0, 148]);
    expect(words.slice(8, 12)).toEqual([128, 0, 0, 2]);
  });

  it("accepts the full five-level BIP-44 form", () => {
    expect(encodeDerivationPath("m/44'/148'/0'/0/0'")).toHaveLength(20);
  });

  it("rejects a non-Stellar coin type", () => {
    expect(() => encodeDerivationPath("m/44'/1'/0'")).toThrow(/not a Stellar BIP-44 path/);
  });

  it("rejects a path with the wrong number of levels", () => {
    expect(() => encodeDerivationPath("m/44'/148'")).toThrow(/Unsupported derivation path/);
  });

  it("rejects a non-numeric level", () => {
    expect(() => encodeDerivationPath("m/44'/148'/abc'")).toThrow(/Invalid derivation path/);
  });

  it("uses coin type 148", () => {
    expect(STELLAR_COIN_TYPE).toBe(148);
  });
});

describe("StrKey address encoding", () => {
  it("encodes a public key as a 56-character G address", () => {
    const address = encodeStellarAddress(new Uint8Array(32).fill(7));
    expect(address.startsWith("G")).toBe(true);
    expect(address).toHaveLength(56);
  });

  it("is deterministic and key-dependent", () => {
    const a = encodeStellarAddress(new Uint8Array(32).fill(1));
    const b = encodeStellarAddress(new Uint8Array(32).fill(1));
    const c = encodeStellarAddress(new Uint8Array(32).fill(2));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encodeStellarAddress(new Uint8Array(31))).toThrow(/32-byte/);
  });
});

describe("APDU framing", () => {
  it("builds CLA|INS|P1|P2|Lc|data|Le", () => {
    const apdu = buildApdu(0x11, 0x01, 0x01, 0x00, new Uint8Array([5, 1, 2]));
    expect(Array.from(apdu.slice(0, 5))).toEqual([0x11, 0x01, 0x01, 0x00, 3]);
    expect(apdu).toHaveLength(10);
  });

  it("frames a short APDU into one 64-byte packet with the Ledger header", () => {
    const packets = framePackets(buildApdu(0x11, 0x01, 1, 0, new Uint8Array(3)));
    expect(packets).toHaveLength(1);
    expect(packets[0]).toHaveLength(64);
    expect(packets[0][0]).toBe(0x01);
    expect(packets[0][1]).toBe(0x01);
    expect(packets[0][2]).toBe(0x05);
  });

  it("splits a large APDU and increments the packet sequence", () => {
    const packets = framePackets(buildApdu(0x11, 0x02, 0, 0, new Uint8Array(200)));
    expect(packets).toHaveLength(4);
    expect(packets.every((p) => p.length === 64)).toBe(true);
    expect(packets[1][4]).toBe(1);
    expect(packets[2][4]).toBe(2);
  });
});

describe("APDU response parsing", () => {
  it("splits the status word off the payload", () => {
    const parsed = parseResponsePackets(responsePackets(new Uint8Array([1, 2, 3, 4]), 0x9000));
    expect(parsed.statusWord).toBe(0x9000);
    expect(Array.from(parsed.data)).toEqual([1, 2, 3, 4]);
  });

  it("reassembles a multi-packet payload in order", () => {
    const body = new Uint8Array(150).map((_, i) => i % 251);
    const parsed = parseResponsePackets(responsePackets(body, 0x9000));
    expect(parsed.data).toHaveLength(150);
    expect(Array.from(parsed.data)).toEqual(Array.from(body));
  });

  it("surfaces a non-success status word", () => {
    expect(parseResponsePackets(responsePackets(new Uint8Array(0), 0x6b0c)).statusWord).toBe(0x6b0c);
  });

  it("rejects an empty response", () => {
    expect(() => parseResponsePackets([])).toThrow(/no response packets/);
  });

  it("rejects a response with no status word", () => {
    expect(() => parseResponsePackets([new Uint8Array(64)])).toThrow(/missing a status word/);
  });
});

describe("Ledger device states", () => {
  it("maps status words to states", () => {
    expect(statusWordToState(0x9000)).toBe("ready");
    expect(statusWordToState(0x6985)).toBe("user_rejected");
    expect(statusWordToState(0x6b0c)).toBe("locked");
    expect(statusWordToState(0x6982)).toBe("locked");
    expect(statusWordToState(0x6e00)).toBe("app_not_open");
    expect(statusWordToState(0x1234)).toBe("disconnected");
  });

  it("explains each state in user-facing language", () => {
    expect(describeLedgerState("locked")).toMatch(/PIN/);
    expect(describeLedgerState("user_rejected")).toMatch(/rejected/);
    expect(describeLedgerState("app_not_open")).toMatch(/Open the Stellar app/);
  });

  it("defaults the exchange timeout to the device lock timeout", () => {
    expect(LEDGER_LOCK_TIMEOUT_MS).toBe(120_000);
    expect(DEFAULT_LEDGER_TIMEOUT_MS).toBe(LEDGER_LOCK_TIMEOUT_MS);
  });
});


describe("LedgerStellarBridge", () => {
  it("derives the account address for a path", async () => {
    const device = new FakeLedger();
    device.queueOk(new Uint8Array([0x00, ...PUBLIC_KEY]));

    const result = await bridgeFor(device).getAddress({ path: buildStellarPath(0) });

    expect(result.address).toBe(PUBLIC_KEY_ADDRESS);
    expect(result.path).toBe("m/44'/148'/0'");
    expect(result.publicKey).toHaveLength(32);
  });

  it("sends an APDU addressed to the Stellar app", async () => {
    const device = new FakeLedger();
    device.queueOk(PUBLIC_KEY);

    await bridgeFor(device).getAddress();

    const apdu = device.outPackets[0].slice(5);
    expect(apdu[0]).toBe(0x11);
    expect(apdu[1]).toBe(0x01);
  });

  it("keeps a public key that starts with 0x00 intact", async () => {
    const zeroKey = new Uint8Array(32);
    zeroKey[31] = 5;
    const device = new FakeLedger();
    device.queueOk(zeroKey);

    const result = await bridgeFor(device).getAddress();

    expect(result.address).toBe(encodeStellarAddress(zeroKey));
  });

  it("reports a locked device as a retriable lock error", async () => {
    const device = new FakeLedger();
    device.queueStatus(0x6b0c);

    await expect(bridgeFor(device).getAddress()).rejects.toMatchObject({
      code: "device_locked",
      retriable: true,
    });
  });

  it("reports an on-device rejection", async () => {
    const device = new FakeLedger();
    device.queueStatus(0x6985);

    await expect(bridgeFor(device).getAddress()).rejects.toMatchObject({
      code: "user_rejected",
    });
  });

  it("reports that the Stellar app is not open", async () => {
    const device = new FakeLedger();
    device.queueStatus(0x6e00);

    await expect(bridgeFor(device).getAddress()).rejects.toThrow(/Open the Stellar app/);
  });

  it("turns a hung exchange into a lock error", async () => {
    const device = new FakeLedger();
    device.hangForever = true;

    await expect(bridgeFor(device).getAddress({ timeoutMs: 20 })).rejects.toMatchObject({
      code: "device_locked",
    });
  });

  it("rejects a malformed public key", async () => {
    const device = new FakeLedger();
    device.queueOk(new Uint8Array([1, 2, 3]));

    await expect(bridgeFor(device).getAddress()).rejects.toThrow(/malformed public key/);
  });

  it("rejects a device with no transfer interface", async () => {
    const bare = { opened: true, configuration: {}, claimInterface: async () => {} };
    const bridge = new LedgerStellarBridge(
      bare as unknown as ConstructorParameters<typeof LedgerStellarBridge>[0],
      "Bare",
    );

    await expect(bridge.getAddress()).rejects.toThrow(/transfer interface/);
  });


  it("signs an envelope and surfaces an on-device prompt", async () => {
    const device = new FakeLedger();
    const signature = new Uint8Array(64).fill(9);
    device.queueOk(new Uint8Array([...signature, ...new Uint8Array(32).fill(4)]));

    const onPrompt = jest.fn();
    const result = await bridgeFor(device).signTransaction("AAAAQUJD", {
      networkPassphrase: "Test SDF Future Network ; October 2022",
      onPrompt,
    });

    expect(result.signature).toHaveLength(64);
    expect(Array.from(result.signature)).toEqual(Array.from(signature));
    expect(onPrompt).toHaveBeenCalledWith(expect.stringMatching(/verify the network/));
  });

  it("flags the network passphrase in the sign APDU", async () => {
    const device = new FakeLedger();
    device.queueOk(new Uint8Array(96));

    await bridgeFor(device).signTransaction("AAAAQUJD", {
      networkPassphrase: "Test SDF Future Network ; October 2022",
    });

    const apdu = device.outPackets[0].slice(5);
    expect(apdu[1]).toBe(0x02);
    expect(apdu[3]).toBe(0x01);
    expect(new TextDecoder().decode(apdu)).toContain("AAAAQUJD");
  });

  it("leaves the passphrase flag clear when no network is supplied", async () => {
    const device = new FakeLedger();
    device.queueOk(new Uint8Array(96));

    await bridgeFor(device).signTransaction("AAAA");

    expect(device.outPackets[0].slice(5)[3]).toBe(0x00);
  });

  it("does not strip a leading zero byte from a signature", async () => {
    const device = new FakeLedger();
    const signature = new Uint8Array(64); // every byte zero, including the first
    const publicKey = new Uint8Array(32).fill(1);
    device.queueOk(new Uint8Array([...signature, ...publicKey]));

    const result = await bridgeFor(device).signTransaction("AAAA");

    expect(result.signature).toHaveLength(64);
    expect(Array.from(result.publicKey)).toEqual(Array.from(publicKey));
  });

  it("rejects a truncated signature", async () => {
    const device = new FakeLedger();
    device.queueOk(new Uint8Array(64));

    await expect(bridgeFor(device).signTransaction("AAAA")).rejects.toThrow(/truncated signature/);
  });

  it("requires an envelope to sign", async () => {
    const device = new FakeLedger();
    await expect(bridgeFor(device).signTransaction("")).rejects.toThrow(/envelope is required/);
  });

  it("describes the connected device", () => {
    expect(bridgeFor(new FakeLedger()).describe()).toBe("Ledger Nano X");
  });
});

describe("claimLedgerDevice", () => {
  it("opens, configures and returns the selected device", async () => {
    const device = new FakeLedger();
    Object.defineProperty(global.navigator, "usb", {
      configurable: true,
      value: { requestDevice: jest.fn().mockResolvedValue(device) },
    });

    const claimed = await claimLedgerDevice();

    expect(device.opened).toBe(true);
    expect(device.configuration).not.toBeNull();
    expect(claimed).toBe(device);
  });

  it("returns a ready-to-use bridge from openLedgerDevice", async () => {
    const device = new FakeLedger();
    Object.defineProperty(global.navigator, "usb", {
      configurable: true,
      value: { requestDevice: jest.fn().mockResolvedValue(device) },
    });

    const bridge = await openLedgerDevice();

    expect(typeof bridge.getAddress).toBe("function");
  });

  it("reports unsupported when the browser has no WebUSB", async () => {
    Object.defineProperty(global.navigator, "usb", { configurable: true, value: undefined });

    await expect(claimLedgerDevice()).rejects.toMatchObject({ code: "unsupported" });
  });
});

describe("signature encoding", () => {
  it("base64-encodes bytes without Node Buffer", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("exposes a named helper for RPC transport", () => {
    const signature = new Uint8Array(64).fill(7);
    expect(encodeSignatureForRpc(signature)).toBe(Buffer.from(signature).toString("base64"));
  });
});

