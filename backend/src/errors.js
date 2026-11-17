class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function requireThat(ok, status, code, message) {
  if (!ok) throw new AppError(status, code, message);
}
module.exports = { AppError, requireThat };
