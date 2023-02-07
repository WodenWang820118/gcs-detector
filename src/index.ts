import { Page } from "puppeteer";
import { Cluster } from "puppeteer-cluster";
import {
  CONCURRENCY,
  NUM_PAGES,
  URL,
  USER_AGENT,
  NUM_SLEEP_FOR_GCS,
  HEADERLESS,
} from "./config";
import fs from "fs";

async function randomSleep(min: number, max: number) {
  let time = Math.floor(Math.random() * (max - min + 1) + min);
  return new Promise((resolve) => setTimeout(resolve, time));
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getGcs(page: Page) {
  let gcsResult = "";
  // await page.reload({waitUntil: 'networkidle2'});
  page.on("response", async (response) => {
    const url = response.request().url();
    if (url.includes("gcs=")) {
      try {
        const gcs = url.split("gcs=")[1].split("&")[0];
        if (gcs) {
          gcsResult = gcs;
        }
      } catch (error) {
        throw error;
      }
    }
  });

  while (!gcsResult.length) {
    await sleep(NUM_SLEEP_FOR_GCS);
  }
  console.log(gcsResult);
  return gcsResult;
}

async function getGcsFromCluster(url: string) {
  const urls: string[] = [];
  const gcsCollection: string[] = [];

  for (let i = 0; i < NUM_PAGES; i++) {
    urls.push(url);
  }

  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: CONCURRENCY,
    puppeteerOptions: {
      headless: HEADERLESS,
      defaultViewport: {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
      },
    },
    monitor: true,
  });

  await cluster.task(async ({ page, data: url }) => {
    page.setUserAgent(USER_AGENT);
    await page.goto(url, { waitUntil: "networkidle2" });
    await randomSleep(1000, 5000);
    await page.reload({ waitUntil: "networkidle2" });
    try {
      await getGcs(page).then((gcs) => {
        console.log("process completed");
        gcsCollection.push(gcs);
      });
    } catch (error) {
      console.log("connection error, reloading page");
      await page.reload({ waitUntil: "networkidle2" });
      await getGcs(page).then((gcs) => {
        console.log("process completed");
        gcsCollection.push(gcs);
      });
    }
  });

  cluster.on("taskerror", (err, data) => {
    console.log(`Error crawling ${data}: ${err.message}`);
  });

  for (let url of urls) {
    await cluster.queue(url);
  }

  await cluster.idle();
  await cluster.close();
  return gcsCollection;
}

async function main() {
  let g111Count = 0;
  let g100Count = 0;

  await getGcsFromCluster(URL).then((gcsCollection) => {
    console.log(gcsCollection);

    gcsCollection.forEach((gcs) => {
      if (gcs.toLowerCase() === "g111") {
        g111Count++;
      } else if (gcs.toLowerCase() === "g100") {
        g100Count++;
      }
    });

    console.log(`g111: ${g111Count}`);
    console.log(`g100: ${g100Count}`);

    fs.writeFileSync("gcs.txt", JSON.stringify(gcsCollection));
  });
}

main();
