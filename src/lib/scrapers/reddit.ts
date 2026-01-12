/**
 * Reddit Scraper
 *
 * Fetches recent discussions about stocks from Indian investment subreddits.
 * Uses Reddit's public JSON API (no auth required for read-only).
 *
 * Fetches full post content and top comments, then uses a cheap model
 * (Gemini 2.5 Flash) to create a summary - just like a human would read
 * through the discussions and form an opinion.
 *
 * Subreddits:
 * - r/IndiaInvestments (more serious, long-term)
 * - r/IndianStreetBets (more speculative, meme-ish)
 */

import { getRequiredEnv } from "../env";

interface RedditComment {
  body: string;
  score: number;
  author: string;
}

interface RedditPost {
  title: string;
  selftext: string;
  score: number;
  num_comments: number;
  created_utc: number;
  permalink: string;
  subreddit: string;
}

export interface RedditPostWithComments {
  title: string;
  content: string;
  score: number;
  comment_count: number;
  subreddit: string;
  age_hours: number;
  url: string;
  top_comments: {
    text: string;
    score: number;
    author: string;
  }[];
}

export interface RedditDiscussions {
  query: string;
  subreddits_searched: string[];
  posts_found: number;
  posts: RedditPostWithComments[];
  fetched_at: string;
}

export interface RedditSentimentIntel {
  query: string;
  posts_found: number;
  sentiment_summary: string;
  key_points: string[];
  discussion_quality: "high" | "medium" | "low" | "none";
  subreddits_searched: string[];
  sample_posts: {
    title: string;
    subreddit: string;
    score: number;
    url: string;
  }[];
  fetched_at: string;
}

const SUBREDDITS = ["IndiaInvestments", "IndianStreetBets"];

const HEADERS = {
  "User-Agent": "portfolio-mind/1.0 (portfolio analysis tool)",
};

function getGeminiApiKey(): string {
  return getRequiredEnv("GEMINI_API_KEY");
}

/**
 * Fetch top comments for a post
 */
async function fetchTopComments(
  permalink: string,
  maxComments: number = 5
): Promise<RedditComment[]> {
  try {
    const url = `https://old.reddit.com${permalink}.json?limit=${maxComments}&depth=1`;

    const response = await fetch(url, { headers: HEADERS });

    if (!response.ok) {
      console.warn(`[Reddit] Failed to fetch comments: ${response.status}`);
      return [];
    }

    const data = await response.json();

    // Reddit returns [post, comments] array
    const commentsData = data[1]?.data?.children || [];

    const comments: RedditComment[] = [];
    for (const comment of commentsData) {
      if (comment.kind === "t1" && comment.data?.body) {
        comments.push({
          body: comment.data.body,
          score: comment.data.score || 0,
          author: comment.data.author || "[deleted]",
        });
      }
    }

    // Sort by score and return top N
    return comments.sort((a, b) => b.score - a.score).slice(0, maxComments);
  } catch (error) {
    console.error(`[Reddit] Error fetching comments:`, error);
    return [];
  }
}

/**
 * Search Reddit for stock discussions and fetch top comments
 */
