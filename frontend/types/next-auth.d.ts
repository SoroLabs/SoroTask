import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      provider?: string;
      providerAccountId?: string;
      keeperGithub?: { id: string; username: string };
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    provider?: string;
    providerAccountId?: string;
    keeperGithub?: { id: string; username: string };
  }
}
