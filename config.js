export default {
    URL_TO_SCRAPE: 'https://www.yellowpages.com/los-angeles-ca', // Replace with your target URL
    CSV_FILE_NAME: 'hehe2.csv',
    CONCURRENT_SCRAPERS: 5,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 5000,
    PAGE_LOAD_TIMEOUT: 60000,
    SELECTOR_TIMEOUT: 5000,
    PAGE_DELAY_MIN: 2000,  // Minimum delay between pages
    PAGE_DELAY_MAX: 4000,  // Maximum delay between pages
    BATCH_DELAY: 5000,     // Delay between batches
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};