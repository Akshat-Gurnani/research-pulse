import { describe, it, expect } from "vitest";
import { tidyClaim } from "@/lib/format";
import { cardWords, CARD_CHROME_WORDS } from "@/lib/validate";

describe("tidyClaim", () => {
  it("capitalises and terminates a lowercase fragment", () => expect(tidyClaim("the authors report that X wins")).toBe("The authors report that X wins."));
  it("leaves a finished sentence alone", () => expect(tidyClaim("The authors report 35%.")).toBe("The authors report 35%."));
  it("collapses whitespace and tolerates empty", () => { expect(tidyClaim("  a   b ")).toBe("A b."); expect(tidyClaim("   ")).toBe(""); });
});
describe("cardWords", () => {
  it("counts the text a reader also sees around the prose, so stated reading time is honest", () => {
    const c = { claims: [{ claim: "one two three" }], why_it_matters: "four five", caveat: "six" };
    expect(cardWords(c, "title words")).toBe(2 + 3 + 2 + 1 + CARD_CHROME_WORDS);
  });
});
