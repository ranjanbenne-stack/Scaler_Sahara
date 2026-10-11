import { describe, expect, it } from "vitest";
import { offersForRequest } from "../src/lib/booking/catalog";

const base = {
  category: "home_maintenance",
  serviceType: "electrician",
  issueSummary: "Bedroom fan needs inspection",
  originalMessage: "I need an electrician to check my bedroom fan",
  isEmergency: false,
  status: "RECEIVED",
};

describe("handyman visit offers", () => {
  it("puts the electrician first for a fan repair and still offers other trades", () => {
    const offers = offersForRequest(base);
    expect(offers[0]?.code).toBe("electrician");
    expect(offers.map((offer) => offer.code)).toEqual(expect.arrayContaining(["plumber", "carpenter", "handyman"]));
    expect(offers[0]?.estimatedCostInr).toBe(850);
  });

  it("does not offer a visit for an emergency or a bill", () => {
    expect(offersForRequest({ ...base, isEmergency: true, status: "ESCALATED" })).toEqual([]);
    expect(offersForRequest({ ...base, category: "utility_payment", serviceType: null, issueSummary: "Pay the electricity bill", originalMessage: "please pay the bill" })).toEqual([]);
  });

  it("does not turn a grocery request into a handyman visit", () => {
    expect(offersForRequest({
      ...base,
      category: "household_assistance",
      serviceType: null,
      issueSummary: "Request to order vegetables",
      originalMessage: "please order vegetables",
    })).toEqual([]);
  });

  it("matches a plumber from the message even when the category is unclassified", () => {
    const offers = offersForRequest({
      ...base,
      category: "unclassified",
      serviceType: null,
      issueSummary: "Kitchen tap is leaking",
      originalMessage: "the kitchen tap is leaking",
    });
    expect(offers.map((offer) => offer.code)).toContain("plumber");
  });
});
