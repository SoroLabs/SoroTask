"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { usePathname } from "next/navigation";
import { getAIClient, AIMessage, AIServiceError, OpenAIClient } from "@/src/lib/ai/openai-client";

export interface PageContext {
  route: string;
  routeName: string;
  description: string;
}

export interface AIAssistantState {
  isOpen: boolean;
  messages: AIMessage[];
  isLoading: boolean;
  error: string | null;
  suggestions: string[];
  pageContext: PageContext | null;
  isSuggesting: boolean;
}

export interface AIAssistantActions {
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  sendMessage: (content: string) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  suggest: () => Promise<void>;
  clearError: () => void;
  resetConversation: () => void;
}

export type AIAssistantContextValue = AIAssistantState & AIAssistantActions;

const AIAssistantContext = createContext<AIAssistantContextValue | null>(null);

export function useAIAssistantContext(): AIAssistantContextValue {
  const context = useContext(AIAssistantContext);
  if (!context) {
    throw new Error("useAIAssistantContext must be used within AIAssistantProvider");
  }
  return context;
}

const routeContexts: Record<string, PageContext> = {
  "/": {
    route: "/",
    routeName: "Home",
    description: "Main dashboard and automation overview",
  },
  "/tasks": {
    route: "/tasks",
    routeName: "Tasks",
    description: "Task management and creation",
  },
  "/dashboard": {
    route: "/dashboard",
    routeName: "Dashboard",
    description: "Live performance monitoring",
  },
  "/board": {
    route: "/board",
    routeName: "Board",
    description: "Execution board for triaging automations",
  },
  "/marketplace": {
    route: "/marketplace",
    routeName: "Marketplace",
    description: "Keeper marketplace and bidding",
  },
  "/settings": {
    route: "/settings",
    routeName: "Settings",
    description: "Application configuration",
  },
  "/admin": {
    route: "/admin",
    routeName: "Admin",
    description: "Administrative controls",
  },
};

function getPageContext(pathname: string): PageContext | null {
  for (const [route, ctx] of Object.entries(routeContexts)) {
    if (pathname === route || pathname.startsWith(route + "/")) {
      return ctx;
    }
  }
  return null;
}

export function AIAssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);

  const clientRef = useRef<OpenAIClient | null>(null);

  useEffect(() => {
    try {
      clientRef.current = getAIClient();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }, []);

  const pageContext = useMemo<PageContext | null>(() => getPageContext(pathname), [pathname]);

  const togglePanel = useCallback(() => setIsOpen((prev) => !prev), []);
  const openPanel = useCallback(() => setIsOpen(true), []);
  const closePanel = useCallback(() => setIsOpen(false), []);

  const clearError = useCallback(() => setError(null), []);

  const resetConversation = useCallback(() => {
    setMessages([]);
    setError(null);
    setSuggestions([]);
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const client = clientRef.current;
      if (!client) {
        setError("AI client not initialized");
        return;
      }
      if (!content.trim()) return;

      setIsLoading(true);
      clearError();

      try {
        const userMsg: AIMessage = { role: "user", content: content.trim() };
        setMessages((prev) => [...prev, userMsg]);

        const response = await client.chat(content.trim());
        const assistantMsg: AIMessage = {
          role: "assistant",
          content: response.content,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        const errorMessage =
          err instanceof AIServiceError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : "Failed to send message";
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    [clearError]
  );

  const retryLastMessage = useCallback(async () => {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMessage) {
      await sendMessage(lastUserMessage.content);
    }
  }, [messages, sendMessage]);

  const suggest = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !pageContext) return;

    setIsSuggesting(true);
    clearError();

    try {
      const prompt = `You are a helpful AI coding assistant for the SoroTask platform.
The user is currently on the "${pageContext.routeName}" page (${pageContext.route}): ${pageContext.description}.
Suggest exactly 3 to 4 specific, actionable suggestions for what the user might want to do next on this page.
Respond ONLY with a JSON array of strings. Example: ["Suggestion 1", "Suggestion 2", "Suggestion 3"]
No additional text or markdown.`;

      const response = await client.chat(prompt);

      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) {
            setSuggestions(parsed.filter((s: unknown) => typeof s === "string"));
          }
        } catch {
          setSuggestions([response.content]);
        }
      } else {
        setSuggestions([response.content]);
      }
    } catch (err) {
      const errorMessage =
        err instanceof AIServiceError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Failed to generate suggestions";
      setError(errorMessage);

      const fallbackMap: Record<string, string[]> = {
        "/": [
          "Create your first automation",
          "Explore the dashboard",
          "View keeper metrics",
        ],
        "/tasks": [
          "Create new task",
          "View active tasks",
          "Check execution logs",
        ],
        "/dashboard": [
          "Analyze performance",
          "Review keeper health",
          "Check transaction volume",
        ],
        "/board": [
          "Triage active automations",
          "Filter by status",
          "Update priorities",
        ],
        "/marketplace": [
          "Find available keepers",
          "Place a bid",
          "Review keeper ratings",
        ],
        "/settings": [
          "Configure automation preferences",
          "Set notification alerts",
          "Manage API keys",
        ],
      };
      setSuggestions(
        fallbackMap[pathname] || [
          "Explore the platform",
          "Check documentation",
          "Contact support",
        ]
      );
    } finally {
      setIsSuggesting(false);
    }
  }, [pageContext, pathname, clearError]);

  const value = useMemo<AIAssistantContextValue>(
    () => ({
      isOpen,
      messages,
      isLoading,
      error,
      suggestions,
      pageContext,
      isSuggesting,
      togglePanel,
      openPanel,
      closePanel,
      sendMessage,
      retryLastMessage,
      suggest,
      clearError,
      resetConversation,
    }),
    [
      isOpen,
      messages,
      isLoading,
      error,
      suggestions,
      pageContext,
      isSuggesting,
      togglePanel,
      openPanel,
      closePanel,
      sendMessage,
      retryLastMessage,
      suggest,
      clearError,
      resetConversation,
    ]
  );

  return (
    <AIAssistantContext.Provider value={value}>
      {children}
    </AIAssistantContext.Provider>
  );
}
