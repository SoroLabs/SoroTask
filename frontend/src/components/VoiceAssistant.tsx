"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  Mic,
  MicOff,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Bot,
  Volume2,
  VolumeX,
  ShieldCheck,
  X,
} from "lucide-react";
import { TaskWizardFormData } from "@/types/task-wizard.types";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export interface ParsedTaskIntent {
  rawTranscript: string;
  confidence: number;
  extractedParams: {
    action?: string;
    targetContractId?: string;
    functionName?: string;
    functionArgs?: string;
    cronInterval?: string;
    gasDeposit?: string;
  };
  humanReadableSummary: string;
  warnings?: string[];
}

export interface VoiceAssistantProps {
  onApplyIntent: (data: Partial<TaskWizardFormData>) => void;
  className?: string;
}

const DEFAULT_LIQUIDITY_POOL_CONTRACT =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function parseHourTo24(hourStr: string, meridiem?: string): number {
  let hour = parseInt(hourStr, 10);
  if (Number.isNaN(hour)) return 9;
  const m = meridiem?.toLowerCase();
  if (m === "pm" && hour < 12) hour += 12;
  if (m === "am" && hour === 12) hour = 0;
  return Math.max(0, Math.min(23, hour));
}

/**
 * Local Rule-based NLP Intent Parser
 * Parses natural language commands like:
 * "Swap 50 USDC to XLM every Monday at 9am"
 * "Rebalance pool position when price drops below 0.12 with 20 XLM deposit"
 * "Execute transfer to CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC every hour"
 */
