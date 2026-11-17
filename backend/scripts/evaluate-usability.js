const fs = require("node:fs");
function evaluate(responses) {
  if (!Array.isArray(responses))
    throw new Error("Expected an array of participant records");
  const seen = new Set();
  const participants = responses.map((row) => {
    if (
      typeof row.participant_id !== "string" ||
      !row.participant_id.trim() ||
      seen.has(row.participant_id)
    )
      throw new Error("Use unique anonymous participant IDs");
    seen.add(row.participant_id);
    if (!["TOURIST", "AGENT", "DRIVER", "ADMIN"].includes(row.role))
      throw new Error("Record the participant role");
    const values = Array.from({ length: 10 }, (_, i) => row[`q${i + 1}`]);
    if (values.some((v) => !Number.isInteger(v) || v < 1 || v > 5))
      throw new Error("Complete all ten SUS ratings with integers from 1 to 5");
    return {
      participant_id: row.participant_id,
      role: row.role,
      score:
        values.reduce((sum, v, i) => sum + (i % 2 === 0 ? v - 1 : 5 - v), 0) *
        2.5,
    };
  });
  const average = participants.length
    ? participants.reduce((sum, p) => sum + p.score, 0) / participants.length
    : null;
  return {
    participants: participants.length,
    average_sus: average,
    sample_target_met: participants.length >= 10,
    sus_target_met: average !== null && average >= 68,
    accepted: participants.length >= 10 && average >= 68,
    status:
      participants.length < 10
        ? "MORE_PARTICIPANTS_REQUIRED"
        : average >= 68
          ? "TARGET_MET"
          : "IMPROVEMENT_REQUIRED",
    scores: participants,
  };
}
if (require.main === module) {
  try {
    if (!process.argv[2])
      throw new Error(
        "Usage: node scripts/evaluate-usability.js responses.json",
      );
    console.log(
      JSON.stringify(
        evaluate(JSON.parse(fs.readFileSync(process.argv[2], "utf8"))),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { evaluate };
