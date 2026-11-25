# Secure Micro-Frontend (MFE) Container

## Purpose
Provides a sandboxed, isolated wrapper to securely integrate remote micro-frontend modules into the primary application interface while ensuring high availability and fault tolerance.

## Key Features
- **Heartbeat Dead-Man Switch**: Uses an initialization timer (`initTimeoutMs`) instead of native `iframe.onerror` events (which do not reliably bubble cross-origin failures). If the child app fails to post `MFE_READY` or `HEARTBEAT` within the designated time frame, the parent unmounts the frame and prints a fallback UI.
- **Error Signal Receiver**: Listens for explicit `MFE_ERROR` events posted from whitelisted modules to immediately switch the container state to the error fallback.
- **Origin Validation Whitelists**: Inspects all incoming `message` window events, rejecting and warning against events sourced from non-whitelisted domains.
- **Strict Sandboxing**: Locks the execution context using restrictive sandbox flags: `allow-scripts allow-same-origin allow-forms allow-popups`.
- **Referrer Privacy**: Applies `referrerPolicy="no-referrer"` to prevent passing query parameter tokens or other path-based metadata to the external server.

## File Location
- Implementation: `frontend/components/mfe-container.tsx`
- Test Suite: `frontend/components/__tests__/mfe-container.test.tsx`

## Complexity Analysis
- **Time Complexity**: $O(1)$ for initialization, frame render, and event callback handling.
- **Space Complexity**: $O(1)$ constant overhead beyond the memory allocated by the browser engine to load the nested frame context.
