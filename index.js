import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createObjectCsvWriter } from 'csv-writer';
import config from './config.js';
import fs from 'fs/promises';
import path from 'path';

function objectsAreEqual(obj1, obj2) {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (let key of keys1) {
    if (obj1[key] !== obj2[key]) {
      return false;
    }
  }

  return true;
}

function arraysAreEqual(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;
  return arr1.every((obj, index) => objectsAreEqual(obj, arr2[index]));
}

const csvWriter = createObjectCsvWriter({
  path: config.CSV_FILE_NAME, // Replace with your CSV file name
  header: [
    { id: 'name', title: 'NAME' },
    { id: 'phone', title: 'PHONE' },
    { id: 'street', title: 'STREET' },
    { id: 'locality', title: 'LOCALITY' },
    { id: 'businessCategories', title: 'BUSINESS CATEGORIES' },
    { id: 'website', title: 'WEBSITE' },
    { id: 'category', title: 'CATEGORY' },
    { id: 'subCategory', title: 'SUB CATEGORY' }
  ],
  append: true // Enable appending to the file
});

const writeRecords = async (records) => {
  try {
    await csvWriter.writeRecords(records);
  } catch (error) {
    console.error('Error writing CSV file:', error);
  }
}

// Add stealth plugin and use defaults
puppeteer.use(StealthPlugin());

const CONCURRENT_SCRAPERS = 50; // Number of parallel scraping processes
const PROGRESS_FILE = 'progress.json';
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

async function setupBrowserPage(browser) {
  const page = await browser.newPage();
  
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.resourceType() === 'document') {
      request.continue();
    } else {
      request.abort();
    }
  });

  // Randomize viewport size
  await page.setViewport({
    width: 1920 + Math.floor(Math.random() * 100),
    height: 1080 + Math.floor(Math.random() * 100),
    deviceScaleFactor: 1,
    hasTouch: false,
    isLandscape: true,
    isMobile: false,
  });

  // Set extra headers and other page configurations
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  });

  return { page };
}

