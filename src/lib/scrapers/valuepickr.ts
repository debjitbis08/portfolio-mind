/**
 * ValuePickr Scraper
 *
 * Fetches investment theses and recent discussions from ValuePickr forum.
 * Returns full content for LLM summarization - we're dealing with real money,
 * so the agent needs complete context.
 *
 * Uses Discourse API endpoints (ValuePickr is Discourse-based).
 */

import { GEMINI_API_KEY } from "astro:env/server";

interface ValuePickrPost {
  id: number;
  post_number: number;
  username: string;
  created_at: string;
  cooked: string; // HTML content
  blurb?: string;
}

interface ValuePickrTopic {
  id: number;
  title: string;
  slug: string;
  posts_count: number;
}

export interface ValuePickrDiscussion {
  topic_url: string;
  topic_title: string;
  total_posts: number;
  initial_posts: {
    author: string;
    date: string;
    content: string;
    post_number: number;
  }[];
  recent_posts: {
    author: string;
    date: string;
    content: string;
    post_number: number;
  }[];
  last_activity: string;
}

export interface QualitativeIntel {
  source: "valuepickr";
  topic_url: string;
  topic_title: string;
  thesis_summary: string;
  recent_sentiment_summary: string;
  last_activity: string;
  raw_thesis?: string; // Optional: include raw for debugging
}

// We just filter out very short junk like "Thanks" or emojis
const MIN_POST_LENGTH = 15;

export class ValuePickrService {
  private static BASE_URL = "https://forum.valuepickr.com";

  /**
   * Search for a stock discussion thread
   */
  static async searchThread(query: string): Promise<ValuePickrTopic | null> {
    try {
      // 1. First try: Exact query
      let url = `${this.BASE_URL}/search/query.json?term=${encodeURIComponent(
        query
      )}`;
      const res = await fetch(url);

      if (!res.ok) return null;

      const data = await res.json();
      let topics = data.topics as ValuePickrTopic[];

      if (!topics || topics.length === 0) {
        // 2. Second try: If query has multiple words (e.g. "Tata Motors"), try adding "Limited" or "Ltd" if short
        // Or if it failed, maybe just try the first word if it's unique enough?
        // For now, let's stick to the primary query to avoid drift.
        return null;
      }

      // Filter candidates
      const candidates = topics.filter((t) => {
        const titleLower = t.title.toLowerCase();
        const queryLower = query.toLowerCase();

        // automatic exclusion of portfolio threads unless the user is specifically searching for one
        // (which they shouldn't be via this tool usually)
        if (
          titleLower.includes("portfolio") &&
          !queryLower.includes("portfolio")
        ) {
          return false;
        }

        // Title must contain the query words (at least the first word if multi-word)
        // actually, let's require the main part of the query
        const queryWords = queryLower.split(" ");
        const firstWord = queryWords[0];

        // Check if at least the first significant word is in the title
        if (!titleLower.includes(firstWord)) return false;

        return true;
      });

      if (candidates.length === 0) return null;

      // Find best match:
      // 1. Exact match start
      // 2. Contains full query
      const match =
        candidates.find((t) =>
          t.title.toLowerCase().startsWith(query.toLowerCase())
        ) ||
        candidates.find((t) =>
          t.title.toLowerCase().includes(query.toLowerCase())
        );

      return match || candidates[0];
    } catch (err) {
      console.error(`ValuePickr search error for ${query}:`, err);
      return null;
    }
  }

