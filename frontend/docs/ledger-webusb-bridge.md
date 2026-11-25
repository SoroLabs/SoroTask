# Ledger WebUSB Bridge

The hardware wallet adapter uses the browser WebUSB API for Ledger devices. It requests only Ledger USB devices with vendor ID `0x2c97`, opens the selected device, selects configuration `1` when needed, and claims interface `0` before returning a session to the wallet UI.

## Failure Handling

- Unsupported browsers return an `unsupported` error and should keep the Ledger action disabled.
- Browser cancellation returns `device_not_selected` and is safe to retry.
- Browser permission failures return `permission_denied` and are safe to retry after the user grants access.
- Open, configuration, or interface claim failures return `device_unavailable`, which covers disconnected devices, busy devices, and transport interruptions.

All Ledger connection failures are represented by `HardwareWalletConnectionError` with a stable `code` and `retriable` flag so UI and telemetry can respond without parsing message text.

## Security Boundary

The bridge does not persist USB device handles, device serial numbers beyond the active session object, or private key material. Signing remains device-bound; the browser bridge only establishes transport and exposes a typed session for downstream transaction flows.
