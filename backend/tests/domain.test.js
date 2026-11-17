const { transition, matches } = require("../src/domain");
test("all lifecycle pairs enforce the explicit state machine", () => {
  const allowed = {
    REQUESTED: ["QUOTED", "CANCELLED"],
    QUOTED: ["QUOTED", "ACCEPTED", "CANCELLED"],
    ACCEPTED: ["OPEN", "CANCELLED"],
    OPEN: ["ASSIGNED", "CANCELLED"],
    ASSIGNED: ["OPEN", "IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: [],
  };
  for (const [from, next] of Object.entries(allowed))
    for (const to of Object.keys(allowed)) {
      if (next.includes(to))
        expect(() => transition({ status: from }, to)).not.toThrow();
      else expect(() => transition({ status: from }, to)).toThrow();
    }
});
test("van category accepts KDH without broadening car or KDH requests", () => {
  expect(matches("VAN", "KDH")).toBe(true);
  expect(matches("VAN", "VAN")).toBe(true);
  expect(matches("CAR", "KDH")).toBe(false);
  expect(matches("KDH", "VAN")).toBe(false);
});