async function fetchDiscussions(
  query: string,
  maxPosts: number = 5
): Promise<RedditDiscussions> {
  console.log(`[Reddit] Searching for: ${query}`);

  const allPosts: RedditPost[] = [];

  for (const subreddit of SUBREDDITS) {
    try {
      const url = `https://old.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(
        query
      )}&restrict_sr=1&sort=relevance&t=year&limit=10`;

      const response = await fetch(url, { headers: HEADERS });

      if (!response.ok) {
        console.warn(`[Reddit] ${subreddit} returned ${response.status}`);
        continue;
      }

      const data = await response.json();
      const posts = data.data?.children || [];

      for (const post of posts) {
        const p = post.data;
        allPosts.push({
          title: p.title || "",
          selftext: p.selftext || "",
          score: p.score || 0,
          num_comments: p.num_comments || 0,
          created_utc: p.created_utc || 0,
          permalink: p.permalink || "",
          subreddit: p.subreddit || subreddit,
        });
      }

      // Small delay between subreddit requests
      await new Promise((r) => setTimeout(r, 300));
    } catch (error) {
      console.error(`[Reddit] Error searching ${subreddit}:`, error);
    }
  }

  // Sort by score (engagement)
  allPosts.sort((a, b) => b.score - a.score);

  // Take top N posts
  const topPosts = allPosts.slice(0, maxPosts);

  const now = Date.now() / 1000;
  const postsWithComments: RedditPostWithComments[] = [];

  // Fetch comments for each post
  for (const post of topPosts) {
    await new Promise((r) => setTimeout(r, 300));

    const comments = await fetchTopComments(post.permalink, 5);

    postsWithComments.push({
      title: post.title,
      content: post.selftext, // Full content, no truncation
      score: post.score,
      comment_count: post.num_comments,
      subreddit: post.subreddit,
      age_hours: Math.round((now - post.created_utc) / 3600),
      url: `https://www.reddit.com${post.permalink}`,
      top_comments: comments.map((c) => ({
        text: c.body, // Full comment, no truncation
        score: c.score,
        author: c.author,
      })),
    });
  }

  console.log(
    `[Reddit] Found ${allPosts.length} posts, returning top ${postsWithComments.length} with comments`
  );

  return {
    query,
    subreddits_searched: SUBREDDITS,
    posts_found: allPosts.length,
    posts: postsWithComments,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Use a cheap model to summarize Reddit discussions
 */
async function summarizeWithLLM(discussions: RedditDiscussions): Promise<{
  sentiment_summary: string;
  key_points: string[];
  discussion_quality: "high" | "medium" | "low" | "none";
}> {
  if (discussions.posts.length === 0) {
    return {
      sentiment_summary: "No discussions found for this stock on Reddit.",
      key_points: [],
      discussion_quality: "none",
    };
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

    // Build the prompt with full content
    const postsText = discussions.posts
      .map((p) => {
        const commentsText = p.top_comments
          .map((c) => `  - [${c.author}, ${c.score} upvotes]: ${c.text}`)
          .join("\n");

        const ageStr =
          p.age_hours < 24
            ? `${p.age_hours}h ago`
            : `${Math.round(p.age_hours / 24)}d ago`;

        return `### r/${p.subreddit} | ${p.score} upvotes | ${
          p.comment_count
        } comments | ${ageStr}
**${p.title}**

${p.content || "(no body text)"}

**Top Comments:**
${commentsText || "(no comments)"}`;
      })
      .join("\n\n---\n\n");

    const prompt = `You are analyzing Reddit discussions about "${discussions.query}" from Indian investing subreddits (r/IndiaInvestments and r/IndianStreetBets).

## Discussions Found (${discussions.posts_found} total, showing top ${discussions.posts.length})

${postsText}

---

Please analyze these discussions and provide:

1. **SENTIMENT SUMMARY** (2-3 sentences): What is the overall retail investor sentiment? Are people bullish, bearish, or mixed? What's driving their opinion?

2. **KEY POINTS** (bullet list): What are the main concerns, catalysts, or talking points being discussed? List 3-5 key points.

3. **DISCUSSION QUALITY**: Rate as HIGH (informed analysis, data-driven), MEDIUM (opinions with some reasoning), or LOW (hype/FUD/memes without substance).

Format your response exactly as:
SENTIMENT:
[Your sentiment summary]

KEY_POINTS:
- [Point 1]
- [Point 2]
- [Point 3]

QUALITY: [HIGH/MEDIUM/LOW]`;

    console.log("[Reddit] Summarizing with Gemini 2.5 Flash...");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text = response.text || "";

    // Parse the response
    const sentimentMatch = text.match(
      /SENTIMENT:\s*([\s\S]*?)(?=KEY_POINTS:|$)/i
    );
    const keyPointsMatch = text.match(
      /KEY_POINTS:\s*([\s\S]*?)(?=QUALITY:|$)/i
    );
    const qualityMatch = text.match(/QUALITY:\s*(HIGH|MEDIUM|LOW)/i);

    // Extract key points as array
    const keyPointsText = keyPointsMatch?.[1]?.trim() || "";
    const keyPoints = keyPointsText
      .split("\n")
      .map((line) => line.replace(/^[-•*]\s*/, "").trim())
      .filter((line) => line.length > 0);

    const qualityRaw = qualityMatch?.[1]?.toUpperCase() || "MEDIUM";
    const quality = ["HIGH", "MEDIUM", "LOW"].includes(qualityRaw)
      ? (qualityRaw.toLowerCase() as "high" | "medium" | "low")
      : "medium";

    return {
      sentiment_summary:
        sentimentMatch?.[1]?.trim() || "Unable to determine sentiment",
      key_points: keyPoints,
      discussion_quality: quality,
    };
  } catch (error) {
    console.error("[Reddit] LLM summarization failed:", error);
    return {
      sentiment_summary: `Found ${discussions.posts_found} posts but summarization failed.`,
      key_points: [],
      discussion_quality: "medium",
    };
  }
}

/**
 * Main entry point: Search Reddit and get summarized intel
 */
export async function searchReddit(
  query: string,
  maxPosts: number = 5
): Promise<RedditSentimentIntel> {
  const discussions = await fetchDiscussions(query, maxPosts);

  if (discussions.posts_found === 0) {
    return {
      query,
      posts_found: 0,
      sentiment_summary: `No Reddit discussions found for "${query}".`,
      key_points: [],
      discussion_quality: "none",
      subreddits_searched: SUBREDDITS,
      sample_posts: [],
      fetched_at: new Date().toISOString(),
    };
  }

  // Summarize with LLM
  const summary = await summarizeWithLLM(discussions);

  return {
    query,
    posts_found: discussions.posts_found,
    sentiment_summary: summary.sentiment_summary,
    key_points: summary.key_points,
    discussion_quality: summary.discussion_quality,
    subreddits_searched: discussions.subreddits_searched,
    sample_posts: discussions.posts.slice(0, 3).map((p) => ({
      title: p.title,
      subreddit: p.subreddit,
      score: p.score,
      url: p.url,
    })),
    fetched_at: discussions.fetched_at,
  };
}
