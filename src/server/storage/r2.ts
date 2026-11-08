import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const STORAGE_URL_TTL_SECONDS = 300;

export class StorageOwnershipError extends Error {
  constructor() {
    super("You do not own this object");
    this.name = "StorageOwnershipError";
  }
}

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createR2Client(config: R2Config) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function userPrefix(userId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId))
    throw new Error("Invalid storage user ID");
  return `users/${userId}/`;
}

function assertOwnedKey(userId: string, key: string) {
  if (
    !key.startsWith(userPrefix(userId)) ||
    key.includes("\\") ||
    key
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new StorageOwnershipError();
  }
}

export class R2Storage {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}

  async createUploadUrl(userId: string, fileName: string, contentType: string) {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!safeName || safeName === "." || safeName === "..")
      throw new Error("Invalid file name");
    const key = `${userPrefix(userId)}${randomUUID()}/${safeName}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: STORAGE_URL_TTL_SECONDS,
      signableHeaders: new Set(["content-type"]),
    });
    return {
      key,
      url,
      headers: { "Content-Type": contentType },
      expiresIn: STORAGE_URL_TTL_SECONDS,
    };
  }

  async createDownloadUrl(userId: string, key: string) {
    assertOwnedKey(userId, key);
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: "attachment",
        ResponseContentType: "application/octet-stream",
      }),
      { expiresIn: STORAGE_URL_TTL_SECONDS },
    );
    return { url, expiresIn: STORAGE_URL_TTL_SECONDS };
  }

  async deleteObject(userId: string, key: string) {
    assertOwnedKey(userId, key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return { deleted: true };
  }
}