  /**
   * Fetch full discussion: thesis + recent significant posts
   */
  static async fetchDiscussion(
    topic: ValuePickrTopic
  ): Promise<ValuePickrDiscussion | null> {
    try {
      // Fetch topic details (gets first ~20 posts by default)
      const topicUrl = `${this.BASE_URL}/t/${topic.slug}/${topic.id}.json`;
      const res = await fetch(topicUrl);
      if (!res.ok) return null;

      const data = await res.json();
      const postStream = data.post_stream;
      const posts = postStream?.posts as ValuePickrPost[];
      const allPostIds = postStream?.stream as number[]; // All post IDs in thread

      if (!posts || posts.length === 0) return null;

      // 1. Get initial discussion posts (first ~10 posts with some content)
      // This captures the thesis, questions, clarifications, and early context
      const MIN_POST_LENGTH_FOR_INITIAL = 15; // Very lenient for initial posts
      const MAX_INITIAL_POSTS = 10;

      const initialPosts = posts
        .filter((p) => {
          const content = this.stripHtml(p.cooked);
          return content.length >= MIN_POST_LENGTH_FOR_INITIAL;
        })
        .slice(0, MAX_INITIAL_POSTS);

      if (initialPosts.length === 0) return null;

      // 2. Fetch recent posts (last 20 post IDs if thread is long)
      let recentPosts: ValuePickrPost[] = [];
      const fetchCount = 20;

      if (allPostIds && allPostIds.length > fetchCount) {
        // Thread is long, fetch the last N posts by ID
        const lastPostIds = allPostIds.slice(-fetchCount);
        // Discourse API expects: ?post_ids[]=1&post_ids[]=2&post_ids[]=3
        const idsParam = lastPostIds.map((id) => `post_ids[]=${id}`).join("&");
        const recentUrl = `${this.BASE_URL}/t/${topic.id}/posts.json?${idsParam}`;

        try {
          const recentRes = await fetch(recentUrl);
          if (recentRes.ok) {
            const recentData = await recentRes.json();
            recentPosts = recentData.post_stream?.posts || [];
          }
        } catch (e) {
          console.warn("[ValuePickr] Failed to fetch recent posts:", e);
          // Fall back to posts from initial fetch
          recentPosts = posts.slice(-fetchCount);
        }
      } else {
        // Thread is short, use last posts from initial fetch
        // Exclude any initial posts to avoid duplication
        const initialPostIds = new Set(initialPosts.map((p) => p.id));
        recentPosts = posts
          .filter((p) => !initialPostIds.has(p.id))
          .slice(-fetchCount);
      }

      // 3. Filter to significant posts - LIGHT filter only
      // We rely on the LLM to process more context.
      const significantRecent = recentPosts
        .filter((p) => {
          const content = this.stripHtml(p.cooked);
          return content.length >= MIN_POST_LENGTH;
        })
        .slice(-20); // pass up to 20 recent posts to LLM

      return {
        topic_url: `${this.BASE_URL}/t/${topic.slug}/${topic.id}`,
        topic_title: topic.title,
        total_posts: topic.posts_count,
        initial_posts: initialPosts.map((p) => ({
          author: p.username,
          date: p.created_at,
          content: this.stripHtml(p.cooked),
          post_number: p.post_number,
        })),
        recent_posts: significantRecent.map((p) => ({
          author: p.username,
          date: p.created_at,
          content: this.stripHtml(p.cooked),
          post_number: p.post_number,
        })),
        last_activity: data.last_posted_at || new Date().toISOString(),
      };
    } catch (err) {
      console.error(`ValuePickr fetch error:`, err);
      return null;
    }
  }

  /**
   * Use a cheap model to summarize the thesis and recent sentiment
   */
  static async summarizeWithLLM(
    discussion: ValuePickrDiscussion
  ): Promise<{ thesis_summary: string; sentiment_summary: string }> {
    try {
      // Dynamic import to avoid build issues
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

      // Build the prompt with full content
      const initialPostsText = discussion.initial_posts
        .map(
          (p) =>
            `[Post #${p.post_number} by ${p.author} on ${new Date(
              p.date
            ).toLocaleDateString()}]\n${p.content}`
        )
        .join("\n\n---\n\n");

      const recentPostsText = discussion.recent_posts
        .map(
          (p) =>
            `[Post #${p.post_number} by ${p.author} on ${new Date(
              p.date
            ).toLocaleDateString()}]\n${p.content}`
        )
        .join("\n\n---\n\n");

      const prompt = `You are analyzing an investment discussion from ValuePickr (Indian value investing forum).

## Initial Discussion (First ${discussion.initial_posts.length} posts)
This section contains the original thesis, any questions asked, and early clarifications:

${initialPostsText}

## Recent Discussion (Last ${
        discussion.recent_posts.length
      } significant posts out of ${discussion.total_posts} total)

${recentPostsText || "(No recent significant posts)"}

---

Please provide TWO separate summaries:

1. **THESIS SUMMARY** (2-3 paragraphs): What is the core investment thesis? What makes this company attractive? What are the key growth drivers, competitive advantages, or catalysts mentioned? Extract this from the initial discussion above.

2. **RECENT SENTIMENT** (1-2 paragraphs): Based on recent posts, what is the current community sentiment? Are there concerns being raised? Is sentiment positive, negative, or mixed? Any recent developments discussed?

Format your response as:
THESIS:
[Your thesis summary here]

SENTIMENT:
[Your sentiment summary here]`;

      console.log("[ValuePickr] Summarizing with Gemini 2.5 Flash...");

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", // Cheap and fast
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const text = response.text || "";

      // Parse the response
      const thesisMatch = text.match(/THESIS:\s*([\s\S]*?)(?=SENTIMENT:|$)/i);
      const sentimentMatch = text.match(/SENTIMENT:\s*([\s\S]*?)$/i);

      return {
        thesis_summary:
          thesisMatch?.[1]?.trim() || "Unable to summarize thesis",
        sentiment_summary:
          sentimentMatch?.[1]?.trim() || "Unable to determine sentiment",
      };
    } catch (error) {
      console.error("[ValuePickr] LLM summarization failed:", error);
      // Fallback: return truncated raw content
      const firstPost = discussion.initial_posts[0];
      return {
        thesis_summary:
          firstPost?.content.substring(0, 1000) + "... (summarization failed)",
        sentiment_summary: discussion.recent_posts.length
          ? `${discussion.recent_posts.length} recent posts found, but summarization failed.`
          : "No recent activity",
      };
    }
  }

