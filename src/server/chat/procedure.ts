import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "~/server/api/trpc";
import { withChatDb } from "~/server/chat-db";
import { assertIdentity } from "./identity";
import { actorFor, rateLimit } from "./core";

type AttemptLimit = { scope: string; limit: number; seconds: number };
function identityWithLimit(attemptLimit?: AttemptLimit) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    try {
      if (attemptLimit) {
        // Commit the attempt separately: a rejected invite or unknown handle
        // must still consume quota when the business transaction rolls back.
        await withChatDb((database) =>
          database.transaction(async (tx) => {
            await assertIdentity(tx, ctx.userId, ctx.sessionId);
            await rateLimit(
              tx,
              `${attemptLimit.scope}:${ctx.userId}`,
              attemptLimit.limit,
              attemptLimit.seconds,
            );
          }),
        );
      }
      return await withChatDb((database) =>
        database.transaction(async (tx) => {
          await assertIdentity(tx, ctx.userId, ctx.sessionId);
          const result = await next({ ctx: { ...ctx, tx } });
          // tRPC represents resolver failures as results. Throw to roll back.
          if (!result.ok) throw result.error;
          return result;
        }),
      );
    } catch (error) {
      if (error instanceof TRPCError && error.code !== "INTERNAL_SERVER_ERROR")
        throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not complete this request. Please try again.",
      });
    }
  });
}
function withProfile(procedure: ReturnType<typeof identityWithLimit>) {
  return procedure.use(async ({ ctx, next }) => {
    const actor = await actorFor(ctx.tx, ctx.userId);
    return next({ ctx: { ...ctx, actor } });
  });
}
export const identityProcedure = identityWithLimit();
export const chatProcedure = withProfile(identityProcedure);
export const attemptLimitedChatProcedure = (
  scope: string,
  limit: number,
  seconds: number,
) => withProfile(identityWithLimit({ scope, limit, seconds }));
