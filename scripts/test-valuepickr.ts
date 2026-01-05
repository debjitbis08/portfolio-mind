import { ValuePickrService } from "../src/lib/scrapers/valuepickr";

async function testVinylChemicals() {
  console.log("Testing search for 'Vinyl Chemicals'...");
  const result = await ValuePickrService.searchThread("Vinyl Chemicals");

  if (result) {
    console.log(`Found thread: ${result.title}`);
    console.log(
      `URL: https://forum.valuepickr.com/t/${result.slug}/${result.id}`
    );

    if (result.title.toLowerCase().includes("portfolio")) {
      console.error("FAIL: Returned a portfolio thread!");
    } else {
      console.log(
        "SUCCESS: Returned a relevant thread (or at least not a portfolio)."
      );
    }
  } else {
    console.log(
      "SUCCESS: No irrelevant thread found (or no thread found at all)."
    );
  }
}

async function testTataMotors() {
  console.log("\nTesting search for 'Tata Motors'...");
  const result = await ValuePickrService.searchThread("Tata Motors");

  if (result) {
    console.log(`Found thread: ${result.title}`);
    if (result.title.toLowerCase().includes("tata motors")) {
      console.log("SUCCESS: Found correct thread.");
    } else {
      console.error("FAIL: Found thread with non-matching title.");
    }
  } else {
    console.log("WARN: No thread found for Tata Motors.");
  }
}

async function run() {
  await testVinylChemicals();
  await testTataMotors();
}

run();
