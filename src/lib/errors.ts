export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "INVALID_REQUEST",
    public retryAfter = 5,
  ) {
    super(message);
    this.name = "AppError";
  }
}
