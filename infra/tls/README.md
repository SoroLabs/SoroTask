# TLS certificate rotation (BE-PROD-37, #1461)

Status: **scaffold only**. The config files in this directory are not deployed or
tested against a real domain. The rest of the work needs external accounts and
must be done by the team operating the deployment.

## What is in this directory

- `traefik.yml`: Traefik static config. Uses a Let's Encrypt resolver with the
  ACME DNS-01 challenge through Cloudflare, so renewal does not need port 80 and
  wildcard names work.
- `dynamic.yml`: TLS options file (TLS 1.2 minimum, AEAD cipher suites only).
  Traefik reloads it through the file provider.

## How renewal works

- Traefik's ACME client renews a certificate before it expires. Its default
  renewal window is 30 days before expiry, which matches the issue.
- Renewed files are written to `/letsencrypt/acme.json` and picked up by the
  running Traefik process. No restart is needed.
- Reloading does not drop WebSocket connections that are already open: those
  connections keep the certificate negotiated when they started. New connections
  get the new certificate.

## Needed outside this repo

1. A domain whose DNS is hosted on Cloudflare.
2. A Cloudflare API token with `Zone:DNS:Edit` on that zone. Put it in
   `CF_DNS_API_TOKEN`. Do not commit it.
3. A contact address in `ACME_EMAIL`.
4. Test against the Let's Encrypt staging CA first (see the commented
   `caServer` line), then switch to production.

## Not covered by this scaffold

- The Dockerfile and `.github/workflows/keeper.yml` changes named in the issue.
  Neither the Dockerfile nor a workflow file was changed here.
- The SSL Labs A+ acceptance check. It needs a live deployment, and the grade
  depends on the rest of the server configuration as well as these options.
- Verification of zero-downtime reload with active WebSocket clients. This needs
  a staging test with real connections.
