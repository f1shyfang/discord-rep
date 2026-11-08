import { env } from "~/env";
import { createR2Client, R2Storage } from "~/server/storage/r2";

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Configure R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in Doppler to use file storage",
    );
    this.name = "StorageNotConfiguredError";
  }
}

let storage: R2Storage | undefined;

export function getR2Storage() {
  if (storage) return storage;
  const {
    R2_ACCOUNT_ID,
    R2_BUCKET_NAME,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
  } = env;
  if (
    !R2_ACCOUNT_ID ||
    !R2_BUCKET_NAME ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY
  ) {
    throw new StorageNotConfiguredError();
  }
  storage = new R2Storage(
    createR2Client({
      accountId: R2_ACCOUNT_ID,
      bucket: R2_BUCKET_NAME,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    }),
    R2_BUCKET_NAME,
  );
  return storage;
}
