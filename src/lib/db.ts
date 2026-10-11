import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./config";

let _c: SupabaseClient | null = null;
/** Server-only client using the secret key. Never import this from a client component. */
export function db(): SupabaseClient {
  if (!_c) _c = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
  return _c;
}
export function must<T>(r: { data: T | null; error: any }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}
