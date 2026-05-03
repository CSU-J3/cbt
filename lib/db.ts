import { createClient, type Client } from "@libsql/client";

export function getDb(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({ url, authToken });
}
