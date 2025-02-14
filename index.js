import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createObjectCsvWriter } from 'csv-writer';
import config from './config.js';

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
      '--disable-blink-features=AutomationControlled', // Prevents detection via automation
      '--disable-extensions',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });

  try {
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

    // Random mouse movements and scrolling simulation
    await page.evaluateOnNewDocument(() => {
      // Add random mouse movements
      const originalMouseMove = window.MouseEvent.prototype.constructor;
      let lastMouseX = 0, lastMouseY = 0;
      window.MouseEvent = class extends originalMouseMove {
        constructor(type, init) {
          if (type === 'mousemove') {
            init.clientX += Math.random() * 5 - 2.5;
            init.clientY += Math.random() * 5 - 2.5;
            lastMouseX = init.clientX;
            lastMouseY = init.clientY;
          }
          super(type, init);
        }
      };
    });

    // Set extra headers
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

    // Rest of your code
    await page.goto(config.URL_TO_SCRAPE, {
      waitUntil: ['networkidle0', 'domcontentloaded'],
      timeout: 60000
    });


    // Wait for the categories to load
    const selector = '.popular-cats'
    await page.waitForSelector(selector, { visible: true, timeout: 60000 });
    const categories = await page.$(selector);

    // Extract the categories and subcategories
    //   const links: {
    //     category: string;
    //     subCategories: {
    //         subCategory: any;
    //         link: any;
    //     }[];
    // }[]
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

    // Print the categories and subcategories
    links.forEach((category, index) => {
      console.log(`\x1b[36m${index + 1}: ${category.category}\x1b[0m`);
      category.subCategories.forEach((subCategory, idx) => {
        console.log(`  \x1b[32m${idx + 1}. ${subCategory.subCategory}\x1b[0m - \x1b[34m${subCategory.link}\x1b[0m`);
      });
    });

    console.log(`\x1b[31mStarting to scrape the subcategories...\x1b[0m`);

    for (const [index, category] of links.entries()) {
      console.log(`\x1b[36m${index + 1}: ${category.category}:\x1b[0m`);

      let prevRecords = {}

      for (const [idx, subCategory] of category.subCategories.entries()) {
        console.log(`  \x1b[32m${idx + 1}. ${subCategory.subCategory}\x1b[0m - \x1b[34m${subCategory.link}\x1b[0m`);
        let pageNumber = 1;

        while (true) {
          let retries = 3;
          while (retries > 0) {
            try {
              await page.goto(`${subCategory.link}?page=${pageNumber}`, {
                waitUntil: ['networkidle0', 'domcontentloaded'],
                timeout: 60000
              });
              break; // Exit the loop if navigation is successful
            } catch (error) {
              console.error(`Failed to navigate to ${subCategory.link}. Retries left: ${retries - 1}`);
              retries--;
              if (retries === 0) {
                console.error(`Giving up on ${subCategory.link}`);
                continue; // Skip to the next subCategory if all retries fail
              }
            }
          }

          const selector = '.organic';
          try {
            try {
              await page.waitForSelector(selector, { visible: true, timeout: 5000 });
            } catch (err) {
              console.error(`Failed to find selector ${selector} on ${subCategory.link}`);
              break;
            }
            const businessListingHTML = await page.$(selector);

            // Extract business information
            const businesses = await businessListingHTML.evaluate(
              (hehe, categoryName, subCategoryName) => { // Arrow function with explicit typing
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
              category.category, // Pass the string argument
              subCategory.subCategory,  // Pass the string argument
            );

            
            // Output the extracted data
            console.log(`\x1b[33m    Page ${pageNumber} fetched\x1b[0m`);
            // Check if the records are the same as the previous records
            if (objectsAreEqual(businesses, prevRecords)) {
              console.log(`\x1b[33m    Duplicate records found. Exiting...\x1b[0m`);
              break;
            }
            await writeRecords(businesses);
            prevRecords = businesses;
            pageNumber++;
          } catch (error) {
            console.error(error)
            console.error(`Failed to find selector ${selector} on ${subCategory.link}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    await browser.close();
  }
}

run();