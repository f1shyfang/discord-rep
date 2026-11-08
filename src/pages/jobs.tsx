import { SignInButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { api } from "~/utils/api";

export default function Jobs() {
  const { isSignedIn, isLoaded } = useUser();
  const jobs = api.post.getJobs.useQuery(undefined, {
    enabled: isLoaded && !!isSignedIn,
  });
  const createJob = api.post.createJob.useMutation({
    onSuccess: () => {
      void jobs.refetch();
    },
  });
  return (
    <main className="flex flex-col gap-4 p-8">
      <h1 className="text-2xl">Your jobs</h1>
      {!isLoaded ? (
        <p>Loading...</p>
      ) : isSignedIn ? (
        <>
          <button
            disabled={createJob.isPending}
            onClick={() => createJob.mutate()}
          >
            {createJob.isPending ? "Creating..." : "Create new job"}
          </button>
          {jobs.isLoading && <p>Loading jobs...</p>}
          {(jobs.error ?? createJob.error) && (
            <p role="alert">{(jobs.error ?? createJob.error)?.message}</p>
          )}
          <ul>
            {jobs.data?.map((job) => (
              <li key={job.id}>
                {job.title}: {job.description}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p>Sign in to view or create jobs.</p>
          <SignInButton mode="modal" />
        </>
      )}
      <Link href="/">Home</Link>
    </main>
  );
}
