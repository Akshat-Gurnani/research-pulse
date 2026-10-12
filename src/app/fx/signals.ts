// Tiny pub/sub so the page can tell the background what it is showing, without re-rendering React.
import type { Verdict } from "@/lib/motion";

export interface FxState { counts: Record<Verdict, number>; focus: Verdict | null }
let state: FxState = { counts: { flag: 0, read: 0, skim: 0 }, focus: null };
const subs = new Set<() => void>();

export const getFx = () => state;
export function setFx(patch: Partial<FxState>) { state = { ...state, ...patch }; subs.forEach((f) => f()); }
export function subscribeFx(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
