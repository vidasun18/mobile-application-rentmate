const { evaluate } = require("../scripts/evaluate-usability");
const participant = (id, values) => ({
  participant_id: id,
  role: "TOURIST",
  ...Object.fromEntries(values.map((v, i) => [`q${i + 1}`, v])),
});
test("SUS scoring uses the 0-100 scale without claiming acceptance for missing participants", () => {
  expect(evaluate([])).toMatchObject({
    average_sus: null,
    accepted: false,
    status: "MORE_PARTICIPANTS_REQUIRED",
  });
  expect(
    evaluate([participant("neutral", Array(10).fill(3))]).average_sus,
  ).toBe(50);
  const best = Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? 5 : 1));
  expect(evaluate([participant("one", best)])).toMatchObject({
    average_sus: 100,
    accepted: false,
  });
  expect(
    evaluate(
      Array.from({ length: 10 }, (_, i) =>
        participant(`synthetic-unit-test-${i}`, best),
      ),
    ),
  ).toMatchObject({ average_sus: 100, accepted: true });
  expect(() => evaluate([participant("bad", Array(10).fill(6))])).toThrow();
});
