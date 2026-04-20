import { AppError, toAppError } from "../../src/errors/appError";

describe("AppError utilities", () => {
  it("returns AppError instances unchanged", () => {
    const original = new AppError("known", "KNOWN_CODE");
    const converted = toAppError(original);

    expect(converted).toBe(original);
  });

  it("converts Error instances into INTERNAL_ERROR AppError", () => {
    const converted = toAppError(new Error("boom"));

    expect(converted).toBeInstanceOf(AppError);
    expect(converted.code).toBe("INTERNAL_ERROR");
    expect(converted.message).toBe("boom");
  });

  it("converts unknown values using fallback message and cause details", () => {
    const converted = toAppError(42, "fallback message");

    expect(converted.code).toBe("INTERNAL_ERROR");
    expect(converted.message).toBe("fallback message");
    expect(converted.details).toEqual({ cause: "42" });
  });
});
