import { getAuth } from "@clerk/nextjs/server";
import { initTRPC, TRPCError } from "@trpc/server";
import { type CreateNextContextOptions } from "@trpc/server/adapters/next";
import superjson from "superjson";
import { flattenError, ZodError } from "zod";
import { db } from "~/server/db";

export const createTRPCContext = ({
  req,
}: CreateNextContextOptions): {
  userId: string | null;
  sessionId?: string | null;
  requestId?: string;
  db: typeof db;
} => {
  const auth = getAuth(req);
  return {
    userId: auth.userId,
    sessionId: auth.sessionId,
    requestId: crypto.randomUUID(),
    db,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error, ctx }) {
    return {
      ...shape,
      message:
        error.code === "INTERNAL_SERVER_ERROR"
          ? "Could not complete this request. Please try again."
          : shape.message,
      data: {
        ...shape.data,
        stack: undefined,
        appCode: error.code,
        requestId: ctx?.requestId,
        zodError:
          error.cause instanceof ZodError ? flattenError(error.cause) : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
