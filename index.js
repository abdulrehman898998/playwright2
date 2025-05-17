const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 6000;

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

    // Parse data-page JSON if available
    let callData = { started_at: '1970-01-01', host: { email: 'Unknown' }, byline: 'Unknown', title: 'No Title', video_url: videoUrl, duration: 0 };
    if (dataPageJson) {
      try {
        const parsedData = JSON.parse(dataPageJson.replace(/'/g, '"').replace(/\\"/g, '"')); // Handle single quotes and escaped quotes
        const props = parsedData.props || {};
        callData = props.call || callData;
      } catch (parseErr) {
        console.error('JSON parse error:', parseErr.message);
      }
    }

    // Format the data
    const CallDate = new Date(callData.started_at || '1970-01-01').toISOString().split('T')[0];
    const SalespersonName = callData.host?.email || 'Unknown';
    const ProspectName = callData.byline || 'Unknown';
    const CallDurationSeconds = callData.duration || 0;
    const minutes = Math.floor(CallDurationSeconds / 60);
    const seconds = Math.round(CallDurationSeconds % 60);
    const CallDuration = `${minutes} minutes ${seconds} seconds`;
    const TranscriptLink = callData.video_url || videoUrl;
    const Title = callData.title || (await page.title()) || 'No Title';

    return {
      CallDate,
      SalespersonName,
      ProspectName,
      CallDuration,
      TranscriptLink,
      Title
    };
  } catch (err) {
    console.error('Metadata scraping error:', err.message);
    return {
      CallDate: 'Unknown',
      SalespersonName: 'Unknown',
      ProspectName: 'Unknown',
      CallDuration: 'Unknown',
      TranscriptLink: videoUrl,
      Title: 'No Title',
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
      if (!metadata.error) break; // Exit if no error
    } catch (err) {
      console.error(`Attempt ${attempt + 1} failed:`, err.message);
    }
    attempt++;
    if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15 seconds before retry
  }

  if (!metadata) {
    metadata = {
      CallDate: 'Unknown',
      SalespersonName: 'Unknown',
      ProspectName: 'Unknown',
      CallDuration: 'Unknown',
      TranscriptLink: videoUrl,
      Title: 'No Title'
    };
  }

  res.json(metadata);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Metadata service running on port ${PORT}`);
});
