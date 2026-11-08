import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getR2Storage, StorageNotConfiguredError } from "~/server/storage";
import { StorageOwnershipError } from "~/server/storage/r2";

const storageProcedure = protectedProcedure.use(async ({ next }) => {
  try {
    return await next({ ctx: { storage: getR2Storage() } });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: error.message,
      });
    }
    throw error;
  }
});

const objectInput = z.object({ key: z.string().min(1).max(1024) });

async function withOwnership<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof StorageOwnershipError)
      throw new TRPCError({ code: "FORBIDDEN" });
    throw error;
  }
}

export const storageRouter = createTRPCRouter({
  createUploadUrl: storageProcedure
    .input(
      z.object({
        fileName: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine((name) => name !== "." && name !== "..", "Invalid file name"),
        contentType: z
          .string()
          .max(128)
          .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.storage.createUploadUrl(
        ctx.userId,
        input.fileName,
        input.contentType,
      ),
    ),
  createDownloadUrl: storageProcedure
    .input(objectInput)
    .mutation(({ ctx, input }) =>
      withOwnership(() => ctx.storage.createDownloadUrl(ctx.userId, input.key)),
    ),
  deleteObject: storageProcedure
    .input(objectInput)
    .mutation(({ ctx, input }) =>
      withOwnership(() => ctx.storage.deleteObject(ctx.userId, input.key)),
    ),
});