async function scrapeSubCategory(page, category, subCategory) {
  console.log(`Starting to scrape: ${category.category} - ${subCategory.subCategory}`);
  let pageNumber = 1;
  let previousPageData = [];
  
  while (true) {
    let retries = 3;
    while (retries > 0) {
      try {
        await page.goto(`${subCategory.link}?page=${pageNumber}`, {
          waitUntil: ['networkidle0', 'domcontentloaded'],
          timeout: 60000
        });
        break;
      } catch (error) {
        console.error(`Failed to navigate to ${subCategory.link}. Retries left: ${retries - 1}`);
        retries--;
        if (retries === 0) {
          console.error(`Giving up on ${subCategory.link}`);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    const selector = '.organic';
    try {
      try {
        await page.waitForSelector(selector, { visible: true, timeout: 5000 });
      } catch (err) {
        console.log(`No more results found for ${category.category} - ${subCategory.subCategory}`);
        break;
      }

      const businessListingHTML = await page.$(selector);
      const businesses = await businessListingHTML.evaluate(
        (hehe, categoryName, subCategoryName) => {
          const results = [];
          const businessElements = document.querySelectorAll('.result');

          businessElements.forEach((business) => {
            const name = business.querySelector('.business-name span')?.innerText || 'N/A';
            const phone = business.querySelector('.phones.phone.primary')?.innerText || 'N/A';
            const street = business.querySelector('.street-address')?.innerText || 'N/A';
            const locality = business.querySelector('.locality')?.innerText || 'N/A';
            const categories = Array.from(business.querySelectorAll('.categories a')).map(a => a.innerText).join('; ');
            const website = business.querySelector('.track-visit-website')?.href || 'N/A';

            results.push({
              name: `${name.replace(/"/g, '""')}`,
              phone: `${phone.replace(/"/g, '""')}`,
              street: `${street.replace(/"/g, '""')}`,
              locality: `${locality.replace(/"/g, '""')}`,
              businessCategories: `${categories.replace(/"/g, '""')}`,
              website: `${website.replace(/"/g, '""')}`,
              category: categoryName,
              subCategory: subCategoryName
            });
          });

          return results;
        },
        category.category,
        subCategory.subCategory,
      );

      // Check if current page data is the same as previous page
      if (arraysAreEqual(businesses, previousPageData)) {
        console.log(`${category.category} - ${subCategory.subCategory}: Duplicate page detected, moving to next subcategory`);
        break;
      }

      console.log(`${category.category} - ${subCategory.subCategory}: Page ${pageNumber} fetched (${businesses.length} results)`);
      
      if (businesses.length === 0) {
        console.log(`${category.category} - ${subCategory.subCategory}: No more results found`);
        break;
      }
      
      await writeRecords(businesses);
      previousPageData = businesses;
      pageNumber++;
      
      // Add a random delay between pages
      const delay = Math.floor(Math.random() * (config.PAGE_DELAY_MAX - config.PAGE_DELAY_MIN) + config.PAGE_DELAY_MIN);
      await new Promise(resolve => setTimeout(resolve, delay));
      
    } catch (error) {
      console.error(`Error scraping ${category.category} - ${subCategory.subCategory}:`, error);
      break;
    }
  }
}

async function loadProgress() {
  try {
    const data = await fs.readFile(PROGRESS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { completed: [], failed: [], lastRun: null };
  }
}

async function saveProgress(progress) {
  progress.lastRun = new Date().toISOString();
  await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function processInBatches(items, batchSize, processor) {
  const progress = await loadProgress();
  const pendingItems = items.filter(item => {
    const taskId = `${item.category.category}-${item.subCategory.subCategory}`;
    return !progress.completed.includes(taskId);
  });

  console.log(`Total tasks: ${items.length}`);
  console.log(`Already completed: ${progress.completed.length}`);
  console.log(`Pending tasks: ${pendingItems.length}`);

  const batches = [];
  for (let i = 0; i < pendingItems.length; i += batchSize) {
    batches.push(pendingItems.slice(i, i + batchSize));
  }

  for (const [batchIndex, batch] of batches.entries()) {
    console.log(`Processing batch ${batchIndex + 1}/${batches.length}`);
    
    await Promise.all(batch.map(async (item) => {
      const taskId = `${item.category.category}-${item.subCategory.subCategory}`;
      try {
        await processor(item);
        progress.completed.push(taskId);
        await saveProgress(progress);
      } catch (error) {
        console.error(`Failed task ${taskId}:`, error);
        if (!progress.failed.includes(taskId)) {
          progress.failed.push(taskId);
          await saveProgress(progress);
        }
      }
    }));

    // Add a small delay between batches to avoid overwhelming the target site
    if (batchIndex < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Main function
async function run() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certifcate-errors',
      '--ignore-certifcate-errors-spki-list',
      '--disable-blink-features=AutomationControlled',
      '--disable-extensions',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });

  // Add graceful shutdown handlers
  process.on('SIGINT', async () => {
    console.log('\nGracefully shutting down...');
    await cleanup(browser);
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nGracefully shutting down...');
    await cleanup(browser);
    process.exit(0);
  });

  try {
    // Initial page to get categories
    const { page } = await setupBrowserPage(browser);
    
    await page.goto(config.URL_TO_SCRAPE, {
      waitUntil: ['networkidle0', 'domcontentloaded'],
      timeout: 60000
    });

    const selector = '.popular-cats';
    await page.waitForSelector(selector, { visible: true, timeout: 60000 });
    const categories = await page.$(selector);

    const links = await categories.evaluate(() => {
      const categoryElements = Array.from(document.querySelectorAll('article'));
      return categoryElements.map(category => {
        const categoryName = category.querySelector('h3').innerText.trim();
        const subCategoryElements = Array.from(category.querySelectorAll('.row.expand-area a'));
        const subCategories = subCategoryElements.map(subCategory => ({
          subCategory: subCategory.innerText.trim(),
          link: subCategory.href,
        }));
        return {
          category: categoryName,
          subCategories,
        };
      });
    });

    // Close initial page
    await page.close();

    // Flatten the structure for parallel processing
    const allTasks = links.flatMap(category =>
      category.subCategories.map(subCategory => ({
        category,
        subCategory
      }))
    );

    // Process tasks in parallel with rate limiting and progress tracking
    const processTask = async (task) => {
      const { page } = await setupBrowserPage(browser);
      try {
        await scrapeSubCategory(page, task.category, task.subCategory);
      } finally {
        console.log(`Finished scraping: ${task.category.category} - ${task.subCategory.subCategory}`);
        page.close()
      }
    };

    console.log(`Starting parallel scraping with ${CONCURRENT_SCRAPERS} concurrent scrapers...`);
    await processInBatches(allTasks, CONCURRENT_SCRAPERS, processTask);

    const progress = await loadProgress();
    console.log('\nScraping completed!');
    console.log(`Successfully scraped: ${progress.completed.length} categories`);
    if (progress.failed.length > 0) {
      console.log(`Failed to scrape: ${progress.failed.length} categories`);
      console.log('Failed categories:', progress.failed);
    }

    // Keep browser open after completion
    console.log('\nKeeping browser tabs open for inspection. Press Ctrl+C to exit.');

  } catch (error) {
    console.error('An error occurred:', error);
    await cleanup(browser);
  }
}

// Add cleanup function that can be called manually if needed
async function cleanup(browser) {
  if (browser) {
    try {
      await browser.close();
      console.log('Browser closed successfully.');
    } catch (error) {
      console.error('Error while closing browser:', error);
    }
  }
}

run();