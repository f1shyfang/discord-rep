import {
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Clerk owns users and sessions. Store its stable user ID on application records.
export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    createdById: text("created_by_id").notNull(),
  },
  (table) => [
    index("posts_owner_created_idx").on(table.createdById, table.createdAt),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
  },
  (table) => [index("jobs_user_idx").on(table.userId)],
);

export type Job = typeof jobs.$inferSelect;

export * from "./chat-schema";
