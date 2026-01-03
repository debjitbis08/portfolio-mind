/**
 * Reddit Scraper
 *
 * Fetches recent discussions about stocks from Indian investment subreddits.
 * Uses Reddit's public JSON API (no auth required for read-only).
 *
 * Subreddits:
 * - r/IndiaInvestments (more serious, long-term)
 * - r/IndianStreetBets (more speculative, meme-ish)
 */

interface RedditPost {
  title: string;
  selftext: string;
  score: number;
  num_comments: number;
  created_utc: number;
  permalink: string;
  subreddit: string;
}

export interface RedditSentiment {
  query: string;
  subreddits_searched: string[];
  posts_found: number;
  posts: {
    title: string;
    score: number;
    comments: number;
    subreddit: string;
    age_hours: number;
    url: string;
  }[];
  sentiment_signal: "BULLISH" | "BEARISH" | "NEUTRAL" | "NO_DATA";
  fetched_at: string;
}

const SUBREDDITS = ["IndiaInvestments", "IndianStreetBets"];

// Simple sentiment keywords (can be expanded)
const BULLISH_KEYWORDS = [
  "buy",
  "bullish",
  "undervalued",
  "accumulate",
  "long",
  "gem",
  "multibagger",
  "oversold",
  "strong",
  "opportunity",
];
const BEARISH_KEYWORDS = [
  "sell",
  "bearish",
  "overvalued",
  "avoid",
  "short",
  "dump",
  "bubble",
  "overbought",
  "exit",
  "scam",
];

/**
 * Search Reddit for stock discussions
 */
export async function searchReddit(
  query: string,
  maxResults: number = 10
): Promise<RedditSentiment> {
  console.log(`[Reddit] Searching for: ${query}`);

  const allPosts: RedditPost[] = [];

  for (const subreddit of SUBREDDITS) {
    try {
      // Use old.reddit.com with a proper User-Agent to avoid blocks
      const url = `https://old.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(
        query
      )}&restrict_sr=1&sort=new&limit=10`;

      const response = await fetch(url, {
        headers: {
          // Reddit requires a descriptive User-Agent
          "User-Agent": "investor-ai/1.0 (portfolio analysis tool)",
        },
      });

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
      await new Promise((r) => setTimeout(r, 500));
    } catch (error) {
      console.error(`[Reddit] Error searching ${subreddit}:`, error);
    }
  }

  // Sort by recency
  allPosts.sort((a, b) => b.created_utc - a.created_utc);

  // Take top N
  const topPosts = allPosts.slice(0, maxResults);

  // Calculate sentiment
  const sentimentSignal = analyzeSentiment(topPosts);

  const now = Date.now() / 1000;

  const result: RedditSentiment = {
    query,
    subreddits_searched: SUBREDDITS,
    posts_found: allPosts.length,
    posts: topPosts.map((p) => ({
      title: p.title,
      score: p.score,
      comments: p.num_comments,
      subreddit: p.subreddit,
      age_hours: Math.round((now - p.created_utc) / 3600),
      url: `https://www.reddit.com${p.permalink}`,
    })),
    sentiment_signal: sentimentSignal,
    fetched_at: new Date().toISOString(),
  };

  console.log(
    `[Reddit] Found ${allPosts.length} posts, sentiment: ${sentimentSignal}`
  );

  return result;
}

/**
 * Analyze sentiment from post titles/content
 */
function analyzeSentiment(
  posts: RedditPost[]
): "BULLISH" | "BEARISH" | "NEUTRAL" | "NO_DATA" {
  if (posts.length === 0) {
    return "NO_DATA";
  }

  let bullishScore = 0;
  let bearishScore = 0;

  for (const post of posts) {
    const text = (post.title + " " + post.selftext).toLowerCase();
    const weight = Math.log2(post.score + 2); // Weight by upvotes

    for (const kw of BULLISH_KEYWORDS) {
      if (text.includes(kw)) {
        bullishScore += weight;
      }
    }

    for (const kw of BEARISH_KEYWORDS) {
      if (text.includes(kw)) {
        bearishScore += weight;
      }
    }
  }

  // Determine signal
  const total = bullishScore + bearishScore;
  if (total < 2) {
    return "NEUTRAL"; // Not enough signal
  }

  const ratio = bullishScore / (bearishScore + 0.1);
  if (ratio > 1.5) return "BULLISH";
  if (ratio < 0.67) return "BEARISH";
  return "NEUTRAL";
}
