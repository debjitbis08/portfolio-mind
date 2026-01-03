/**
 * Jobs API - Create and manage background jobs
 * POST: Create a new job
 * GET: List jobs
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { desc } from "drizzle-orm";

export const POST: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { type } = body;

    if (!type) {
      return new Response(JSON.stringify({ error: "Job type required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create the job
    const [job] = await db
      .insert(schema.jobs)
      .values({
        type,
        status: "pending",
        progress: 0,
        progressMessage: "Job created, waiting to start...",
      })
      .returning();

    // Convert to snake_case
    const formatted = {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      progress_message: job.progressMessage,
      created_at: job.createdAt,
    };

    return new Response(JSON.stringify({ job: formatted }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Jobs POST error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

export const GET: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const jobs = await db
      .select()
      .from(schema.jobs)
      .orderBy(desc(schema.jobs.createdAt))
      .limit(20);

    // Convert to snake_case
    const formatted = jobs.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      progress: j.progress,
      progress_message: j.progressMessage,
      result: j.result ? JSON.parse(j.result) : null,
      error_message: j.errorMessage,
      created_at: j.createdAt,
      started_at: j.startedAt,
      completed_at: j.completedAt,
    }));

    return new Response(JSON.stringify({ jobs: formatted }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Jobs GET error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
