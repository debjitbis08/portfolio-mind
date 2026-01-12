import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { GoogleGenAI } from "@google/genai";

const PAYWALL_INDICATORS = [
  "subscribe to continue",
  "subscribe to read",
  "subscription required",
  "sign in to read",
  "login to continue reading",
  "premium content",
  "exclusive to subscribers",
  "register to read the full",
  "unlock this article",
  "unlock full article",
  "member-only content",
  "already a subscriber",
  "become a member to read",
  "this content is for subscribers",
  "full article available to",
];

const MIN_CONTENT_CHARS = 200;
const DEFAULT_MAX_CONTENT_CHARS = 3000;
const DEFAULT_MAX_PDF_BYTES = 5 * 1024 * 1024;
const GOOGLE_NEWS_DECODE_FAILURES = new Set<string>();

type ArticleContentType = "html" | "pdf";

export interface ArticleContentResult {
  content: string;
  contentType: ArticleContentType;
  sourceUrl: string;
}

interface ArticleContentOptions {
  maxChars?: number;
  maxPdfBytes?: number;
  geminiApiKey?: string;
}

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().includes(".pdf");
}

function extractBase64FromGoogleNewsUrl(
  sourceUrl: string
): { status: true; base64Str: string } | { status: false; message: string } {
  try {
    const url = new URL(sourceUrl);
    const pathParts = url.pathname.split("/");

    if (
      url.hostname === "news.google.com" &&
      pathParts.length > 1 &&
      (pathParts[pathParts.length - 2] === "articles" ||
        pathParts[pathParts.length - 2] === "read" ||
        pathParts[pathParts.length - 2] === "rss")
    ) {
      const base64Part = pathParts[pathParts.length - 1];
      const cleanBase64 = base64Part.split("?")[0];
      return { status: true, base64Str: cleanBase64 };
    }

    return { status: false, message: "Invalid Google News URL format" };
  } catch (e) {
    return {
      status: false,
      message: `Error extracting base64: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}

async function getDecodingParams(
  base64Str: string
): Promise<
  | { status: true; signature: string; timestamp: string; base64Str: string }
  | { status: false; message: string }
> {
  const urls = [
    `https://news.google.com/articles/${base64Str}`,
    `https://news.google.com/rss/articles/${base64Str}`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) continue;

      const html = await response.text();
      const signatureMatch = html.match(/data-n-a-sg="([^"]+)"/);
      const timestampMatch = html.match(/data-n-a-ts="([^"]+)"/);

      if (signatureMatch && timestampMatch) {
        return {
          status: true,
          signature: signatureMatch[1],
          timestamp: timestampMatch[1],
          base64Str,
        };
      }
    } catch {
      continue;
    }
  }

  return {
    status: false,
    message: "Failed to fetch decoding params from Google News",
  };
}

async function decodeGoogleNewsUrl(
  signature: string,
  timestamp: string,
  base64Str: string
): Promise<
  { status: true; decodedUrl: string } | { status: false; message: string }
> {
  try {
    const url = "https://news.google.com/_/DotsSplashUi/data/batchexecute";

    const payload = [
      "Fbv4je",
      `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${base64Str}",${timestamp},"${signature}"]`,
    ];

    const body = `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { status: false, message: `HTTP ${response.status}` };
    }

    const text = await response.text();
    const match = text.match(/\[\"garturlres\",\"(.*?)\"/);

    if (!match || !match[1]) {
      return { status: false, message: "Failed to parse decoded URL" };
    }

    const decodedJson = JSON.parse(`"${match[1]}"`);
    const decodedUrlMatch = decodedJson.match(/https?:\/\/[^"]+/);
    if (!decodedUrlMatch) {
      return { status: false, message: "No URL found in decoded response" };
    }

    return { status: true, decodedUrl: decodedUrlMatch[0] };
  } catch (e) {
    return {
      status: false,
      message: `Error decoding URL: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function resolveGoogleNewsUrl(url: string): Promise<string | null> {
  const base64Result = extractBase64FromGoogleNewsUrl(url);
  if (!base64Result.status) return null;

  const paramsResult = await getDecodingParams(base64Result.base64Str);
  if (!paramsResult.status) return null;

  const decodeResult = await decodeGoogleNewsUrl(
    paramsResult.signature,
    paramsResult.timestamp,
    paramsResult.base64Str
  );

  return decodeResult.status ? decodeResult.decodedUrl : null;
}

function extractMainContent(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    text = articleMatch[1];
  }

  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  return text.replace(/\s+/g, " ").trim();
}

function extractHtmlText(html: string): string {
  try {
    const { document } = parseHTML(html);
    const reader = new Readability(document);
    const article = reader.parse();
    if (article?.textContent) {
      return article.textContent.replace(/\s+/g, " ").trim();
    }
  } catch {
    // Fall back to simple extraction.
  }

  return extractMainContent(html).replace(/\s+/g, " ").trim();
}

function isPaywalled(content: string): boolean {
  const lowered = content.toLowerCase();
  return PAYWALL_INDICATORS.some((indicator) => lowered.includes(indicator));
}

async function extractPdfTextWithGemini(
  pdfBuffer: ArrayBuffer,
  apiKey: string,
  maxChars: number
): Promise<string | null> {
  const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");
  const ai = new GoogleGenAI({ apiKey });

  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            text: `Extract the main readable text from this PDF. Return plain text only and keep it under ${maxChars} characters.`,
          },
        ],
      },
    ],
  });

  const text = (result.text || "").trim();
  return text ? text.slice(0, maxChars) : null;
}

