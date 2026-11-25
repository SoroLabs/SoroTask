'use client';

import React from 'react';
import type { Collaborator } from '../../hooks/useCollaborativePresence';

interface Props {
  collaborators: Collaborator[];
}

/**
 * CollaborativePresenceLayer
 *
 * Renders floating cursor + avatar overlays for every remote collaborator
 * currently viewing the board. Position is relative to the board container.
 */
export default function CollaborativePresenceLayer({ collaborators }: Props) {
  if (collaborators.length === 0) return null;

  return (
    <>
      {collaborators.map((c) => (
        <CollaboratorCursor key={c.userId} collaborator={c} />
      ))}
    </>
  );
}

function CollaboratorCursor({ collaborator: c }: { collaborator: Collaborator }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: c.cursorX,
        top: c.cursorY,
        pointerEvents: 'none',
        zIndex: 100,
        transform: 'translate(-2px, -2px)',
        transition: 'left 80ms linear, top 80ms linear',
      }}
    >
      {/* Cursor arrow */}
      <svg
        width="16"
        height="20"
        viewBox="0 0 16 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
      >
        <path
          d="M0 0L0 14L4 10L7 17L9 16L6 9L11 9L0 0Z"
          fill={c.avatarColor}
          stroke="white"
          strokeWidth="1"
        />
      </svg>

      {/* Name badge */}
      <div
        style={{
          marginLeft: 12,
          marginTop: -4,
          backgroundColor: c.avatarColor,
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      >
        {c.displayName}
        {c.focusedTaskId && (
          <span style={{ opacity: 0.8, marginLeft: 4 }}>
            · editing #{c.focusedTaskId}
          </span>
        )}
      </div>
    </div>
  );
}
