interface ValuePickrPost {
  id: number;
  username: string;
  created_at: string;
  cooked: string; // HTML content
  blurb?: string; // Short summary
}

interface ValuePickrTopic {
  id: number;
  title: string;
  slug: string;
  posts_count: number;
}

export interface QualitativeIntel {
  source: "valuepickr";
  topic_url: string;
  thesis_summary?: string;
  recent_sentiment_summary?: string;
  last_activity: string;
}

export class ValuePickrService {
  private static BASE_URL = "https://forum.valuepickr.com";

  /**
   * Search for a stock discussion thread
   */
  static async searchThread(query: string): Promise<ValuePickrTopic | null> {
    try {
      const url = `${this.BASE_URL}/search/query.json?term=${encodeURIComponent(
        query
      )}`;
      const res = await fetch(url);

      if (!res.ok) return null;

      const data = await res.json();
      const topics = data.topics as ValuePickrTopic[];

      if (!topics || topics.length === 0) return null;

      // Simple heuristic: Find topic with 'query' in title and max posts
      // Or just return the first relevant looking one.

      const match = topics.find((t) =>
        t.title.toLowerCase().includes(query.toLowerCase())
      );

      return match || topics[0]; // Fallback to first result
    } catch (err) {
      console.error(`ValuePickr search error for ${query}:`, err);
      return null;
    }
  }

  /**
   * Get intelligence from the thread (Thesis + Recent activity)
   */
  static async getResearch(symbol: string): Promise<QualitativeIntel | null> {
    const topic = await this.searchThread(symbol);
    if (!topic) return null;

    try {
      // Fetch topic details (first few posts + last posts)
      // Discourse API: /t/{id}.json returns posts stream
      const topicUrl = `${this.BASE_URL}/t/${topic.slug}/${topic.id}.json`;
      const res = await fetch(topicUrl);
      if (!res.ok) return null;

      const data = await res.json();
      const postStream = data.post_stream?.posts as ValuePickrPost[];

      if (!postStream || postStream.length === 0) return null;

      // 1. Thesis (First Post)
      // Usually post_number 1.
      const firstPost = postStream.find((p: any) => p.post_number === 1);

      // 2. Recent Activity (Last 5 posts)
      // The initial .json might not return ALL posts if thread is huge, but usually returns the start.
      // We might need to fetch the end if stream is large.
      // Discourse often sends the first 20 posts.
      // To get the last posts, we might need to fetch specific IDs from `stream` list if provided,
      // but for simple "recent sentiment", if the thread is active, maybe we just want the latest available?
      // Actually, fetching `/t/{id}/last.json` might work or `/t/{id}.json` often contains `stream` array of ALL IDs.

      // Optimization: For now, let's just use what we have or try to fetch the end.
      // If we just want a "gist", the first post is high value.

      const intel: QualitativeIntel = {
        source: "valuepickr",
        topic_url: `${this.BASE_URL}/t/${topic.slug}/${topic.id}`,
        thesis_summary: firstPost
          ? this.stripHtml(firstPost.cooked).substring(0, 500) + "..."
          : undefined,
        last_activity: data.last_posted_at || new Date().toISOString(),
      };

      return intel;
    } catch (err) {
      console.error(`ValuePickr fetch error for ${symbol}:`, err);
      return null;
    }
  }

  private static stripHtml(html: string): string {
    return html.replace(/<[^>]*>?/gm, "");
  }
}
