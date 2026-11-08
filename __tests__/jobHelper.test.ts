import { UserJobHelper, type JobRepository } from "~/libs/user/userJobHelper";

describe("UserJobHelper", () => {
  const repository: jest.Mocked<JobRepository> = {
    insert: jest.fn(),
    findByUserId: jest.fn(),
  };
  const helper = new UserJobHelper(repository);
  beforeEach(() => jest.clearAllMocks());

  it("assigns new jobs to the authenticated user", async () => {
    await expect(helper.insertJob("user_123")).resolves.toBe(true);
    expect(repository.insert).toHaveBeenCalledWith({
      userId: "user_123",
      title: "test",
      description: "test",
      dueDate: expect.any(Date),
    });
  });
  it("propagates insert failures so the client can display an error", async () => {
    repository.insert.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(helper.insertJob("user_123")).rejects.toThrow(
      "Database unavailable",
    );
  });
  it("requests only the authenticated user's jobs", async () => {
    repository.findByUserId.mockResolvedValueOnce([]);
    await expect(helper.getJobs("user_123")).resolves.toEqual([]);
    expect(repository.findByUserId).toHaveBeenCalledWith("user_123");
  });
  it("propagates read failures instead of returning an empty success", async () => {
    repository.findByUserId.mockRejectedValueOnce(
      new Error("Database unavailable"),
    );
    await expect(helper.getJobs("user_123")).rejects.toThrow(
      "Database unavailable",
    );
  });
});
