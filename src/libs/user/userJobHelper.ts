import { eq } from "drizzle-orm";
import { type db } from "~/server/db";
import { jobs, type Job } from "~/server/db/schema";

export type NewJob = typeof jobs.$inferInsert;
export interface JobRepository {
  insert(job: NewJob): Promise<void>;
  findByUserId(userId: string): Promise<Job[]>;
}

export class DrizzleJobRepository implements JobRepository {
  constructor(private database: typeof db) {}
  async insert(job: NewJob): Promise<void> {
    await this.database.insert(jobs).values(job);
  }
  async findByUserId(userId: string): Promise<Job[]> {
    return this.database.select().from(jobs).where(eq(jobs.userId, userId));
  }
}

export class UserJobHelper {
  constructor(private repository: JobRepository) {}
  async insertJob(userId: string): Promise<boolean> {
    await this.repository.insert({
      userId,
      title: "test",
      description: "test",
      dueDate: new Date(),
    });
    return true;
  }
  async getJobs(userId: string): Promise<Job[]> {
    return this.repository.findByUserId(userId);
  }
}
