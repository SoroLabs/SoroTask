# Edge Deployments

The GitHub Actions workflow in `.github/workflows/deploy.yml` deploys the
frontend to Vercel after its unit tests and production build pass. Pull
requests from branches in this repository receive preview deployments; fork
pull requests run verification but do not deploy because GitHub does not expose
deployment secrets to them.

## Required GitHub secrets

Configure these repository secrets before enabling deployment:

- `VERCEL_TOKEN`: a Vercel token with access to this project.
- `VERCEL_ORG_ID`: the owning Vercel team or account ID.
- `VERCEL_PROJECT_ID`: the frontend Vercel project ID.
- `VERCEL_AUTOMATION_BYPASS_SECRET` (optional): set only if Vercel Deployment
  Protection is enabled for preview URLs. The Playwright canary sends it only
  to the deployment origin.

Set the Vercel project root directory to `frontend` and use Node.js 22. The
workflow uses the Vercel CLI to pull the matching preview or production
environment, build locally, and deploy the prebuilt output. Configure any
additional runtime environment variables in the corresponding Vercel
environment. Use a project-scoped token where possible, and disable duplicate
automatic Git deployments in Vercel if this workflow is the deployment
authority.

## Canary and rollback

After deployment, the workflow runs
`tests/e2e/deployment-smoke.spec.ts` against the deployment URL in Chromium. It
checks the task creation route and immutable static-asset cache header, then
completes the production wallet-connection flow against a mocked Freighter
extension. Failed production canaries automatically roll production back to
the prior Vercel rollback candidate, when one is available.

To roll back manually, open **Actions → Production & Preview Global Edge
Deployment Pipeline**, select the `main` branch, and choose **Run workflow**.
The workflow finds the previous production rollback candidate and routes
production traffic back to it without rebuilding. Vercel account plan and
deployment eligibility determine which rollback candidates are available.

## Edge latency

Vercel distributes immutable Next.js static assets through its global edge
network. Server-rendered pages and API routes still execute in the regions
configured for the Vercel project. A repository configuration cannot guarantee
sub-50ms TTFB for every user worldwide; verify that target with measurements
from representative regions and configure Vercel compute regions to match the
application's latency and data-consistency requirements.
