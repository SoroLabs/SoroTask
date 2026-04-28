import React from 'react';
import { MentionableEntity } from '../types/mentions';

interface MentionRendererProps {
  text: string;
  className?: string;
}

// Simple mention parser - in a real app, you'd want more sophisticated parsing
function parseMentions(text: string): Array<{ text: string; isMention: boolean; entity?: MentionableEntity }> {
  const parts: Array<{ text: string; isMention: boolean; entity?: MentionableEntity }> = [];
  const mentionRegex = /(@|#|\$)[^\s]+/g;
  let lastIndex = 0;
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    // Add text before mention
    if (match.index > lastIndex) {
      parts.push({
        text: text.substring(lastIndex, match.index),
        isMention: false,
      });
    }

    // Add mention
    const mentionText = match[0];
    const trigger = mentionText[0];
    const displayName = mentionText.substring(1);

    // Mock entity resolution - in real app, you'd look up by ID or have a proper parser
    let entity: MentionableEntity | undefined;
    if (trigger === '@') {
      entity = { id: `user-${displayName}`, type: 'user', displayName, avatar: displayName.split(' ').map(n => n[0]).join('').toUpperCase() };
    } else if (trigger === '#') {
      entity = { id: `task-${displayName}`, type: 'task', displayName };
    } else if (trigger === '$') {
      entity = { id: `contract-${displayName}`, type: 'contract', displayName };
    }

    parts.push({
      text: mentionText,
      isMention: true,
      entity,
    });

    lastIndex = match.index + mentionText.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({
      text: text.substring(lastIndex),
      isMention: false,
    });
  }

  return parts;
}

export function MentionRenderer({ text, className = '' }: MentionRendererProps) {
  if (!text) return null;

  const parts = parseMentions(text);

  return (
    <div className={className}>
      {parts.map((part, index) => {
        if (part.isMention && part.entity) {
          return (
            <span
              key={index}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20 text-sm font-medium mr-1"
              title={`${part.entity.type}: ${part.entity.displayName}`}
            >
              {part.entity.avatar ? (
                <span className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                  {part.entity.avatar}
                </span>
              ) : (
                <span className="text-xs">
                  {part.entity.type === 'user' ? '👤' :
                   part.entity.type === 'task' ? '📋' : '📄'}
                </span>
              )}
              {part.text}
            </span>
          );
        }
        return <span key={index}>{part.text}</span>;
      })}
    </div>
  );
}