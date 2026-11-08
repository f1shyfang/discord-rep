import { describe, expect, it, vi } from "vitest";
import { getR2Storage, StorageNotConfiguredError } from "~/server/storage";

vi.mock("~/env", () => ({ env: {} }));

describe("optional R2 configuration", () => {
  it("fails only when storage is requested, with the required setup variables", () => {
    expect(() => getR2Storage()).toThrow(StorageNotConfiguredError);
    expect(() => getR2Storage()).toThrow(
      "R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY",
    );
  });
});
