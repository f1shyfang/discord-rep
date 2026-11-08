import { beforeEach, describe, expect, it, vi } from "vitest";
import { type db } from "~/server/db";
import { storageRouter } from "~/server/api/routers/storage";
import { getR2Storage, StorageNotConfiguredError } from "~/server/storage";
import { createR2Client, R2Storage } from "~/server/storage/r2";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/env", () => ({ env: {} }));
vi.mock("~/server/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/storage")>()),
  getR2Storage: vi.fn(),
}));

const storage = new R2Storage(
  createR2Client({
    accountId: "a".repeat(32),
    bucket: "test-bucket",
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
  }),
  "test-bucket",
);
const context = { userId: "user_123", db: {} as typeof db };

describe("storageRouter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getR2Storage).mockReset().mockReturnValue(storage);
  });

  it("rejects anonymous upload, download, and delete requests before configuring storage", async () => {
    const caller = storageRouter.createCaller({ ...context, userId: null });
    await expect(
      caller.createUploadUrl({
        fileName: "file.txt",
        contentType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.createDownloadUrl({ key: "users/user_123/file.txt" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.deleteObject({ key: "users/user_123/file.txt" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(getR2Storage).not.toHaveBeenCalled();
  });

  it("uses the verified Clerk identity instead of a client-supplied user ID", async () => {
    const upload = vi.spyOn(storage, "createUploadUrl").mockResolvedValue({
      key: "key",
      url: "https://example.com",
      headers: { "Content-Type": "text/plain" },
      expiresIn: 300,
    });
    const caller = storageRouter.createCaller(context);
    await caller.createUploadUrl({
      fileName: "file.txt",
      contentType: "text/plain",
      userId: "user_other",
    } as { fileName: string; contentType: string });
    expect(upload).toHaveBeenCalledWith("user_123", "file.txt", "text/plain");
  });

  it("reports missing R2 configuration without requiring it for public app features", async () => {
    vi.mocked(getR2Storage).mockImplementation(() => {
      throw new StorageNotConfiguredError();
    });
    await expect(
      storageRouter
        .createCaller(context)
        .createUploadUrl({ fileName: "file.txt", contentType: "text/plain" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("maps ownership violations to forbidden responses", async () => {
    const caller = storageRouter.createCaller(context);
    await expect(
      caller.createDownloadUrl({ key: "users/user_other/file.txt" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.deleteObject({ key: "users/user_other/file.txt" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each([
    { fileName: "", contentType: "text/plain" },
    { fileName: "..", contentType: "text/plain" },
    { fileName: "file.txt", contentType: "text/plain\r\nX-Other: injected" },
  ])("validates upload metadata", async (input) => {
    await expect(
      storageRouter.createCaller(context).createUploadUrl(input),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
