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
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
      }
      if (account) {
        token.provider = account.provider;
        token.providerAccountId = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.provider = token.provider as string;
        session.user.providerAccountId = token.providerAccountId as string;
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
