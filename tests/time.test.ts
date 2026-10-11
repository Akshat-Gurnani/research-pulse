import { describe, it, expect } from "vitest";
import { weekKey, announceSlot, briefWindow, inWindow, zonedToUtc, ET } from "@/lib/time";

describe("weekKey (IST)", () => {
  it("Mon 12 Oct 2026 05:30 IST is W42", () => expect(weekKey(new Date("2026-10-12T00:00:00Z"))).toBe("2026-W42"));
  it("Sun 11 Oct 2026 23:00 IST is still W41", () => expect(weekKey(new Date("2026-10-11T17:30:00Z"))).toBe("2026-W41"));
  it("handles the 53-week year boundary", () => {
    expect(weekKey(new Date("2026-12-31T06:00:00Z"))).toBe("2026-W53");
    expect(weekKey(new Date("2027-01-03T06:00:00Z"))).toBe("2026-W53");
    expect(weekKey(new Date("2027-01-04T06:00:00Z"))).toBe("2027-W01");
  });
});

describe("announceSlot", () => {
  const slot = (iso: string) => announceSlot(new Date(iso)).toISOString();
  it("Thu 13:00 ET submission -> Thu 20:00 ET (Fri 00:00Z in EDT)", () => expect(slot("2026-10-08T17:00:00Z")).toBe("2026-10-09T00:00:00.000Z"));
  it("Thu 15:00 ET submission -> Sunday 20:00 ET", () => expect(slot("2026-10-08T19:00:00Z")).toBe("2026-10-12T00:00:00.000Z"));
  it("Fri 13:00 ET submission -> Sunday 20:00 ET", () => expect(slot("2026-10-09T17:00:00Z")).toBe("2026-10-12T00:00:00.000Z"));
  it("Fri 15:00 ET -> Monday 20:00 ET (Tue 00:00Z)", () => expect(slot("2026-10-09T19:00:00Z")).toBe("2026-10-13T00:00:00.000Z"));
  it("Saturday submission -> Monday 20:00 ET", () => expect(slot("2026-10-10T12:00:00Z")).toBe("2026-10-13T00:00:00.000Z"));
  it("Sunday submission -> Monday 20:00 ET", () => expect(slot("2026-10-11T12:00:00Z")).toBe("2026-10-13T00:00:00.000Z"));
  it("moves to 01:00Z after the November DST change", () => expect(slot("2026-11-05T17:00:00Z")).toBe("2026-11-06T01:00:00.000Z"));
});

describe("briefWindow", () => {
  const w = briefWindow(new Date("2026-10-12T00:20:00Z")); // Monday 05:50 IST
  it("is keyed W42", () => expect(w.weekKey).toBe("2026-W42"));
  it("ends at the Sunday 20:00 ET batch (Mon 00:00Z)", () => expect(w.endSlot.toISOString()).toBe("2026-10-12T00:00:00.000Z"));
  it("starts one week earlier (exclusive)", () => expect(w.startSlot.toISOString()).toBe("2026-10-05T00:00:00.000Z"));
  it("contains five batches", () => {
    const slots = ["2026-10-06T00:00:00Z","2026-10-07T00:00:00Z","2026-10-08T00:00:00Z","2026-10-09T00:00:00Z","2026-10-12T00:00:00Z"];
    expect(slots.every((s) => inWindow(new Date(s), w))).toBe(true);
    expect(inWindow(new Date("2026-10-05T00:00:00Z"), w)).toBe(false);
    expect(inWindow(new Date("2026-10-13T00:00:00Z"), w)).toBe(false);
  });
  it("same window from a Tuesday catch-up", () => expect(briefWindow(new Date("2026-10-13T02:30:00Z")).endSlot.toISOString()).toBe("2026-10-12T00:00:00.000Z"));
  it("zonedToUtc round-trips ET", () => expect(zonedToUtc(2026, 10, 11, 20, 0, ET).toISOString()).toBe("2026-10-12T00:00:00.000Z"));
});

describe("briefWindow label", () => {
  it("W42 starts at the first announcement inside the window (Tue 6 Oct 00:00Z), not the exclusive start slot", () => {
    const w = briefWindow(new Date("2026-10-12T00:20:00Z"));
    expect(w.label).toBe("Papers announced 6 Oct to 12 Oct 2026");
  });
  it("is correct across the US daylight-saving change (window ending Sun 1 Nov 20:00 EST)", () => {
    const w = briefWindow(new Date("2026-11-02T03:00:00Z"));
    expect(w.endSlot.toISOString()).toBe("2026-11-02T01:00:00.000Z");
    expect(w.label).toBe("Papers announced 27 Oct to 2 Nov 2026");
  });
});
