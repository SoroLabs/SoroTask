# Bundle Performance — Issue #173

## Measurement methodology
- `next build` output (First Load JS column)
- Lighthouse CI on `/dashboard` route (mobile, throttled 4G)
- WebPageTest single run, Cable profile

## Baseline (before)

| Route       | First Load JS | TTI   | LCP   |
|-------------|--------------|-------|-------|
| /           | 312 kB       | 4.2 s | 2.8 s |
| /dashboard  | 487 kB       | 6.1 s | 3.4 s |
| /tasks/new  | 391 kB       | 5.3 s | 3.1 s |

## After lazy loading + chunk splitting

| Route       | First Load JS | TTI   | LCP   | Change     |
|-------------|--------------|-------|-------|------------|
| /           | 198 kB       | 2.6 s | 1.9 s | -36%       |
| /dashboard  | 221 kB       | 2.9 s | 2.1 s | -55%       |
| /tasks/new  | 204 kB       | 2.8 s | 2.0 s | -48%       |

## What moved
- `stellar-sdk` → separate chunk, loaded only on wallet connect
- `recharts` + `d3` → deferred until dashboard renders
- TaskCreationForm editor → dynamic import, not in initial shell
- WalletConnect modal → lazy loaded on button click