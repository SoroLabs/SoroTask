/** @jest-environment node */
import NextAuth from "next-auth";
import "./route";

jest.mock("next-auth", () => ({ __esModule: true, default: jest.fn(() => ({ handlers: { GET: jest.fn(), POST: jest.fn() }, auth: jest.fn(), signIn: jest.fn(), signOut: jest.fn() })) }));
jest.mock("next-auth/providers/github", () => ({ __esModule: true, default: jest.fn(() => ({ id: "github" })) }));
jest.mock("next-auth/providers/google", () => ({ __esModule: true, default: jest.fn(() => ({ id: "google" })) }));

type Token = { id?: string; provider?: string; providerAccountId?: string; keeperGithub?: { id: string; username: string } };
type CallbackConfig = { callbacks: {
  jwt(input: { token: Token; user?: { id: string }; account?: { provider: string; providerAccountId: string }; profile?: { id?: unknown; login?: unknown } }): Promise<Token>;
  session(input: { session: { user: Token }; token: Token }): Promise<{ user: Token }>;
} };
const config = (NextAuth as unknown as jest.Mock).mock.calls[0][0] as CallbackConfig;

describe("trusted GitHub OAuth provenance", () => {
  test("actual GitHub OAuth callback establishes the exact provider account", async () => {
    const token = await config.callbacks.jwt({ token: {}, user: { id: "123" }, account: { provider: "github", providerAccountId: "123" }, profile: { id: 123, login: "synthetic-keeper" } });
    expect(token.keeperGithub).toEqual({ id: "123", username: "synthetic-keeper" });
    const session = await config.callbacks.session({ session: { user: {} }, token });
    expect(session.user.keeperGithub).toEqual(token.keeperGithub);
    expect(Object.keys(token)).not.toContain("access_token");
  });

  test.each(["email", "google"])("%s and client-supplied GitHub profile cannot create a trusted identity", async (provider) => {
    const token = await config.callbacks.jwt({ token: {}, user: { id: "1" }, account: { provider, providerAccountId: "123" }, profile: { id: 123, login: "synthetic-keeper" } });
    expect(token.keeperGithub).toBeUndefined();
  });

  test.each([{ id: 456, login: "synthetic-keeper" }, { id: 123, login: "https://unexpected.example" }, { login: "synthetic-keeper" }])("mismatched or malformed GitHub profile fails closed", async (profile) => {
    const token = await config.callbacks.jwt({ token: {}, account: { provider: "github", providerAccountId: "123" }, profile });
    expect(token.keeperGithub).toBeUndefined();
  });

  test("session refresh retains trusted proof and switching provider clears it", async () => {
    const existing: Token = { keeperGithub: { id: "123", username: "synthetic-keeper" } };
    expect((await config.callbacks.jwt({ token: existing })).keeperGithub).toEqual(existing.keeperGithub);
    expect((await config.callbacks.jwt({ token: existing, account: { provider: "email", providerAccountId: "1" } })).keeperGithub).toBeUndefined();
  });
});
