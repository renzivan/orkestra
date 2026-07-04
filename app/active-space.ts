import { cookies } from "next/headers";
import type { Database } from "bun:sqlite";
import { getSpace, defaultSpace } from "@/lib/repos/spaces";

// The active Space is a pure view scope, so it lives in a cookie rather than the
// DB: switching never writes shared state and the engine never consults it (a
// run started in one Space keeps going while another is viewed). All reads scope
// to whatever this resolves to.
const COOKIE = "orkestra_space";

/**
 * Resolve the active Space id from the cookie, falling back to the earliest
 * Space when the cookie is absent, unparseable, or points at a deleted Space.
 * Always returns a valid id — a Space always exists (deleteSpace refuses to
 * remove the last). Reading outside a request (e.g. tests) can't see cookies, so
 * it falls back too.
 */
export async function getActiveSpaceId(db: Database): Promise<number> {
  let raw: string | undefined;
  try {
    raw = (await cookies()).get(COOKIE)?.value;
  } catch {
    // Called outside a request — no cookie store; use the default Space.
  }
  const id = raw ? Number(raw) : NaN;
  if (Number.isInteger(id) && getSpace(db, id)) return id;
  return defaultSpace(db).id;
}

/** Point the active-Space cookie at `id`. No-op outside a request. */
export async function setActiveSpaceCookie(id: number): Promise<void> {
  try {
    (await cookies()).set(COOKIE, String(id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  } catch {
    // Called outside a request — nothing to set.
  }
}