export function parseNaturalLanguageTask(transcript: string): ParsedTaskIntent {
  const normalized = transcript.trim();
  const lower = normalized.toLowerCase();

  const extracted: ParsedTaskIntent["extractedParams"] = {};
  const warnings: string[] = [];
  let summary = "Custom automation task";
  let confidence = 0.85;

  // 1. Extract Contract ID (Stellar C... 56-char address)
  const contractMatch = normalized.match(/\bC[A-Z2-7]{55}\b/) ||
    normalized.match(/C[A-Z0-9]{55}/);
  if (contractMatch) {
    extracted.targetContractId = contractMatch[0];
    confidence = 0.95;
  } else if (lower.includes("usdc") || lower.includes("swap") || lower.includes("pool")) {
    // Default standard liquidity pool contract
    extracted.targetContractId = DEFAULT_LIQUIDITY_POOL_CONTRACT;
    warnings.push(
      "Contract address was inferred from defaults. Verify before signing.",
    );
  } else {
    warnings.push(
      "No Stellar contract address (C...) detected. You will need to provide one.",
    );
  }

  // 2. Extract Function Name & Args
  const explicitMethodMatch = normalized.match(
    /(?:call|invoke|method|function)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
  );
  if (lower.includes("swap") || lower.includes("trade")) {
    extracted.action = "swap";
    extracted.functionName = "swap_tokens";
    const amountMatch = lower.match(/(\d+(?:\.\d+)?)\s*(usdc|xlm|eurc|btc|eth)/i);
    const amount = amountMatch ? amountMatch[1] : "50";
    const token = amountMatch ? amountMatch[2].toUpperCase() : "USDC";
    extracted.functionArgs = JSON.stringify(
      { amount, token, recipient: "self" },
      null,
      2,
    );
    summary = `Swap ${amount} ${token} on automated schedule`;
  } else if (lower.includes("rebalance")) {
    extracted.action = "rebalance";
    extracted.functionName = "rebalance_pool";
    extracted.functionArgs = JSON.stringify(
      { slippage_tolerance_bps: 50, trigger_delta: 0.05 },
      null,
      2,
    );
    summary = "Rebalance liquidity pool based on market delta";
  } else if (lower.includes("compound") || lower.includes("harvest")) {
    extracted.action = "compound";
    extracted.functionName = "harvest_and_compound";
    extracted.functionArgs = JSON.stringify({ auto_stake: true }, null, 2);
    summary = "Harvest yield and auto-compound rewards";
  } else if (lower.includes("transfer") || lower.includes("send")) {
    extracted.action = "transfer";
    extracted.functionName = "transfer";
    const amountMatch = lower.match(/(\d+(?:\.\d+)?)\s*(usdc|xlm)/i);
    const amount = amountMatch ? amountMatch[1] : "10";
    const token = amountMatch ? amountMatch[2].toUpperCase() : "XLM";
    extracted.functionArgs = JSON.stringify({ amount, token }, null, 2);
    summary = `Transfer ${amount} ${token} on automated schedule`;
  } else if (lower.includes("claim")) {
    extracted.action = "claim";
    extracted.functionName = "claim_rewards";
    extracted.functionArgs = JSON.stringify({ claim_all: true }, null, 2);
    summary = "Claim staking or protocol rewards";
  } else if (explicitMethodMatch) {
    extracted.action = explicitMethodMatch[1];
    extracted.functionName = explicitMethodMatch[1];
    extracted.functionArgs = JSON.stringify([], null, 2);
    summary = `Invoke ${explicitMethodMatch[1]}() on automated schedule`;
  } else {
    extracted.action = "default";
    extracted.functionName = "execute_task";
    extracted.functionArgs = JSON.stringify({ action: "default" }, null, 2);
  }

  // 3. Extract Schedule / Cron Interval
  const everyNMinutesMatch = lower.match(
    /every\s+(\d+)\s*(?:minutes?|mins?)/i,
  );
  const everyNHoursMatch = lower.match(/every\s+(\d+)\s*hours?/i);
  const weekdayTimeMatch = lower.match(
    /(?:every\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+at)?\s+(\d{1,2})\s*(am|pm)?/i,
  );
  const dailyAtMatch = lower.match(
    /(?:every\s+day|daily)\s+at\s+(\d{1,2})\s*(am|pm)?/i,
  );

  if (weekdayTimeMatch) {
    const dow = WEEKDAY_MAP[weekdayTimeMatch[1].toLowerCase()];
    const hour = parseHourTo24(weekdayTimeMatch[2], weekdayTimeMatch[3]);
    extracted.cronInterval = `0 ${hour} * * ${dow}`;
  } else if (dailyAtMatch) {
    const hour = parseHourTo24(dailyAtMatch[1], dailyAtMatch[2]);
    extracted.cronInterval = `0 ${hour} * * *`;
  } else if (
    lower.includes("every day at midnight") ||
    lower.includes("daily")
  ) {
    extracted.cronInterval = "0 0 * * *";
  } else if (everyNMinutesMatch) {
    const mins = Math.max(1, Math.min(59, parseInt(everyNMinutesMatch[1], 10)));
    extracted.cronInterval = `*/${mins} * * * *`;
  } else if (lower.includes("10 mins")) {
    extracted.cronInterval = "*/10 * * * *";
  } else if (everyNHoursMatch) {
    const hrs = Math.max(1, Math.min(23, parseInt(everyNHoursMatch[1], 10)));
    extracted.cronInterval = `0 */${hrs} * * *`;
  } else if (lower.includes("every hour") || lower.includes("hourly")) {
    extracted.cronInterval = "0 * * * *";
  } else if (lower.includes("weekly") || lower.includes("every week")) {
    extracted.cronInterval = "0 0 * * 0";
  } else if (lower.includes("monthly") || lower.includes("every month")) {
    extracted.cronInterval = "0 0 1 * *";
  } else {
    extracted.cronInterval = "0 * * * *";
  }

  // 4. Extract Gas Deposit
  const gasMatch =
    lower.match(/(\d+(?:\.\d+)?)\s*(?:xlm)?\s*(?:gas\s+)?deposit/i) ||
    lower.match(/(\d+(?:\.\d+)?)\s*(?:xlm)?\s*gas/i);
  if (gasMatch) {
    extracted.gasDeposit = gasMatch[1];
  } else {
    extracted.gasDeposit = "15";
  }

  return {
    rawTranscript: normalized,
    confidence,
    extractedParams: extracted,
    humanReadableSummary: summary,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export const VoiceAssistant: React.FC<VoiceAssistantProps> = React.memo(
  ({ onApplyIntent, className = "" }) => {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [parsedIntent, setParsedIntent] = useState<ParsedTaskIntent | null>(
      null,
    );
    const [isSupported, setIsSupported] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [speechFeedbackEnabled, setSpeechFeedbackEnabled] = useState(false);
    const [liveAnnouncement, setLiveAnnouncement] = useState("");

    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    const registerTimer = useCallback((timer: ReturnType<typeof setTimeout>) => {
      timersRef.current.push(timer);
      return timer;
    }, []);

    const speakText = useCallback(
      (message: string) => {
        if (
          !speechFeedbackEnabled ||
          typeof window === "undefined" ||
          !("speechSynthesis" in window)
        ) {
          return;
        }
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(message);
          utterance.lang = "en-US";
          window.speechSynthesis.speak(utterance);
        } catch {
          // Speech synthesis is optional; ignore errors in unsupported environments
        }
      },
      [speechFeedbackEnabled],
    );

    const handleAnalyzeText = useCallback(
      (text: string) => {
        if (!text.trim()) {
          setParsedIntent(null);
          return;
        }
        const result = parseNaturalLanguageTask(text);
        setParsedIntent(result);
        const announcement = `Parsed command: ${result.humanReadableSummary}. Function ${result.extractedParams.functionName}, schedule ${result.extractedParams.cronInterval}.`;
        setLiveAnnouncement(announcement);
        speakText(announcement);
      },
      [speakText],
    );

    useEffect(() => {
      const win = window as unknown as WindowWithSpeechRecognition;
      const SpeechRecognitionCtor =
        win.SpeechRecognition || win.webkitSpeechRecognition;

      if (!SpeechRecognitionCtor) {
        setIsSupported(false);
        return;
      }

      try {
        const recognition = new SpeechRecognitionCtor();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onresult = (event: SpeechRecognitionEventLike) => {
          let currentTranscript = "";
          let hasFinal = false;
          for (let i = 0; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              hasFinal = true;
            }
          }
          setTranscript(currentTranscript);
          if (hasFinal && currentTranscript.trim()) {
            const result = parseNaturalLanguageTask(currentTranscript);
            setParsedIntent(result);
            setLiveAnnouncement(
              `Captured voice command: ${result.humanReadableSummary}`,
            );
          }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
          const message =
            event.error === "not-allowed"
              ? "Microphone access was denied. Please allow microphone permissions or type your command below."
              : event.error === "no-speech"
                ? "No speech detected. Try speaking again or type your command below."
                : event.error || "Speech recognition error";
          setErrorMsg(message);
          setLiveAnnouncement(message);
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
      } catch {
        setIsSupported(false);
      }

      return () => {
        try {
          recognitionRef.current?.abort();
        } catch {
          // Ignore cleanup errors
        }
        recognitionRef.current = null;
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          try {
            window.speechSynthesis.cancel();
          } catch {
            // Ignore cleanup errors
          }
        }
      };
    }, []);

    const toggleListening = useCallback(() => {
      setErrorMsg(null);
      setConfirmed(false);

      if (isListening) {
        recognitionRef.current?.stop();
        setIsListening(false);
        setLiveAnnouncement("Stopped listening.");
        return;
      }

      setTranscript("");
      setParsedIntent(null);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
          setIsListening(true);
          setLiveAnnouncement("Listening for your task command.");
        } catch {
          setErrorMsg(
            "Unable to start microphone. Please check permissions or try again.",
          );
          setIsListening(false);
        }
      } else {
        // Fallback simulated voice demo when Web Speech API is unavailable
        setIsListening(true);
        setLiveAnnouncement("Running simulated voice command capture.");
        registerTimer(
          setTimeout(() => {
            const sample =
              "Swap 50 USDC to XLM every Monday at 9am with 20 XLM gas deposit";
            setTranscript(sample);
            handleAnalyzeText(sample);
            setIsListening(false);
          }, 800),
        );
      }
    }, [isListening, handleAnalyzeText, registerTimer]);

    // Hands-free keyboard shortcut: Alt+V to toggle voice listening, Escape to close modal
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.altKey && e.key.toLowerCase() === "v") {
          e.preventDefault();
          toggleListening();
        } else if (e.key === "Escape" && isConfirmModalOpen) {
          e.preventDefault();
          setIsConfirmModalOpen(false);
          setLiveAnnouncement("Confirmation dialog closed.");
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [toggleListening, isConfirmModalOpen]);

    // Move focus to confirm button when confirmation modal opens
    useEffect(() => {
      if (isConfirmModalOpen) {
        confirmButtonRef.current?.focus();
      }
    }, [isConfirmModalOpen]);

    const handleRequestConfirm = useCallback(() => {
      if (!parsedIntent) return;
      setIsConfirmModalOpen(true);
      const msg = `Please review before applying: ${parsedIntent.humanReadableSummary}.`;
      setLiveAnnouncement(msg);
      speakText(msg);
    }, [parsedIntent, speakText]);

    const handleCancelConfirm = useCallback(() => {
      setIsConfirmModalOpen(false);
      setLiveAnnouncement("Parameter application cancelled.");
    }, []);

    const handleConfirmApply = useCallback(() => {
      if (!parsedIntent) return;
      onApplyIntent({
        targetContractId: parsedIntent.extractedParams.targetContractId,
        functionName: parsedIntent.extractedParams.functionName,
        functionArgs: parsedIntent.extractedParams.functionArgs,
        cronInterval: parsedIntent.extractedParams.cronInterval,
        gasDeposit: parsedIntent.extractedParams.gasDeposit,
      });
      setIsConfirmModalOpen(false);
      setConfirmed(true);
      const msg = "Parameters applied to creation wizard.";
      setLiveAnnouncement(msg);
      speakText(msg);
      registerTimer(
        setTimeout(() => {
          setConfirmed(false);
          setParsedIntent(null);
          setTranscript("");
        }, 2500),
      );
    }, [parsedIntent, onApplyIntent, speakText, registerTimer]);

    const truncatedContract = useMemo(() => {
      const id = parsedIntent?.extractedParams.targetContractId;
      if (!id) return "Not specified";
      return id.length > 14 ? `${id.substring(0, 10)}...` : id;
    }, [parsedIntent?.extractedParams.targetContractId]);

    return (
      <section
        data-testid="voice-assistant"
        aria-label="Voice and Natural Language Task Creator"
        className={`bg-neutral-900 border border-neutral-800 rounded-xl p-5 text-neutral-100 shadow-md ${className}`}
      >
        {/* Screen-reader live region for hands-free status updates */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          data-testid="voice-live-region"
        >
          {liveAnnouncement}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div
              className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400"
              aria-hidden="true"
            >
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                Voice & Natural Language Task Creator
                <span className="text-[11px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-mono">
                  Local NLP
                </span>
              </h3>
              <p className="text-xs text-neutral-400">
                Speak or type natural automation instructions to pre-populate
                task parameters (Shortcut: Alt+V)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSpeechFeedbackEnabled((prev) => !prev)}
              aria-pressed={speechFeedbackEnabled}
              aria-label={
                speechFeedbackEnabled
                  ? "Disable spoken feedback"
                  : "Enable spoken feedback"
              }
              data-testid="voice-feedback-toggle"
              className={`p-2 rounded-lg border text-xs transition-colors ${
                speechFeedbackEnabled
                  ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                  : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200"
              }`}
              title={
                speechFeedbackEnabled
                  ? "Spoken feedback enabled"
                  : "Enable spoken feedback"
              }
            >
              {speechFeedbackEnabled ? (
                <Volume2 className="w-4 h-4" aria-hidden="true" />
              ) : (
                <VolumeX className="w-4 h-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={toggleListening}
              aria-pressed={isListening}
              aria-label={
                isListening ? "Stop voice listening" : "Start voice command"
              }
              data-testid="voice-toggle-btn"
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                isListening
                  ? "bg-rose-600 text-white animate-pulse"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
            >
              {isListening ? (
                <>
                  <MicOff className="w-4 h-4" aria-hidden="true" />
                  Listening...
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" aria-hidden="true" />
                  Speak Command
                </>
              )}
            </button>
          </div>
        </div>

        {/* Browser support notice */}
        {!isSupported && (
          <div
            data-testid="voice-unsupported-notice"
            className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              Web Speech API is not available in this browser. You can type a
              command below or click Speak Command for a guided demo.
            </span>
          </div>
        )}

        {/* Error banner */}
        {errorMsg && (
          <div
            role="alert"
            data-testid="voice-error-alert"
            className="mb-3 flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Manual text input fallback */}
        <div className="flex gap-2 mb-4">
          <label htmlFor="voice-natural-command-input" className="sr-only">
            Natural language task command
          </label>
          <input
            id="voice-natural-command-input"
            type="text"
            data-testid="natural-command-input"
            placeholder="e.g. 'Swap 50 USDC to XLM every Monday at 9am with 20 XLM gas'"
            value={transcript}
            onChange={(e) => {
              setTranscript(e.target.value);
              handleAnalyzeText(e.target.value);
            }}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={() => handleAnalyzeText(transcript)}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
            Parse
          </button>
        </div>

        {/* Parsed Parameter Review Card */}
        {parsedIntent && (
          <div
            data-testid="intent-review-card"
            className="bg-neutral-950 border border-neutral-800 rounded-lg p-4 animate-fade-in"
          >
            <div className="flex items-center justify-between mb-3 border-b border-neutral-800/80 pb-2">
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <Sparkles
                  className="w-4 h-4 text-emerald-400"
                  aria-hidden="true"
                />
                {parsedIntent.humanReadableSummary}
              </span>
              <span className="text-[11px] text-neutral-400 font-mono">
                Confidence: {Math.round(parsedIntent.confidence * 100)}%
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
              <div className="bg-neutral-900/90 p-2 rounded border border-neutral-800">
                <span className="text-neutral-500 block text-[10px] uppercase">
                  Contract
                </span>
                <span
                  className="font-mono text-neutral-200 truncate block"
                  title={parsedIntent.extractedParams.targetContractId || ""}
                >
                  {truncatedContract}
                </span>
              </div>

              <div className="bg-neutral-900/90 p-2 rounded border border-neutral-800">
                <span className="text-neutral-500 block text-[10px] uppercase">
                  Function
                </span>
                <span className="font-semibold text-neutral-200 block">
                  {parsedIntent.extractedParams.functionName}()
                </span>
              </div>

              <div className="bg-neutral-900/90 p-2 rounded border border-neutral-800">
                <span className="text-neutral-500 block text-[10px] uppercase">
                  Schedule
                </span>
                <span className="font-mono text-neutral-200 block">
                  {parsedIntent.extractedParams.cronInterval}
                </span>
              </div>

              <div className="bg-neutral-900/90 p-2 rounded border border-neutral-800">
                <span className="text-neutral-500 block text-[10px] uppercase">
                  Gas Deposit
                </span>
                <span className="font-semibold text-indigo-400 block">
                  {parsedIntent.extractedParams.gasDeposit} XLM
                </span>
              </div>
            </div>

            {/* Confirmation & Apply Trigger */}
            <div className="flex justify-end gap-3 items-center">
              {confirmed ? (
                <span
                  data-testid="intent-confirmed-msg"
                  className="text-xs text-emerald-400 flex items-center gap-1.5 font-medium"
                >
                  <CheckCircle2
                    className="w-4 h-4 text-emerald-400"
                    aria-hidden="true"
                  />
                  Parameters applied to creation wizard!
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleRequestConfirm}
                  data-testid="apply-intent-btn"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  Review & Apply Parameters
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Confirmation Modal for User Review Before Signing */}
        {isConfirmModalOpen && parsedIntent && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="voice-confirm-title"
              aria-describedby="voice-confirm-desc"
              data-testid="voice-confirmation-modal"
              className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 p-6 text-neutral-100 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3 border-b border-neutral-800 pb-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck
                    className="w-5 h-5 text-emerald-400 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <h4
                      id="voice-confirm-title"
                      className="text-sm font-bold text-neutral-100"
                    >
                      Confirm Voice-Extracted Task Parameters
                    </h4>
                    <p
                      id="voice-confirm-desc"
                      className="text-xs text-neutral-400"
                    >
                      Review all extracted parameters carefully before applying
                      them to the task creation form. No transaction is signed
                      yet.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCancelConfirm}
                  aria-label="Close confirmation dialog"
                  className="p-1 text-neutral-400 hover:text-neutral-200 rounded"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <dl className="space-y-2.5 text-xs mb-4">
                <div className="flex flex-col rounded-lg bg-neutral-950 p-2.5 border border-neutral-800">
                  <dt className="text-[10px] uppercase text-neutral-500">
                    Target Contract Address
                  </dt>
                  <dd className="font-mono text-neutral-200 break-all mt-0.5">
                    {parsedIntent.extractedParams.targetContractId ||
                      "Not specified"}
                  </dd>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-lg bg-neutral-950 p-2.5 border border-neutral-800">
                    <dt className="text-[10px] uppercase text-neutral-500">
                      Method
                    </dt>
                    <dd className="font-mono font-semibold text-neutral-200 mt-0.5">
                      {parsedIntent.extractedParams.functionName}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-neutral-950 p-2.5 border border-neutral-800">
                    <dt className="text-[10px] uppercase text-neutral-500">
                      Cron Interval
                    </dt>
                    <dd className="font-mono text-neutral-200 mt-0.5">
                      {parsedIntent.extractedParams.cronInterval}
                    </dd>
                  </div>
                </div>

                <div className="rounded-lg bg-neutral-950 p-2.5 border border-neutral-800">
                  <dt className="text-[10px] uppercase text-neutral-500">
                    Gas Deposit
                  </dt>
                  <dd className="font-semibold text-indigo-400 mt-0.5">
                    {parsedIntent.extractedParams.gasDeposit} XLM
                  </dd>
                </div>

                {parsedIntent.extractedParams.functionArgs && (
                  <div className="rounded-lg bg-neutral-950 p-2.5 border border-neutral-800">
                    <dt className="text-[10px] uppercase text-neutral-500">
                      Function Arguments (JSON)
                    </dt>
                    <dd className="font-mono text-neutral-300 mt-1 whitespace-pre-wrap text-[11px]">
                      {parsedIntent.extractedParams.functionArgs}
                    </dd>
                  </div>
                )}
              </dl>

              {parsedIntent.warnings && parsedIntent.warnings.length > 0 && (
                <div
                  role="alert"
                  className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1"
                >
                  {parsedIntent.warnings.map((warning) => (
                    <p key={warning} className="flex items-start gap-2">
                      <AlertCircle
                        className="w-3.5 h-3.5 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <span>{warning}</span>
                    </p>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={handleCancelConfirm}
                  data-testid="cancel-confirm-btn"
                  className="px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  ref={confirmButtonRef}
                  type="button"
                  onClick={handleConfirmApply}
                  data-testid="confirm-apply-intent-btn"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Confirm & Apply to Form
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  },
);

VoiceAssistant.displayName = "VoiceAssistant";

export default VoiceAssistant;
