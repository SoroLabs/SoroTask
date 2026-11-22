import path from "node:path";
import { auth } from "../[...nextauth]/route";
import { KeeperIdentityService } from "@/src/lib/auth/KeeperIdentityService";
import { FileIdentityStore } from "@/src/lib/auth/identity-store";
import { isSocialProvider } from "@/src/lib/auth/keeper-identities";
import { IdentityManager } from "@/src/lib/auth/IdentityManager";
import { IdentityError, type IdentitySession } from "@/src/lib/auth/social-provider-verification";
import { readIdentityRequest } from "@/src/lib/auth/identity-request";

export const runtime = "nodejs";

function service(): KeeperIdentityService {
  const raw = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (!raw) throw new IdentityError("identity_not_configured", 503);
  let url;
  try { url = new URL(raw); } catch { throw new IdentityError("identity_not_configured", 503); }
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && process.env.NODE_ENV !== "production" && url.hostname === "localhost")) || url.username || url.password) {
    throw new IdentityError("identity_not_configured", 503);
  }
  return new KeeperIdentityService({
    origin: url.origin,
    store: new FileIdentityStore(process.env.KEEPER_IDENTITY_STATE_DIR ?? path.join(process.cwd(), ".keeper-identities")),
    neynarApiKey: process.env.NEYNAR_API_KEY,
  });
}

async function session(): Promise<IdentitySession> {
  const current = await auth();
  const user = current?.user;
  if (!user?.id) throw new IdentityError("sign_in_required", 401);
  return { subject: `${user.provider ?? "session"}:${user.providerAccountId ?? user.id}`, github: user.keeperGithub };
}

const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
function failure(error: unknown): Response {
  const known = error instanceof IdentityError;
  return response({ error: { code: known ? error.code : "identity_unavailable" } }, known ? error.status : 503);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const caller = await session();
    const identities = service();
    const addresses = new URL(request.url).searchParams.getAll("address");
    return response({
      identities: await new IdentityManager().getKeeperIdentities(addresses, identities),
      github: caller.github ?? null,
      providers: { github: Boolean((process.env.AUTH_GITHUB_ID ?? process.env.GITHUB_CLIENT_ID)
        && (process.env.AUTH_GITHUB_SECRET ?? process.env.GITHUB_CLIENT_SECRET)), farcaster: Boolean(process.env.NEYNAR_API_KEY), lens: true },
    });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const identities = service();
    const caller = await session();
    // Use configured canonical origin, never a forwarded/Host header.
    const configured = new URL(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").origin;
    if (request.headers.get("origin") !== configured) throw new IdentityError("origin_mismatch", 403);
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new IdentityError("invalid_request");
    const body = await readIdentityRequest(request);
    if (body.operation === "challenge") {
      if (!isSocialProvider(body.provider) || typeof body.walletAddress !== "string"
        || typeof body.identifier !== "string" || body.identifier.length > 100
        || (body.action !== "link" && body.action !== "unlink")) throw new IdentityError("invalid_request");
      return response({ challenge: await identities.challenge({ provider: body.provider, identifier: body.identifier, walletAddress: body.walletAddress, action: body.action }, caller) });
    }
    if (body.operation === "complete") {
      if (typeof body.nonce !== "string" || typeof body.walletSignature !== "string" || body.walletSignature.length > 100
        || (body.ownerSignature !== undefined && (typeof body.ownerSignature !== "string" || body.ownerSignature.length > 132))) throw new IdentityError("invalid_request");
      return response({ identity: await identities.complete({ nonce: body.nonce, walletSignature: body.walletSignature, ownerSignature: body.ownerSignature as string | undefined }, caller) });
    }
    throw new IdentityError("invalid_request");
  } catch (error) { return failure(error); }
}
