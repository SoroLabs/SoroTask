import { useAIAssistantContext } from "../ContextProvider";

export function useAIAssistant() {
  const context = useAIAssistantContext();
  return context;
}
