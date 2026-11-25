"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAIAssistant } from "./hooks/useAIAssistant";
import { Drawer } from "@/components/Drawer";
import { FiMessageSquare, FiSend, FiRefreshCw, FiChevronRight, FiX } from "react-icons/fi";

function StreamingText({ text, speed = 12 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("");
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setDisplayed("");
    indexRef.current = 0;
    if (timerRef.current) clearInterval(timerRef.current);

    if (text.length === 0) return;

    timerRef.current = setInterval(() => {
      indexRef.current += 1;
      if (indexRef.current >= text.length) {
        indexRef.current = text.length;
        setDisplayed(text);
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, speed);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [text, speed]);

  if (displayed.length === 0 && text.length > 0) {
    return (
      <span className="text-neutral-100">
        <span className="inline-block w-2 h-4 bg-neutral-500 animate-pulse ml-1 align-middle" />
      </span>
    );
  }

  return (
    <span className="text-neutral-100 whitespace-pre-wrap break-words">
      {displayed}
      {displayed.length < text.length && (
        <span className="inline-block w-2 h-4 bg-neutral-500 animate-pulse ml-0.5 align-middle" />
      )}
    </span>
  );
}

function MessageBubble({
  role,
  content,
  isStreaming,
}: {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? "bg-blue-600/90 text-white rounded-br-md"
            : "bg-neutral-800/80 text-neutral-100 border border-neutral-700/50 rounded-bl-md"
        }`}
      >
        {isStreaming ? (
          <StreamingText text={content} />
        ) : (
          <span className="whitespace-pre-wrap break-words">{content}</span>
        )}
      </div>
    </div>
  );
}

export function AIAssistantPanel() {
  const {
    isOpen,
    togglePanel,
    openPanel,
    messages,
    isLoading,
    error,
    suggestions,
    pageContext,
    isSuggesting,
    sendMessage,
    retryLastMessage,
    suggest,
    clearError,
    resetConversation,
  } = useAIAssistant();

  const [inputValue, setInputValue] = useState("");
  const [hasInteracted, setHasInteracted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const lastAssistantMessage = useRef<string>("");
  const [streamingId, setStreamingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      if (!hasInteracted && suggestions.length === 0 && !isSuggesting) {
        suggest();
      }
      if (!hasInteracted && messages.length === 0 && pageContext) {
        setHasInteracted(true);
      }
    }
  }, [isOpen, hasInteracted, suggestions.length, isSuggesting, suggest, messages.length, pageContext]);

  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "assistant" && lastMsg.content !== lastAssistantMessage.current) {
      lastAssistantMessage.current = lastMsg.content;
      setStreamingId(`msg-${Date.now()}`);
      const timer = setTimeout(() => setStreamingId(null), lastMsg.content.length * 12 + 500);
      return () => clearTimeout(timer);
    }
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingId]);

  const handleSend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const value = inputValue.trim();
      if (!value || isLoading) return;

      setInputValue("");
      setHasInteracted(true);
      lastAssistantMessage.current = "";
      await sendMessage(value);
    },
    [inputValue, isLoading, sendMessage]
  );

  const handleSuggestionClick = useCallback(
    async (suggestion: string) => {
      setInputValue("");
      setHasInteracted(true);
      lastAssistantMessage.current = "";
      await sendMessage(suggestion);
    },
    [sendMessage]
  );

  const handleRetry = useCallback(async () => {
    lastAssistantMessage.current = "";
    await retryLastMessage();
  }, [retryLastMessage]);

  const handleTogglePanel = useCallback(() => {
    if (!isOpen) {
      lastAssistantMessage.current = "";
    }
    togglePanel();
  }, [isOpen, togglePanel]);

  const showSuggestions = isOpen && (!hasInteracted || messages.length === 0);

  return (
    <>
      <button
        type="button"
        onClick={handleTogglePanel}
        aria-label={isOpen ? "Close AI Assistant" : "Open AI Assistant"}
        className={`fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition-all duration-300 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-neutral-950 ${
          isOpen
            ? "bg-neutral-800 text-neutral-400 rotate-90"
            : "bg-emerald-400 text-neutral-950 hover:bg-emerald-300"
        }`}
        data-testid="ai-assistant-fab"
      >
        {isOpen ? <FiX size={22} /> : <FiMessageSquare size={22} />}
      </button>

      <Drawer
        open={isOpen}
        onClose={togglePanel}
        title="AI Coding Assistant"
        description={
          pageContext
            ? `Context: ${pageContext.routeName}`
            : "Get help with your workflows"
        }
        side="right"
        width="w-96 max-w-[calc(100vw-3rem)]"
        disableEscapeClose={false}
        data-testid="ai-assistant-drawer"
      >
        <div className="flex flex-col h-full">
          {/* Context badge */}
          {pageContext && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-neutral-800/60 border border-neutral-700/50">
              <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
                Current Page
              </p>
              <p className="text-sm text-neutral-200 mt-0.5">{pageContext.description}</p>
            </div>
          )}

          {/* Suggestions */}
          {showSuggestions && (
            <div className="mb-4">
              <p className="text-xs font-medium text-neutral-400 mb-2 uppercase tracking-wider">
                {isSuggesting ? "Generating suggestions..." : "Suggested actions"}
              </p>
              <div className="space-y-2">
                {isSuggesting ? (
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <FiRefreshCw className="animate-spin" size={14} />
                    <span>Analyzing current page...</span>
                  </div>
                ) : (
                  suggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="w-full text-left px-3 py-2.5 rounded-xl bg-neutral-800/40 border border-neutral-700/30 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 hover:border-neutral-600 transition-all duration-200 group"
                    >
                      <span className="flex items-center justify-between">
                        <span className="line-clamp-2">{suggestion}</span>
                        <FiChevronRight className="text-neutral-600 group-hover:text-neutral-400 transition-colors flex-shrink-0 ml-2" size={14} />
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
            {messages.map((msg) => {
              const isStreamingThis =
                msg.role === "assistant" &&
                streamingId &&
                messages[messages.length - 1]?.content === msg.content &&
                streamingId !== null;

              return (
                <MessageBubble
                  key={`${msg.role}-${messages.indexOf(msg)}`}
                  role={msg.role}
                  content={msg.content}
                  isStreaming={!!isStreamingThis}
                />
              );
            })}

            {isLoading && messages.length > 0 && messages[messages.length - 1]?.role === "user" && (
              <div className="flex justify-start">
                <div className="bg-neutral-800/80 border border-neutral-700/50 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="flex justify-center">
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 max-w-full">
                  <p className="text-sm text-red-400 font-medium">Something went wrong</p>
                  <p className="text-xs text-red-300/80 mt-1 break-all">{error}</p>
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-red-300 hover:text-red-200 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <FiRefreshCw size={12} />
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={clearError}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-300 bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <FiX size={12} />
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 pt-4 border-t border-neutral-800/60 mt-4">
            <form onSubmit={handleSend} className="space-y-3">
              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Ask anything about SoroTask..."
                  disabled={isLoading}
                  className="w-full bg-neutral-800/60 border border-neutral-700/60 rounded-xl pl-4 pr-10 py-3 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  data-testid="ai-assistant-input"
                />
                <button
                  type="submit"
                  disabled={isLoading || !inputValue.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center size-8 rounded-lg bg-emerald-500 text-neutral-950 hover:bg-emerald-400 disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
                  aria-label="Send message"
                >
                  <FiSend size={14} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-[11px] text-neutral-600">
                  AI can make mistakes. Verify important information.
                </p>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={resetConversation}
                    className="text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    Clear chat
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </Drawer>
    </>
  );
}
