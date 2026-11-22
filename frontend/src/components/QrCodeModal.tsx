"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import {
  splitPayloadIntoUrFrames,
  MultipartQrAssembler,
  generateQrSvg,
  type UrFrame,
  type AssembleResult,
} from "@/src/lib/qrProtocol";

export interface QrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactionXdr?: string;
  onScanComplete?: (signedPayload: string) => void;
  title?: string;
}

export function QrCodeModal({
  isOpen,
  onClose,
  transactionXdr = "",
  onScanComplete,
  title = "Air-Gapped Mobile Signing",
}: QrCodeModalProps) {
  const [tab, setTab] = useState<"display" | "scan">("display");
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [frameIntervalMs, setFrameIntervalMs] = useState(300);

  // Scanner state
  const [scanInput, setScanInput] = useState("");
  const [scanStatus, setScanStatus] = useState<AssembleResult | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const assemblerRef = useRef<MultipartQrAssembler>(new MultipartQrAssembler());

  const frames = useMemo(() => {
    return splitPayloadIntoUrFrames(transactionXdr);
  }, [transactionXdr]);

  // Animated frame carousel for multipart QR
  useEffect(() => {
    if (!isOpen || tab !== "display" || !isPlaying || frames.length <= 1)
      return;

    const timer = setInterval(() => {
      setCurrentFrameIndex((prev) => (prev + 1) % frames.length);
    }, frameIntervalMs);

    return () => clearInterval(timer);
  }, [isOpen, tab, isPlaying, frames.length, frameIntervalMs]);

  // Stop camera when modal closes or switches tabs
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    if (!isOpen || tab !== "scan") {
      stopCamera();
    }
  }, [isOpen, tab, stopCamera]);

  // Start webcam
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error("Webcam not supported in this environment");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);
    } catch (err) {
      setCameraError(
        err instanceof Error ? err.message : "Failed to access webcam",
      );
      setCameraActive(false);
    }
  };

  const handleManualFrameSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!scanInput.trim()) return;

    const res = assemblerRef.current.addPart(scanInput.trim());
    setScanStatus(res);
    setScanInput("");

    if (res.completed && res.payload && onScanComplete) {
      onScanComplete(res.payload);
    }
  };

  const handleResetScanner = () => {
    assemblerRef.current.reset();
    setScanStatus(null);
    setScanInput("");
  };

  if (!isOpen) return null;

  const activeFrame: UrFrame = frames[currentFrameIndex] || frames[0];
  const qrSvg = generateQrSvg(
    activeFrame?.urString || transactionXdr || "EMPTY",
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-neutral-900 border border-neutral-800 text-neutral-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div>
            <h2 id="qr-modal-title" className="text-lg font-bold">
              {title}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Secure offline communication over BC-UR multi-part QR codes
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 transition"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-neutral-800 bg-neutral-950/40">
          <button
            type="button"
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition ${
              tab === "display"
                ? "border-blue-500 text-blue-400 bg-blue-500/10"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
            onClick={() => setTab("display")}
          >
            1. Display QR to Sign ({frames.length}{" "}
            {frames.length === 1 ? "part" : "parts"})
          </button>
          <button
            type="button"
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition ${
              tab === "scan"
                ? "border-blue-500 text-blue-400 bg-blue-500/10"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
            onClick={() => setTab("scan")}
          >
            2. Scan Signed Signature
          </button>
        </div>

        {/* Tab content */}
        <div className="p-6">
          {tab === "display" ? (
            <div className="flex flex-col items-center text-center">
              {/* QR Container */}
              <div className="p-4 bg-white rounded-xl shadow-inner mb-4">
                <div
                  className="w-64 h-64 flex items-center justify-center overflow-hidden"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                  data-testid="qr-svg-container"
                />
              </div>

              {/* Multi-part info and animation controls */}
              <div className="w-full space-y-3">
                <div className="flex items-center justify-between text-xs text-neutral-400">
                  <span>
                    Part{" "}
                    <strong className="text-neutral-100">
                      {activeFrame.seq}
                    </strong>{" "}
                    of{" "}
                    <strong className="text-neutral-100">
                      {activeFrame.total}
                    </strong>
                  </span>
                  <span>
                    Checksum:{" "}
                    <code className="text-blue-400">
                      {activeFrame.checksum}
                    </code>
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-500 h-1.5 transition-all duration-300"
                    style={{
                      width: `${(activeFrame.seq / activeFrame.total) * 100}%`,
                    }}
                  />
                </div>

                {frames.length > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg bg-neutral-800 text-xs font-medium hover:bg-neutral-700 transition"
                      onClick={() =>
                        setCurrentFrameIndex(
                          (prev) => (prev - 1 + frames.length) % frames.length,
                        )
                      }
                      aria-label="Previous frame"
                    >
                      ◀ Prev
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-xs font-medium text-white hover:bg-blue-500 transition"
                      onClick={() => setIsPlaying(!isPlaying)}
                    >
                      {isPlaying ? "Pause Animation" : "Play Animation"}
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg bg-neutral-800 text-xs font-medium hover:bg-neutral-700 transition"
                      onClick={() =>
                        setCurrentFrameIndex(
                          (prev) => (prev + 1) % frames.length,
                        )
                      }
                      aria-label="Next frame"
                    >
                      Next ▶
                    </button>
                  </div>
                )}

                <div className="pt-2 text-xs text-neutral-500">
                  Scan this animated QR code with your air-gapped mobile signer
                  (e.g. Keystone, AirGap Vault).
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Webcam view */}
              <div className="relative w-full aspect-video rounded-xl bg-neutral-950 border border-neutral-800 overflow-hidden flex flex-col items-center justify-center">
                {cameraActive ? (
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    muted
                  />
                ) : (
                  <div className="text-center p-4">
                    <p className="text-sm text-neutral-400 mb-3">
                      Camera inactive or unavailable
                    </p>
                    <button
                      type="button"
                      onClick={startCamera}
                      className="px-4 py-2 rounded-lg bg-blue-600 text-xs font-medium text-white hover:bg-blue-500 transition"
                    >
                      Start Camera
                    </button>
                    {cameraError && (
                      <p className="text-xs text-red-400 mt-2">{cameraError}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Progress and status */}
              {scanStatus && (
                <div
                  className={`p-3 rounded-lg text-xs border ${
                    scanStatus.completed
                      ? "bg-green-500/10 border-green-500/20 text-green-400"
                      : scanStatus.error
                        ? "bg-red-500/10 border-red-500/20 text-red-400"
                        : "bg-blue-500/10 border-blue-500/20 text-blue-400"
                  }`}
                  data-testid="scan-status-banner"
                >
                  <div className="flex justify-between font-medium">
                    <span>
                      {scanStatus.completed
                        ? "✓ All parts reassembled & verified!"
                        : scanStatus.error
                          ? `Error: ${scanStatus.error}`
                          : `Reassembling frame ${scanStatus.currentPart}/${scanStatus.totalParts}`}
                    </span>
                    <span>{scanStatus.progress}%</span>
                  </div>
                  {scanStatus.payload && (
                    <div className="mt-2 text-neutral-300 font-mono text-[10px] break-all max-h-20 overflow-y-auto">
                      Signed XDR: {scanStatus.payload}
                    </div>
                  )}
                </div>
              )}

              {/* Simulated/Manual Frame Input */}
              <form onSubmit={handleManualFrameSubmit} className="space-y-2">
                <label className="block text-xs font-medium text-neutral-300">
                  Simulate QR Scanner / Paste Frame String:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    placeholder="ur:bytes/1-3/checksum/data..."
                    className="flex-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-xs font-mono text-neutral-100 focus:outline-none focus:border-blue-500"
                    data-testid="qr-frame-input"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-500 transition"
                  >
                    Ingest Frame
                  </button>
                  <button
                    type="button"
                    onClick={handleResetScanner}
                    className="px-3 py-2 rounded-lg bg-neutral-800 text-xs font-medium text-neutral-300 hover:bg-neutral-700 transition"
                  >
                    Reset
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
