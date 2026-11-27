import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";

const config: NextAuthConfig = {
  providers: [
    // Email provider (requires credentials provider for email/password)
    {
      id: "email",
      name: "Email",
      type: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // TODO: Implement actual authentication logic
        // This is a placeholder - replace with your backend API call
        if (credentials?.email && credentials?.password) {
          // Mock authentication - replace with real API call
          const user = {
            id: "1",
            email: credentials.email as string,
            name: "User",
          };
          return user;
        }
        return null;
      },
    },
    // GitHub provider
    GitHubProvider({
      clientId: (process.env.AUTH_GITHUB_ID ?? process.env.GITHUB_CLIENT_ID) || "",
      clientSecret: (process.env.AUTH_GITHUB_SECRET ?? process.env.GITHUB_CLIENT_SECRET) || "",
      authorization: {
        params: {
          scope: "read:user user:email",
        },
      },
    }),
    // Google provider
    GoogleProvider({
      clientId: (process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID) || "",
      clientSecret: (process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET) || "",
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (user) {
        token.id = user.id;
      }
      if (account) {
        token.provider = account.provider;
        token.providerAccountId = account.providerAccountId;
        // Only the actual GitHub OAuth callback can establish a GitHub identity.
        // Neither email auth nor a posted AuthResult/profile is sufficient.
        const github = profile as { login?: unknown; id?: unknown } | undefined;
        token.keeperGithub = account.provider === "github"
          && typeof github?.login === "string"
          && /^[a-zA-Z0-9_.-]{1,100}$/.test(github.login)
          && /^\d{1,20}$/.test(account.providerAccountId)
          && (typeof github.id === "number" || typeof github.id === "string")
          && String(github.id) === account.providerAccountId
          ? { id: account.providerAccountId, username: github.login }
          : undefined;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.provider = token.provider as string;
        session.user.providerAccountId = token.providerAccountId as string;
        const github = token.keeperGithub as { id?: unknown; username?: unknown } | undefined;
        session.user.keeperGithub = github && typeof github.id === "string" && /^\d{1,20}$/.test(github.id)
          && typeof github.username === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(github.username)
          ? { id: github.id, username: github.username } : undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);

export const { GET, POST } = handlers;
