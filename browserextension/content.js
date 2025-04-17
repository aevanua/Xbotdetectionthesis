// content.js - Twitter Bot Detector Extension
(function() {
  // Variables to store state
  let tweets = [];
  let profileData = null;
  let targetTweetCount = 50;
  let includeReplies = false;
  let includeRetweets = false; // Default to false - exclude retweets by default
  let scrolling = false;
  let lastScrollHeight = 0;
  let stuckCount = 0;
  let currentUsername = '';
  
  // Debug flag - set to true to enable debug overlay
  const DEBUG_MODE = false;
  
  // Log initialization
  console.log('Twitter Bot Detector content script loaded');
  
  // Listen for messages from popup
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    console.log('Message received:', message);
    
    if (message.action === 'scrape') {
      // Acknowledge receipt
      sendResponse({status: 'starting'});
      
      // Reset tweets array and profile data
      tweets = [];
      profileData = null;
      
      // Get settings from message
      targetTweetCount = message.tweetCount || 50;
      includeReplies = message.includeReplies || false;
      includeRetweets = message.includeRetweets || false;
      currentUsername = message.username || '';
      
      // Start the scraping process
      startScraping();
    }
    
    // Return true to indicate async response
    return true;
  });
  
  function startScraping() {
    console.log('Starting tweet scraping with settings:', {
      target: targetTweetCount,
      includeReplies,
      includeRetweets,
      currentUsername
    });
    
    try {
      // Check if we're on a valid profile page
      if (!isTwitterProfilePage()) {
        sendError('Please navigate to a Twitter profile page.');
        return;
      }
      
      // Get current username from page rather than relying on passed username
      const pageUsername = getCurrentUsername();
      if (currentUsername && pageUsername !== currentUsername) {
        console.log(`Username mismatch: expected ${currentUsername}, on page for ${pageUsername}`);
      }
      
      // Extract profile data first
      extractProfileData(pageUsername);
      
      // Reset tweet state
      tweets = [];
      scrolling = true;
      lastScrollHeight = 0;
      stuckCount = 0;
      
      // Add debug overlay if enabled
      if (DEBUG_MODE) {
        addDebugOverlay();
      }
      
      // Do an initial scroll to activate lazy loading
      window.scrollBy(0, 300);
      
      // Start with a small delay to let the page load
      setTimeout(() => {
        // Try initial scrape
        const initialTweets = scrapeVisibleTweets();
        
        if (tweets.length > 0) {
          console.log(`Found ${tweets.length} tweets initially. Continuing to scroll...`);
          scrollAndScrape();
        } else {
          console.log('No tweets found in initial scrape. Scrolling to load more...');
          window.scrollBy(0, 500);
          setTimeout(() => {
            const secondAttempt = scrapeVisibleTweets();
            if (tweets.length > 0) {
              scrollAndScrape();
            } else {
              console.log('Still no tweets found. Trying alternative selectors...');
              attemptAlternativeScrape();
              if (tweets.length > 0) {
                scrollAndScrape();
              } else {
                sendError('Could not find any tweets. Please check if you are on a valid Twitter profile page.');
              }
            }
          }, 1500);
        }
      }, 1000);
    } catch (error) {
      console.error('Error in startScraping:', error);
      sendError(`An error occurred: ${error.message}`);
    }
  }
  
  // Extract profile data
  function extractProfileData(username) {
    try {
      console.log(`Extracting profile data for ${username}`);
      
      // Create profile data object - flattened format
      profileData = {
        username: username,
        name: getProfileName(),
        description: getProfileDescription(),
        location: getProfileLocation(),
        followers_count: getFollowersCount(),
        following_count: getFollowingCount(),
        tweet_count: getTweetCount(),
        tweets: []
      };
      
      console.log('Extracted profile data:', profileData);
      return profileData;
    } catch (error) {
      console.error('Error extracting profile data:', error);
      sendError(`Error extracting profile data: ${error.message}`);
      return null;
    }
  }
  
  // Get profile name
  function getProfileName() {
    try {
      const nameElement = document.querySelector('[data-testid="UserName"]');
      if (nameElement) {
        // Find the name part (excluding verification badge)
        const nameSpans = nameElement.querySelectorAll('span');
        for (const span of nameSpans) {
          // Skip verification badges and empty spans
          if (!span.querySelector('svg') && span.textContent.trim()) {
            return span.textContent.trim();
          }
        }
      }
      
      // Alternative approach
      const headerElements = document.querySelectorAll('h2');
      for (const h2 of headerElements) {
        if (h2.textContent && h2.textContent.trim() && !h2.querySelector('svg')) {
          return h2.textContent.trim();
        }
      }
      
      return '';
    } catch (error) {
      console.error('Error getting profile name:', error);
      return '';
    }
  }
  
  // Get profile description
  function getProfileDescription() {
    try {
      const bioElement = document.querySelector('[data-testid="UserDescription"]') || 
                         document.querySelector('[data-testid="userBio"]');
      return bioElement ? bioElement.textContent.trim() : '';
    } catch (error) {
      console.error('Error getting profile description:', error);
      return '';
    }
  }
  
  // Get profile location
  function getProfileLocation() {
    try {
      const locationElement = document.querySelector('[data-testid="UserProfileHeader_Items"] span:nth-child(1)');
      return locationElement ? locationElement.textContent.trim() : '';
    } catch (error) {
      console.error('Error getting profile location:', error);
      return '';
    }
  }
  
  // Get followers count
  function getFollowersCount() {
    return extractMetricCount('followers');
  }
  
  // Get following count
  function getFollowingCount() {
    return extractMetricCount('following');
  }
  
  // Get tweet count
  function getTweetCount() {
    try {
      // Look for tab with count
      const tabElements = document.querySelectorAll('[role="tab"]');
      for (const tab of tabElements) {
        if (tab.textContent.includes('Posts') || tab.textContent.includes('Tweets')) {
          const countText = tab.textContent.trim();
          return parseMetricValue(countText);
        }
      }
      return 0;
    } catch (error) {
      console.error('Error getting tweet count:', error);
      return 0;
    }
  }
  
  // Extract count from followers/following elements
  function extractMetricCount(type) {
    try {
      // Find links with href ending in the type
      const links = document.querySelectorAll(`a[href$="/${type}"]`);
      for (const link of links) {
        const countText = link.textContent.trim();
        if (countText && /\d/.test(countText)) {
          return parseMetricValue(countText);
        }
      }
      
      // Alternative approach - look for specific patterns
      const elements = document.querySelectorAll('[href*="/' + type + '"]');
      for (const el of elements) {
        if (el.textContent && /\d/.test(el.textContent)) {
          return parseMetricValue(el.textContent);
        }
      }
      
      return 0;
    } catch (error) {
      console.error(`Error extracting ${type} count:`, error);
      return 0;
    }
  }
  
  // Check if current page is a Twitter profile page
  function isTwitterProfilePage() {
    const url = window.location.href;
    // Match patterns like https://twitter.com/username or https://x.com/username
    // but exclude urls with /status/, /with_replies, etc.
    const profileRegex = /^https?:\/\/(twitter|x)\.com\/([a-zA-Z0-9_]+)(\/?$|\/?(?!\w))/i;
    return profileRegex.test(url);
  }
  
  // Extract username from current page
  function getCurrentUsername() {
    const url = window.location.href;
    const match = url.match(/^https?:\/\/(twitter|x)\.com\/([a-zA-Z0-9_]+)/i);
    return match ? match[2] : '';
  }

  // Check if a tweet is a retweet (internal use only, not exposed in output)
  function isRetweet(element, text) {
    return text.startsWith('RT @') || 
           !!element.querySelector('[data-testid="socialContext"]')?.textContent.includes('Retweeted') ||
           Array.from(element.querySelectorAll('span')).some(span => 
             span.textContent.includes('Retweeted')
           );
  }

  // Scrape visible tweets with an optional limit parameter
  function scrapeVisibleTweets(limit = Infinity) {
    // Calculate how many more tweets we can add
    const remainingTweets = Math.min(limit, targetTweetCount - tweets.length);
    
    // If we've already reached the target, don't scrape more
    if (remainingTweets <= 0) {
      return 0;
    }
    
    // Multiple selectors to try - Twitter/X changes their DOM frequently
    const selectors = [
      'article[data-testid="tweet"]',
      'div[data-testid="cellInnerDiv"]',
      'div[data-testid="tweet"]',
      'div[role="article"]'
    ];
    
    let tweetElements = [];
    let usedSelector = '';
    
    // Try each selector until we find tweets
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements && elements.length > 0) {
        console.log(`Found ${elements.length} tweet elements with selector: ${selector}`);
        tweetElements = Array.from(elements);
        usedSelector = selector;
        break;
      }
    }
    
    // If no tweets found, try a more aggressive approach
    if (tweetElements.length === 0) {
      return attemptAlternativeScrape(remainingTweets);
    }
    
    // Process found elements
    let newTweetsFound = 0;
    
    // Only process up to the remaining tweets we need
    for (let i = 0; i < tweetElements.length && newTweetsFound < remainingTweets; i++) {
      const tweetElement = tweetElements[i];
      // Use internal ID for tracking but don't include in final data
      const internalId = getTweetId(tweetElement);
      
      // Check if we've already processed this tweet
      if (internalId && !tweets.some(t => t._internalId === internalId)) {
        const tweetData = extractTweetData(tweetElement);
        if (tweetData) {
          // Add internal ID for tracking duplicates (won't be included in final data)
          tweetData._internalId = internalId;
          
          // Check if it's a retweet
          const tweetText = tweetData.text || '';
          const isRetweeted = isRetweet(tweetElement, tweetText);
          
          // Apply filters - skip if it's a retweet and we're not including retweets
          if (isRetweeted && !includeRetweets) {
            continue;
          }
          
          // Apply reply filter
          if (tweetData.is_reply && !includeReplies) {
            continue;
          }
          
          // If we got here, the tweet passes all filters
          if (tweetData.text.length > 0) {
            tweets.push(tweetData);
            newTweetsFound++;
            
            // Send update every few tweets
            if (tweets.length % 5 === 0) {
              sendUpdate(tweets.length);
            }
            
            // Check if we have enough tweets
            if (tweets.length >= targetTweetCount) {
              finishScraping();
              break;
            }
          }
        }
      }
    }
    
    if (DEBUG_MODE) {
      updateDebugOverlay(`Found ${newTweetsFound} new tweets (${tweets.length} total)`);
    }
    
    return newTweetsFound;
  }
  
  // Try alternative methods to find tweets
  function attemptAlternativeScrape() {
    console.log('Attempting alternative scraping approach');
    
    // Look for any elements that could be tweets
    const possibleElements = [
      ...document.querySelectorAll('div[lang]'),  // Tweet text often has lang attribute
      ...document.querySelectorAll('time'),       // Tweets have timestamps
      ...document.querySelectorAll('[data-testid="tweetText"]')
    ];
    
    const containers = new Set();
    
    // For each possible element, try to find its tweet container
    possibleElements.forEach(element => {
      // Go up a few levels to find a potential container
      let container = element;
      for (let i = 0; i < 5; i++) {
        if (container.parentElement) {
          container = container.parentElement;
          
          // Check if this looks like a tweet container
          if (container.querySelector('time') || 
              container.getAttribute('role') === 'article' ||
              container.querySelectorAll('div').length > 5) {
            containers.add(container);
            break;
          }
        } else {
          break;
        }
      }
    });
    
    console.log(`Found ${containers.size} potential tweet containers using alternative method`);
    
    // Process these containers as tweets
    let newTweetsFound = 0;
    
    containers.forEach(container => {
      // Create internal ID for duplicate tracking
      const internalId = getTweetId(container) || `alt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      if (!tweets.some(t => t._internalId === internalId)) {
        const tweetData = extractTweetData(container);
        
        if (tweetData && tweetData.text.length > 0) {
          // Add internal ID for tracking duplicates
          tweetData._internalId = internalId;
          
          // Check if it's a retweet
          const tweetText = tweetData.text || '';
          const isRetweeted = isRetweet(container, tweetText);
          
          // Apply filters
          if ((isRetweeted && !includeRetweets) || (tweetData.is_reply && !includeReplies)) {
            return;
          }
          
          tweets.push(tweetData);
          newTweetsFound++;
        }
      }
    });
    
    console.log(`Alternative scrape found ${newTweetsFound} new tweets`);
    return newTweetsFound;
  }
  
  // Scroll and scrape more tweets
  function scrollAndScrape() {
    if (!scrolling) return;
    
    // Get current scroll height
    const scrollHeight = document.documentElement.scrollHeight;
    
    // Track tweet count before scrolling
    const prevTweetCount = tweets.length;
    
    // Check if we're stuck
    if (scrollHeight === lastScrollHeight) {
      stuckCount++;
      
      if (stuckCount === 3) {
        // Try alternative scraping when stuck
        console.log('Scroll height unchanged, trying alternative scrape...');
        attemptAlternativeScrape();
      }
      
      if (stuckCount >= 5) {
        // Finish if we're really stuck
        console.log('Stopped scrolling - no new content loaded after multiple attempts');
        finishScraping();
        return;
      }
    } else {
      // Reset stuck count if scroll height changed
      stuckCount = 0;
      lastScrollHeight = scrollHeight;
    }
    
    // Scroll down
    window.scrollBy(0, 600 + Math.floor(Math.random() * 200));
    
    // Wait for new content to load
    setTimeout(() => {
      // Scrape newly visible tweets
      scrapeVisibleTweets(targetTweetCount - tweets.length);
      
      // Send progress update
      if (DEBUG_MODE) {
        updateDebugOverlay(`Found ${tweets.length} tweets so far. Scrolling for more... (Attempt: ${stuckCount + 1})`);
      }
      
      // Continue if we need more tweets
      if (tweets.length < targetTweetCount) {
        // Add some randomness to avoid detection
        const randomDelay = 800 + Math.floor(Math.random() * 500);
        setTimeout(scrollAndScrape, randomDelay);
      } else {
        console.log(`Target reached! Scraped ${tweets.length} tweets.`);
        finishScraping();
      }
    }, 800);
  }
  
  // Extract tweet ID from element (for internal tracking only)
  function getTweetId(element) {
    try {
      // Try to get ID from a permalink
      const linkSelectors = [
        'a[href*="/status/"]',
        'a[role="link"][href*="/status/"]'
      ];
      
      for (const selector of linkSelectors) {
        const links = element.querySelectorAll(selector);
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href) {
            const match = href.match(/\/status\/(\d+)/);
            if (match && match[1]) {
              return match[1];
            }
          }
        }
      }
      
      // If no ID found, generate a pseudo-ID from content
      const text = element.textContent || '';
      const timestamp = element.querySelector('time')?.getAttribute('datetime') || '';
      
      if (text || timestamp) {
        return `pseudo-${hashString(text + timestamp)}`;
      }
      
      // Last resort
      return `element-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    } catch (error) {
      console.error('Error getting tweet ID:', error);
      return `unknown-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
  }
  
  // Extract data from tweet element in the requested format
  function extractTweetData(element) {
    try {
      // Get tweet text
      let tweetText = '';
      const textElement = element.querySelector('[data-testid="tweetText"]') || 
                          element.querySelector('div[lang]');
      
      if (textElement) {
        tweetText = textElement.textContent.trim();
      } else {
        // Fallback approach: find largest text node
        const divs = element.querySelectorAll('div');
        let maxLength = 0;
        
        divs.forEach(div => {
          const text = div.textContent.trim();
          if (text.length > maxLength && text.length < 500 && !div.querySelector('div')) {
            maxLength = text.length;
            tweetText = text;
          }
        });
      }
      
      // Check if text is empty
      if (!tweetText) {
        return null;
      }
      
      // Identify if it's a reply
      const isReply = !!element.querySelector('[data-testid="socialContext"]')?.textContent.includes('Replying to') ||
                      Array.from(element.querySelectorAll('span')).some(span => 
                        span.textContent.includes('Replying to')
                      );
      
      // Get metrics with flattened structure
      let retweet_count = 0;
      let reply_count = 0;
      let like_count = 0;
      
      // Method 1: Look for specific testid attributes
      const metricSelectors = {
        'like_count': '[data-testid="like"]',
        'reply_count': '[data-testid="reply"]',
        'retweet_count': '[data-testid="retweet"]'
      };
      
      for (const [metricName, selector] of Object.entries(metricSelectors)) {
        const metricElement = element.querySelector(selector);
        if (metricElement) {
          // Try to find the count text inside
          const countElement = metricElement.querySelector('span[data-testid="app-text-transition-container"]') || 
                               metricElement.querySelector('span');
          
          if (countElement && countElement.textContent) {
            const countText = countElement.textContent.trim();
            if (countText && /\d/.test(countText)) { // Contains at least one digit
              if (metricName === 'like_count') {
                like_count = parseMetricValue(countText);
              } else if (metricName === 'reply_count') {
                reply_count = parseMetricValue(countText);
              } else if (metricName === 'retweet_count') {
                retweet_count = parseMetricValue(countText);
              }
            }
          }
        }
      }
      
      // Method 2: Parse from aria labels if method 1 failed
      if (like_count === 0 && retweet_count === 0 && reply_count === 0) {
        const actionButtons = element.querySelectorAll('[role="button"][aria-label]');
        actionButtons.forEach(button => {
          const label = button.getAttribute('aria-label') || '';
          
          // Match patterns like "42 Likes", "3.2K Retweets", etc.
          const likesMatch = label.match(/(\d+\.?\d*[KMB]?)\s*Like/i);
          const retweetsMatch = label.match(/(\d+\.?\d*[KMB]?)\s*Retweet/i);
          const repliesMatch = label.match(/(\d+\.?\d*[KMB]?)\s*Repl/i);
          
          if (likesMatch && likesMatch[1]) {
            like_count = parseMetricValue(likesMatch[1]);
          }
          if (retweetsMatch && retweetsMatch[1]) {
            retweet_count = parseMetricValue(retweetsMatch[1]);
          }
          if (repliesMatch && repliesMatch[1]) {
            reply_count = parseMetricValue(repliesMatch[1]);
          }
        });
      }
      
      // Format according to requested flattened structure
      return {
        is_reply: isReply,
        retweet_count: retweet_count,
        reply_count: reply_count,
        like_count: like_count,
        text: tweetText
      };
    } catch (error) {
      console.error('Error extracting tweet data:', error);
      return null;
    }
  }
  
  // Helper function to parse metric values with K, M, B suffixes
  function parseMetricValue(valueText) {
    if (!valueText) return 0;
    
    const cleanValue = valueText.trim();
    if (cleanValue === '') return 0;
    
    let multiplier = 1;
    
    if (cleanValue.endsWith('K') || cleanValue.endsWith('k')) {
      multiplier = 1000;
    } else if (cleanValue.endsWith('M') || cleanValue.endsWith('m')) {
      multiplier = 1000000;
    } else if (cleanValue.endsWith('B') || cleanValue.endsWith('b')) {
      multiplier = 1000000000;
    }
    
    const numericPart = parseFloat(cleanValue.replace(/[KkMmBb]/g, ''));
    return isNaN(numericPart) ? 0 : Math.round(numericPart * multiplier);
  }
  
  // Generate a hash string from input
  function hashString(str) {
    let hash = 0;
    if (!str || str.length === 0) return hash.toString();
    
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return Math.abs(hash).toString(16);
  }
  
  // Send update to popup
  function sendUpdate(count) {
    chrome.runtime.sendMessage({
      action: 'scrapeUpdate',
      count: count,
      target: targetTweetCount
    }, function(response) {
      // Handle lost connection to popup
      if (chrome.runtime.lastError) {
        console.log('Error sending update:', chrome.runtime.lastError);
        // Keep going anyway - popup might have closed
      }
    });
  }
  
  // Send error to popup
  function sendError(errorMessage) {
    scrolling = false;
    console.error('Scraping error:', errorMessage);
    
    chrome.runtime.sendMessage({
      action: 'scrapeError',
      error: errorMessage
    }, function(response) {
      if (chrome.runtime.lastError) {
        console.log('Error sending error message:', chrome.runtime.lastError);
      }
    });
  }
  
  // Finish scraping process
  function finishScraping() {
    scrolling = false;
    console.log(`Finished scraping ${tweets.length} tweets`);
    
    // Clean up tweets by removing internal IDs before sending
    const cleanedTweets = tweets.map(tweet => {
      // Create a copy of the tweet without the _internalId property
      const { _internalId, ...cleanTweet } = tweet;
      return cleanTweet;
    });
    
    // Add cleaned tweets to profile data
    if (profileData) {
      profileData.tweets = cleanedTweets;
    } else {
      // If somehow we don't have profile data, create a minimal one
      profileData = {
        username: currentUsername || getCurrentUsername(),
        name: getProfileName() || currentUsername || getCurrentUsername(),
        description: getProfileDescription() || '',
        location: getProfileLocation() || '',
        followers_count: getFollowersCount() || 0,
        following_count: getFollowingCount() || 0,
        tweet_count: getTweetCount() || cleanedTweets.length,
        tweets: cleanedTweets
      };
    }
    
    // Store data in chrome storage
    chrome.storage.local.set({
      scrapedData: profileData
    }, function() {
      if (chrome.runtime.lastError) {
        console.error('Error saving data:', chrome.runtime.lastError);
        sendError('Failed to save scraped data to storage');
      } else {
        // Send completion message
        chrome.runtime.sendMessage({
          action: 'scrapeComplete',
          data: profileData
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('Error sending completion message:', chrome.runtime.lastError);
          }
        });
      }
    });
    
    if (DEBUG_MODE) {
      updateDebugOverlay(`Scraping complete! Found ${tweets.length} tweets.`);
    }
  }
  
  // Debug utilities
  function addDebugOverlay() {
    // Remove any existing overlay
    const existingOverlay = document.getElementById('bot-detector-debug');
    if (existingOverlay) {
      existingOverlay.remove();
    }
    
    // Create new overlay
    const debugDiv = document.createElement('div');
    debugDiv.id = 'bot-detector-debug';
    debugDiv.style.position = 'fixed';
    debugDiv.style.top = '10px';
    debugDiv.style.right = '10px';
    debugDiv.style.padding = '10px';
    debugDiv.style.background = 'rgba(0,0,0,0.8)';
    debugDiv.style.color = 'white';
    debugDiv.style.zIndex = '9999';
    debugDiv.style.borderRadius = '5px';
    debugDiv.style.fontSize = '12px';
    debugDiv.style.width = '250px';
    
    debugDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0; font-size: 14px;">Twitter Bot Detector</h3>
        <button id="debug-close" style="background: none; border: none; color: white; cursor: pointer;">×</button>
      </div>
      <div id="debug-status">Initializing...</div>
      <div id="debug-controls" style="margin-top: 8px;">
        <button id="debug-scroll" style="padding: 3px 8px; background: #1DA1F2; border: none; color: white; border-radius: 3px; margin-right: 5px;">Scroll</button>
        <button id="debug-finish" style="padding: 3px 8px; background: #E0245E; border: none; color: white; border-radius: 3px;">Finish</button>
      </div>
    `;
    
    document.body.appendChild(debugDiv);
    
    // Add event listeners
    document.getElementById('debug-close').addEventListener('click', () => {
      debugDiv.remove();
    });
    
    document.getElementById('debug-scroll').addEventListener('click', () => {
      window.scrollBy(0, 500);
      updateDebugOverlay('Manually scrolled');
    });
    
    document.getElementById('debug-finish').addEventListener('click', () => {
      finishScraping();
    });
  }
  
  // Update debug overlay text
  function updateDebugOverlay(message) {
    const statusDiv = document.getElementById('debug-status');
    if (statusDiv) {
      statusDiv.textContent = message;
    }
  }
  
  // Export key functions for testing (not used in production)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isTwitterProfilePage,
      getCurrentUsername,
      extractTweetData,
      parseMetricValue
    };
  }
})();