async function resolveGoogleNewsUrlViaRedirect(
  url: string
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    if (response.url && !response.url.includes("news.google.com")) {
      return response.url;
    }

    const html = await response.text();
    const metaRefreshMatch = html.match(
      /http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)/i
    );
    if (metaRefreshMatch && metaRefreshMatch[1]) {
      const decoded = metaRefreshMatch[1].trim();
      if (!decoded.includes("news.google.com")) {
        return decoded;
      }
    }

    const canonicalMatch = html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
    );
    if (canonicalMatch && canonicalMatch[1]) {
      const decoded = canonicalMatch[1].trim();
      if (!decoded.includes("news.google.com")) {
        return decoded;
      }
    }
  } catch {
    // Ignore and fall back to no content.
  }

  return null;
}

export async function fetchArticleContent(
  url: string,
  source: string,
  options: ArticleContentOptions = {}
): Promise<ArticleContentResult | null> {
  try {
    const maxChars = options.maxChars ?? DEFAULT_MAX_CONTENT_CHARS;
    const maxPdfBytes = options.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES;
    let targetUrl = url;

    if (
      url.includes("news.google.com/rss/articles/") ||
      url.includes("news.google.com/articles/")
    ) {
      const resolvedUrl = await resolveGoogleNewsUrl(url);
      if (!resolvedUrl) {
        const fallbackUrl = await resolveGoogleNewsUrlViaRedirect(url);
        if (!fallbackUrl) {
          if (!GOOGLE_NEWS_DECODE_FAILURES.has(source)) {
            GOOGLE_NEWS_DECODE_FAILURES.add(source);
            console.info(
              `[News] Skipping Google News decode for ${source} (unable to resolve)`
            );
          }
          return null;
        }
        targetUrl = fallbackUrl;
      } else {
        targetUrl = resolvedUrl;
      }
    }

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/pdf",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[News] Failed to fetch ${targetUrl}: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    const isPdf = contentType.includes("application/pdf") || isPdfUrl(targetUrl);

    if (isPdf) {
      if (!options.geminiApiKey) {
        console.warn(`[News] GEMINI_API_KEY missing for PDF: ${source}`);
        return null;
      }

      const pdfBuffer = await response.arrayBuffer();
      if (pdfBuffer.byteLength > maxPdfBytes) {
        console.warn(`[News] Skipping large PDF (${source})`);
        return null;
      }

      const text = await extractPdfTextWithGemini(
        pdfBuffer,
        options.geminiApiKey,
        maxChars
      );

      if (!text || text.length < MIN_CONTENT_CHARS) return null;

      return {
        content: text,
        contentType: "pdf",
        sourceUrl: targetUrl,
      };
    }

    const html = await response.text();
    let content = extractHtmlText(html);
    if (!content || content.length < MIN_CONTENT_CHARS) return null;

    if (isPaywalled(content)) {
      console.log(`[News] Skipping paywalled article: ${source}`);
      return null;
    }

    if (content.length > maxChars) {
      content = content.slice(0, maxChars);
    }

    return {
      content,
      contentType: "html",
      sourceUrl: targetUrl,
    };
  } catch (error) {
    console.warn(`[News] Error fetching article from ${source}:`, error);
    return null;
  }
}
