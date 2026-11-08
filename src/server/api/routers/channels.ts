import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter } from "~/server/api/trpc";
import { chatProcedure } from "~/server/chat/procedure";
import {
  channelAccess,
  fail,
  name,
  requirePermission,
  serverAccess,
  uuid,
} from "~/server/chat/core";
import { P } from "~/server/chat/permissions";
import * as s from "~/server/db/chat-schema";

const fields = {
  name,
  topic: z.string().max(1024).default(""),
  categoryId: uuid.nullable().default(null),
  position: z.number().int().min(0).max(100).default(0),
};
async function categoryCheck(
  tx: Parameters<typeof serverAccess>[0],
  serverId: string,
  categoryId: string | null,
) {
  if (!categoryId) return;
  const [category] = await tx
    .select()
    .from(s.categories)
    .where(
      and(eq(s.categories.id, categoryId), eq(s.categories.serverId, serverId)),
    );
  if (!category) fail("BAD_REQUEST", "Choose a category in this server.");
}
export const channelsRouter = createTRPCRouter({
  create: chatProcedure
    .input(
      z.object({ serverId: uuid, kind: z.enum(["text", "voice"]), ...fields }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      requirePermission(access.permissions, P.MANAGE_CHANNELS);
      const [count] = await ctx.tx
        .select({ count: sql<number>`count(*)::int` })
        .from(s.channels)
        .where(
          and(
            eq(s.channels.serverId, input.serverId),
            isNull(s.channels.deletedAt),
          ),
        );
      if (count!.count >= 100)
        fail("CONFLICT", "This server has reached its channel limit.");
      await categoryCheck(ctx.tx, input.serverId, input.categoryId);
      const [channel] = await ctx.tx
        .insert(s.channels)
        .values(input)
        .returning();
      if (input.kind === "text")
        await ctx.tx.insert(s.conversations).values({ channelId: channel!.id });
      return channel!;
    }),
  update: chatProcedure
    .input(z.object({ channelId: uuid, ...fields }))
    .mutation(async ({ ctx, input }) => {
      const { channel, permissions } = await channelAccess(
        ctx.tx,
        ctx.actor,
        input.channelId,
        P.MANAGE_CHANNELS,
        true,
      );
      requirePermission(permissions, P.MANAGE_CHANNELS);
      await categoryCheck(ctx.tx, channel.serverId, input.categoryId);
      const [result] = await ctx.tx
        .update(s.channels)
        .set({
          name: input.name,
          topic: input.topic,
          categoryId: input.categoryId,
          position: input.position,
        })
        .where(eq(s.channels.id, input.channelId))
        .returning();
      return result!;
    }),
  delete: chatProcedure
    .input(z.object({ channelId: uuid }))
    .mutation(async ({ ctx, input }) => {
      await channelAccess(
        ctx.tx,
        ctx.actor,
        input.channelId,
        P.MANAGE_CHANNELS,
        true,
      );
      await ctx.tx
        .update(s.channels)
        .set({ deletedAt: new Date() })
        .where(eq(s.channels.id, input.channelId));
      return { ok: true };
    }),
  categorySave: chatProcedure
    .input(
      z.object({
        serverId: uuid,
        categoryId: uuid.optional(),
        name,
        position: z.number().int().min(0).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      requirePermission(access.permissions, P.MANAGE_CHANNELS);
      if (input.categoryId) {
        const [category] = await ctx.tx
          .update(s.categories)
          .set({ name: input.name, position: input.position })
          .where(
            and(
              eq(s.categories.id, input.categoryId),
              eq(s.categories.serverId, input.serverId),
            ),
          )
          .returning();
        if (!category) fail("NOT_FOUND", "Category unavailable.");
        return category;
      }
      const [count] = await ctx.tx
        .select({ count: sql<number>`count(*)::int` })
        .from(s.categories)
        .where(eq(s.categories.serverId, input.serverId));
      if (count!.count >= 100) fail("CONFLICT", "Category limit reached.");
      const [category] = await ctx.tx
        .insert(s.categories)
        .values(input)
        .returning();
      return category!;
    }),
  categoryDelete: chatProcedure
    .input(z.object({ serverId: uuid, categoryId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const access = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      requirePermission(access.permissions, P.MANAGE_CHANNELS);
      await ctx.tx
        .update(s.channels)
        .set({ categoryId: null })
        .where(
          and(
            eq(s.channels.serverId, input.serverId),
            eq(s.channels.categoryId, input.categoryId),
          ),
        );
      await ctx.tx
        .delete(s.categories)
        .where(
          and(
            eq(s.categories.serverId, input.serverId),
            eq(s.categories.id, input.categoryId),
          ),
        );
      return { ok: true };
    }),
});
