/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";
import { type SQL } from "drizzle-orm";
import { type db } from "~/server/db";
import { postRouter } from "~/server/api/routers/post";

jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/libs/buildHelpers", () => ({
  userJobHelper: { insertJob: jest.fn(), getJobs: jest.fn() },
}));

import { userJobHelper } from "~/libs/buildHelpers";

describe("postRouter authentication and ownership", () => {
  beforeEach(() => jest.clearAllMocks());

  it("keeps public greetings accessible", async () => {
    const caller = postRouter.createCaller({
      userId: null,
      db: {} as typeof db,
    });
    await expect(caller.hello({ text: "world" })).resolves.toEqual({
      greeting: "Hello world",
    });
  });

  it("rejects every protected operation without authentication", async () => {
    const caller = postRouter.createCaller({
      userId: null,
      db: {} as typeof db,
    });
    for (const request of [
      () => caller.create({ name: "post" }),
      () => caller.getLatest(),
      () => caller.createJob(),
      () => caller.getJobs(),
      () => caller.getSecretMessage(),
    ]) {
      await expect(request()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect(userJobHelper.insertJob).not.toHaveBeenCalled();
    expect(userJobHelper.getJobs).not.toHaveBeenCalled();
  });

  it("assigns posts to the verified Clerk user", async () => {
    const returning = jest
      .fn()
      .mockResolvedValue([{ id: 1, name: "test", createdById: "user_owner" }]);
    const values = jest.fn().mockReturnValue({ returning });
    const database = {
      insert: jest.fn().mockReturnValue({ values }),
    } as unknown as typeof db;
    const caller = postRouter.createCaller({
      userId: "user_owner",
      db: database,
    });
    await caller.create({ name: "test" });
    expect(values).toHaveBeenCalledWith({
      name: "test",
      createdById: "user_owner",
    });
  });

  it("filters latest posts by the verified user ID", async () => {
    const limit = jest.fn().mockResolvedValue([]);
    const orderBy = jest.fn().mockReturnValue({ limit });
    const where = jest.fn().mockReturnValue({ orderBy });
    const database = {
      select: jest
        .fn()
        .mockReturnValue({ from: jest.fn().mockReturnValue({ where }) }),
    } as unknown as typeof db;
    const caller = postRouter.createCaller({
      userId: "user_owner",
      db: database,
    });
    await expect(caller.getLatest()).resolves.toBeNull();
    const condition = where.mock.calls[0]?.[0] as SQL;
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"posts"."created_by_id"');
    expect(query.params).toEqual(["user_owner"]);
  });

  it("passes the verified user ID to job operations", async () => {
    const caller = postRouter.createCaller({
      userId: "user_owner",
      db: {} as typeof db,
    });
    await caller.createJob();
    await caller.getJobs();
    expect(userJobHelper.insertJob).toHaveBeenCalledWith("user_owner");
    expect(userJobHelper.getJobs).toHaveBeenCalledWith("user_owner");
  });
});
