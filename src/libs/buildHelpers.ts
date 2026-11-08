import { DrizzleJobRepository, UserJobHelper } from "~/libs/user/userJobHelper";
import { db } from "~/server/db";

export const userJobHelper = new UserJobHelper(new DrizzleJobRepository(db));
