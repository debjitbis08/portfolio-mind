/**
 * Deep Analysis Job Status API
 *
 * GET: Poll job status by ID
 */

import type { APIRoute } from "astro";
import { activeJobs } from "../deep";

export const GET: APIRoute = async ({ params }) => {
  const { jobId } = params;

  if (!jobId) {
    return new Response(JSON.stringify({ error: "Job ID is required" }), {
      status: 400,
    });
  }

  const job = activeJobs.get(jobId);

  if (!job) {
    return new Response(
      JSON.stringify({
        error: "Job not found",
        message:
          "This job may have expired or never existed. Jobs are kept in memory only.",
      }),
      { status: 404 }
    );
  }

  const response = {
    jobId,
    status: job.status,
    progress: Math.round(
      (job.progress.completed / Math.max(job.progress.total, 1)) * 100
    ),
    total: job.progress.total,
    completed: job.progress.completed,
    currentStock: job.progress.current,
    errors: job.progress.errors,
    results: job.progress.results,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
