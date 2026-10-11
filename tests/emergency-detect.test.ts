import { describe, expect, it } from "vitest";
import { detectEmergency } from "../src/lib/emergency/detect";

describe("deterministic emergency detection", () => {
  it.each(["SOS", "sos", " Sos ", "SOS!", "S.O.S", "sos sos", "SOS!!!"])("treats %j as SOS", (msg) => {
    const d = detectEmergency(msg);
    expect(d.level).toBe("emergency");
    expect(d.level === "emergency" && d.rule).toBe("SOS");
  });

  it.each([
    ["help me urgently", "general_emergency"],
    ["I have fallen", "medical_emergency"],
    ["I've fallen in the bathroom", "medical_emergency"],
    ["I cannot breathe", "medical_emergency"],
    ["i can't breathe properly", "medical_emergency"],
    ["I need emergency help", "general_emergency"],
    ["having chest pain", "medical_emergency"],
    ["please call an ambulance", "medical_emergency"],
    ["I fell and can't get up", "medical_emergency"],
  ])("treats %j as a clear emergency phrase", (msg, category) => {
    const d = detectEmergency(msg);
    expect(d.level).toBe("emergency");
    if (d.level === "emergency") {
      expect(d.rule).toBe("PHRASE");
      expect(d.category).toBe(category);
    }
  });

  it.each(["I feel dizzy", "I slipped this morning", "this is urgent", "I am scared", "severe pain in my knee"])(
    "flags %j as a possible emergency (never routine)",
    (msg) => expect(detectEmergency(msg).level).toBe("possible"),
  );

  it.each([
    "I need an electrician to come and check the fan in my bedroom.",
    "Can you help me pay the electricity bill?",
    "Please remind me about my doctor appointment",
    "Sosa from next door brought sweets", // contains "sos" but is not SOS
    "",
  ])("does not flag %j", (msg) => expect(detectEmergency(msg).level).toBe("none"));
});
