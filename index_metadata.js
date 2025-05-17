const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 6000; // Different port to avoid conflict

app.use(cors());
app.use(express.json());

async function scrapeFathomMetadata(videoUrl) {
  let browser;
  try {
    console.log('Launching browser for metadata...');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: null });

    console.log('Navigating to', videoUrl);
    await page.goto(videoUrl, { waitUntil: 'networkidle', timeout: 300000 }); // 5-minute timeout
    console.log('Navigation completed');

    // Check for redirects or login pages
    const currentUrl = page.url();
    console.log(`Current URL after navigation: ${currentUrl}`);
    if (!currentUrl.includes('fathom.video/share')) {
      console.log('Redirected to unexpected URL, checking for login...');
      const emailInput = await page.$('input[name="email"], input[type="email"]');
      if (emailInput) {
        console.log('Login page detected, attempting authentication...');
        await page.fill('input[name="email"], input[type="email"]', 'your-email@example.com'); // Replace with actual email
        await page.fill('input[name="password"], input[type="password"]', 'your-password'); // Replace with actual password
        await page.click('button[type="submit"], input[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 120000 });
        console.log('Login attempted, new URL:', page.url());
      } else {
        throw new Error('Redirected to unexpected URL, possibly a login page');
      }
    }

    // Extract raw data-page from #app
    let appDataHandle = null;
    try {
      appDataHandle = await page.waitForSelector('#app', { state: 'attached', timeout: 300000 });
    } catch (err) {
      console.error('#app not found:', err.message);
      appDataHandle = null;
    }

    let dataPageJson = null;
    if (appDataHandle) {
      console.log('#app element found');
      dataPageJson = await appDataHandle.getAttribute('data-page');
      if (!dataPageJson) {
        console.log('data-page attribute not found');
      } else {
        console.log('data-page extracted:', dataPageJson);
      }
    } else {
      console.log('#app not found, skipping data-page extraction');
    }

    // Fallback metadata
    const title = await page.title() || 'No Title';
    return {
      dataPageJson: dataPageJson || 'Not found', // Raw JSON string to parse in n8n
      title: title,
      videoUrl: videoUrl
    };
  } catch (err) {
    console.error('Metadata scraping error:', err.message);
    return {
      dataPageJson: 'Not found',
      title: 'No Title',
      videoUrl: videoUrl,
      error: err.message
    };
  } finally {
    if (browser) await browser.close().catch(err => console.error('Browser close failed:', err.message));
    console.log('Browser closed');
  }
}

app.get('/', (req, res) => {
  res.send('Metadata service is running!');
});

app.post('/scrape-metadata', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing videoUrl' });
  }

  let metadata = null;
  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    console.log(`Attempt ${attempt + 1} of ${maxAttempts}`);
    try {
      metadata = await scrapeFathomMetadata(videoUrl);
      if (metadata.dataPageJson !== 'Not found' || attempt === maxAttempts - 1) break;
    } catch (err) {
      console.error(`Attempt ${attempt + 1} failed:`, err.message);
    }
    attempt++;
    if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15 seconds before retry
  }

  if (!metadata) {
    metadata = {
      dataPageJson: 'Not found',
      title: 'No Title',
      videoUrl: videoUrl
    };
  }

  res.json(metadata);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Metadata service running on port ${PORT}`);
});