  /**
   * Main entry point: Get full intel for a stock
   */
  static async getResearch(symbol: string): Promise<QualitativeIntel | null> {
    const topic = await this.searchThread(symbol);
    if (!topic) {
      console.log(`[ValuePickr] No thread found for: ${symbol}`);
      return null;
    }

    console.log(
      `[ValuePickr] Found thread: "${topic.title}" (${topic.posts_count} posts)`
    );

    const discussion = await this.fetchDiscussion(topic);
    if (!discussion) {
      console.log(`[ValuePickr] Failed to fetch discussion for: ${symbol}`);
      return null;
    }

    console.log(
      `[ValuePickr] Fetched ${discussion.initial_posts.length} initial posts + ${discussion.recent_posts.length} recent posts`
    );

    // Summarize with LLM
    const summaries = await this.summarizeWithLLM(discussion);

    return {
      source: "valuepickr",
      topic_url: discussion.topic_url,
      topic_title: discussion.topic_title,
      thesis_summary: summaries.thesis_summary,
      recent_sentiment_summary: summaries.sentiment_summary,
      last_activity: discussion.last_activity,
    };
  }

  /**
   * Manual entry point: Get research from a direct URL
   */
  static async getResearchFromUrl(
    url: string
  ): Promise<QualitativeIntel | null> {
    try {
      // url format: https://forum.valuepickr.com/t/vinati-organics-limited/1234/5
      // or https://forum.valuepickr.com/t/vinati-organics-limited/1234
      const urlObj = new URL(url);
      if (urlObj.hostname !== "forum.valuepickr.com") return null;

      const pathParts = urlObj.pathname.split("/").filter((p) => p);
      // expect ["t", "slug", "id", ...]
      if (pathParts[0] !== "t" || pathParts.length < 3) return null;

      const slug = pathParts[1];
      const id = parseInt(pathParts[2]);

      if (isNaN(id)) return null;

      // Create a mock topic object to reuse fetchDiscussion
      const mockTopic: ValuePickrTopic = {
        id,
        slug,
        title: slug.replace(/-/g, " "), // Fallback title
        posts_count: 0, // Will be updated by fetchDiscussion potentially if we fetched topic details first
      };

      // We actually need the real topic title and updated stats.
      // fetchDiscussion does a fetch to `topicUrl` which returns the full topic object including title.
      // Let's rely on fetchDiscussion to do the heavy lifting, but we might need to verify the title if we want to be perfect,
      // but fetchDiscussion uses the slug and ID to fetch.

      const discussion = await this.fetchDiscussion(mockTopic);
      if (!discussion) return null;

      // Summarize with LLM
      const summaries = await this.summarizeWithLLM(discussion);

      return {
        source: "valuepickr",
        topic_url: discussion.topic_url,
        topic_title: discussion.topic_title,
        thesis_summary: summaries.thesis_summary,
        recent_sentiment_summary: summaries.sentiment_summary,
        last_activity: discussion.last_activity,
      };
    } catch (e) {
      console.error("[ValuePickr] Error fetching from URL:", e);
      return null;
    }
  }

  private static stripHtml(html: string): string {
    // Remove HTML tags
    let text = html.replace(/<[^>]*>?/gm, "");
    // Decode common HTML entities
    text = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
    // Normalize whitespace
    text = text.replace(/\s+/g, " ").trim();
    return text;
  }
}
