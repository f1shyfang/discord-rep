import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { identityProcedure } from "~/server/chat/procedure";
import { userJobHelper } from "~/libs/buildHelpers";
import { posts } from "~/server/db/schema";

export const postRouter = createTRPCRouter({
  hello: publicProcedure
    .input(z.object({ text: z.string() }))
    .query(({ input }) => ({ greeting: `Hello ${input.text}` })),
  create: identityProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [post] = await ctx.db
        .insert(posts)
        .values({ name: input.name, createdById: ctx.userId })
        .returning();
      return post;
    }),
  getLatest: identityProcedure.query(async ({ ctx }) => {
    const [post] = await ctx.db
      .select()
      .from(posts)
      .where(eq(posts.createdById, ctx.userId))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(1);
    return post ?? null;
  }),
  getSecretMessage: identityProcedure.query(
    () => "you can now see this secret message!",
  ),
  createJob: identityProcedure.mutation(({ ctx }) =>
    userJobHelper.insertJob(ctx.userId),
  ),
  getJobs: identityProcedure.query(({ ctx }) =>
    userJobHelper.getJobs(ctx.userId),
  ),
});
