import { ValuePickrService } from "../src/lib/scrapers/valuepickr";

async function debugE2ENetworks() {
  const url =
    "https://forum.valuepickr.com/t/e2e-networks-ltd-listed-small-cloud-computing-player/19083";
  console.log(`Debugging ValuePickr fetch for: ${url}`);

  const intel = await ValuePickrService.getResearchFromUrl(url);

  if (intel) {
    console.log("---------------------------------------------------");
    console.log(`Title: ${intel.topic_title}`);
    console.log(`Last Activity: ${intel.last_activity}`);
    console.log(`Sentiment Summary: ${intel.recent_sentiment_summary}`);
    console.log("---------------------------------------------------");

    // We can't easily access the raw posts here because getResearchFromUrl summarizes them.
    // But logging the result is a good start.
    // To debug deeper we might need to modify the scraper temporarily to log raw posts or exposes them.
  } else {
    console.error("Failed to fetch intel.");
  }
}

debugE2ENetworks();
