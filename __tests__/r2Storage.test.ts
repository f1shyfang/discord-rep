import { describe, expect, it, vi } from "vitest";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  createR2Client,
  R2Storage,
  StorageOwnershipError,
  STORAGE_URL_TTL_SECONDS,
} from "~/server/storage/r2";

const config = {
  accountId: "a".repeat(32),
  bucket: "test-private-bucket",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-that-must-not-appear-in-urls",
};

function createStorage() {
  const client = createR2Client(config);
  return { client, storage: new R2Storage(client, config.bucket) };
}

describe("R2 private storage", () => {
  it("signs unique, user-scoped uploads with a required content type", async () => {
    const { storage } = createStorage();
    const first = await storage.createUploadUrl(
      "user_123",
      "../My photo.png",
      "image/png",
    );
    const second = await storage.createUploadUrl(
      "user_123",
      "../My photo.png",
      "image/png",
    );
    const url = new URL(first.url);
    expect(first.key).toMatch(
      /^users\/user_123\/[a-f0-9-]{36}\/.._My_photo.png$/,
    );
    expect(first.key).not.toEqual(second.key);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toContain(
      `${config.accountId}.r2.cloudflarestorage.com`,
    );
    expect(url.pathname).toContain(first.key);
    expect(url.searchParams.get("X-Amz-Expires")).toBe(
      String(STORAGE_URL_TTL_SECONDS),
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-type",
    );
    expect(url.searchParams.get("X-Amz-Credential")).toContain(
      "/auto/s3/aws4_request",
    );
    expect(first.headers).toEqual({ "Content-Type": "image/png" });
    expect(first.url).not.toContain(config.secretAccessKey);
  });

  it("signs private downloads as attachments", async () => {
    const { storage } = createStorage();
    const result = await storage.createDownloadUrl(
      "user_123",
      "users/user_123/object/file.html",
    );
    const url = new URL(result.url);
    expect(url.searchParams.get("response-content-disposition")).toBe(
      "attachment",
    );
    expect(url.searchParams.get("response-content-type")).toBe(
      "application/octet-stream",
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it.each([
    "users/user_other/object/file.txt",
    "users/user_123_extra/object/file.txt",
    "users/user_123/../user_other/file.txt",
    "users/user_123/object/../../file.txt",
    "users/user_123/object\\file.txt",
    "users/user_123//file.txt",
  ])(
    "rejects foreign or unsafe keys for reads and deletes: %s",
    async (key) => {
      const { client, storage } = createStorage();
      const send = vi.spyOn(client, "send");
      await expect(
        storage.createDownloadUrl("user_123", key),
      ).rejects.toBeInstanceOf(StorageOwnershipError);
      await expect(
        storage.deleteObject("user_123", key),
      ).rejects.toBeInstanceOf(StorageOwnershipError);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("deletes only from the configured bucket with an owned key", async () => {
    const { client, storage } = createStorage();
    const send = vi.spyOn(client, "send").mockResolvedValue({} as never);
    await expect(
      storage.deleteObject("user_123", "users/user_123/object/file.txt"),
    ).resolves.toEqual({ deleted: true });
    const command = send.mock.calls[0]?.[0] as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({
      Bucket: config.bucket,
      Key: "users/user_123/object/file.txt",
    });
  });

  it.each(["", ".", ".."])(
    "rejects unusable filenames: %s",
    async (fileName) => {
      const { storage } = createStorage();
      await expect(
        storage.createUploadUrl(
          "user_123",
          fileName,
          "application/octet-stream",
        ),
      ).rejects.toThrow("Invalid file name");
    },
  );
});
