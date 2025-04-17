// background.js
// This script handles persistence between popup openings and makes API requests

// Initial state setup
chrome.runtime.onInstalled.addListener(() => {
  // Initialize storage with default values if they don't exist
  chrome.storage.local.get(['scrapeState', 'totalStats', 'analysisState', 'requestQueue'], function(result) {
    if (!result.scrapeState) {
      // Set initial state
      chrome.storage.local.set({
        scrapeState: {
          inProgress: false,
          username: '',
          tweetCount: 0,
          currentCount: 0,
          status: 'Ready to scrape tweets.',
          statusType: 'info',
          lastUpdated: Date.now(),
          progressBarVisible: false
        }
      });
    }
    
    // Initialize total stats if not exist
    if (!result.totalStats) {
      chrome.storage.local.set({
        totalStats: {
          totalTweetsScraped: 0,
          totalAccountsScraped: 0,
          lastScrapedUsername: '',
          lastScrapedAt: null,
          scrapedAccounts: {}
        }
      });
    }
    
    // Initialize analysis state if not exist
    if (!result.analysisState) {
      chrome.storage.local.set({
        analysisState: {
          analysisComplete: false,
          inProgress: false,
          username: '',
          isBot: false,
          classification: '',
          tweetCount: 0,
          analysisDate: null,
          resultsAvailable: false,
          shouldShowResults: false,
          error: null
        }
      });
    }
    
    // Initialize request queue
    if (!result.requestQueue) {
      chrome.storage.local.set({
        requestQueue: []
      });
    }
  });
});

// Set up a listener for storage changes to process analysis requests
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.requestQueue) {
    const newQueue = changes.requestQueue.newValue || [];
    const oldQueue = changes.requestQueue.oldValue || [];
    
    // Check if a new request was added
    if (newQueue.length > oldQueue.length) {
      // Get the newest request (last item in the queue)
      const newRequest = newQueue[newQueue.length - 1];
      processAnalysisRequest(newRequest);
    }
  }
});

// Process analysis requests from the queue
async function processAnalysisRequest(request) {
  if (!request || !request.id) return;
  
  console.log(`Processing analysis request ${request.id} for @${request.profileData.username}`);
  
  // Update analysis state to show progress
  updateAnalysisState({
    inProgress: true,
    analysisComplete: false,
    username: request.profileData.username,
    tweetCount: request.profileData.tweets.length,
    resultsAvailable: false,
    error: null,
    status: `Analyzing ${request.profileData.tweets.length} tweets...`,
    statusType: 'info',
    lastUpdated: Date.now()
  });
  
  try {
    // Make the API request
    const result = await analyzeAccountData(request.profileData, request.apiUrl);
    
    // Update analysis state with results
    const isBot = result.classification && result.classification.toUpperCase() === 'BOT';
    
    updateAnalysisState({
      inProgress: false,
      analysisComplete: true,
      username: request.profileData.username,
      isBot: isBot,
      classification: result.classification,
      tweetCount: request.profileData.tweets.length,
      analysisDate: new Date().toISOString(),
      resultsAvailable: true,
      shouldShowResults: true,
      error: null,
      status: `Analysis complete: @${request.profileData.username} is likely a ${isBot ? 'BOT' : 'HUMAN'}`,
      statusType: 'success',
      lastUpdated: Date.now()
    });
    
    // Store the analysis results
    chrome.storage.local.set({
      analysisResults: result
    });
    
    // Remove the request from the queue
    removeRequestFromQueue(request.id);
    
    console.log(`Analysis completed for @${request.profileData.username}`);
  } catch (error) {
    console.error('Error during analysis:', error);
    
    // Update analysis state with error
    updateAnalysisState({
      inProgress: false,
      analysisComplete: false,
      error: error.message,
      status: `Analysis error: ${error.message}`,
      statusType: 'error',
      lastUpdated: Date.now()
    });
    
    // Remove the request from the queue
    removeRequestFromQueue(request.id);
  }
}

// Analyze account data via API
async function analyzeAccountData(profileData, apiUrl) {
  console.log(`Starting API analysis. Endpoint: ${apiUrl}`);
  console.log(`User: ${profileData.username}, total tweets: ${profileData.tweets.length}`);
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(profileData)
    });
    
    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }
    
    const data = await response.json();
    console.log('API response:', data);
    
    if (!data.result) {
      throw new Error('Invalid response format from server');
    }
    
    return data.result;
  } catch (error) {
    console.error('API request error:', error);
    throw error;
  }
}

// Remove a request from the queue
function removeRequestFromQueue(requestId) {
  chrome.storage.local.get(['requestQueue'], function(result) {
    const queue = result.requestQueue || [];
    const updatedQueue = queue.filter(req => req.id !== requestId);
    
    chrome.storage.local.set({
      requestQueue: updatedQueue
    });
  });
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle scrapeUpdate messages
  if (message.action === 'scrapeUpdate') {
    updateScrapeState({
      inProgress: true,
      currentCount: message.count,
      status: `Scraped ${message.count} tweets so far...`,
      statusType: 'info',
      lastUpdated: Date.now(),
      progressBarVisible: true
    });
    sendResponse({received: true});
  }
  
  // Handle scrapeComplete messages
  else if (message.action === 'scrapeComplete') {
    // Update total tweet stats
    updateTotalStats(message.data.tweets.length, message.data.username);
    
    updateScrapeState({
      inProgress: false,
      currentCount: message.data.tweets.length,
      status: `Scraped ${message.data.tweets.length} tweets successfully!`,
      statusType: 'success',
      lastUpdated: Date.now(),
      progressBarVisible: false,
      scrapeCompleted: true
    });
    sendResponse({received: true});
  }
  
  // Handle scrapeError messages
  else if (message.action === 'scrapeError') {
    updateScrapeState({
      inProgress: false,
      status: `Error: ${message.error}`,
      statusType: 'error',
      lastUpdated: Date.now(),
      progressBarVisible: false
    });
    sendResponse({received: true});
  }
  
  // Handle scrapeStart messages
  else if (message.action === 'scrapeStart') {
    updateScrapeState({
      inProgress: true,
      username: message.username,
      tweetCount: message.tweetCount,
      currentCount: 0,
      status: `Starting to scrape tweets from @${message.username}...`,
      statusType: 'info',
      lastUpdated: Date.now(),
      progressBarVisible: true,
      scrapeCompleted: false
    });
    sendResponse({received: true});
  }
  
  // Handle analysis request
  else if (message.action === 'requestAnalysis') {
    // Add request to queue
    const requestId = `analysis-${Date.now()}`;
    
    chrome.storage.local.get(['requestQueue'], function(result) {
      const queue = result.requestQueue || [];
      
      // Add new request to queue
      const newQueue = [...queue, {
        id: requestId,
        timestamp: Date.now(),
        profileData: message.profileData,
        apiUrl: message.apiUrl
      }];
      
      // Update the queue in storage, which will trigger the storage listener
      chrome.storage.local.set({
        requestQueue: newQueue
      }, function() {
        console.log(`Analysis request ${requestId} added to queue`);
        sendResponse({
          received: true,
          requestId: requestId
        });
      });
    });
    
    return true; // Needed for async response
  }
  
  // Handle analysis result shown message
  else if (message.action === 'resultsShown') {
    // Update analysis state to mark that results have been shown
    updateAnalysisState({
      shouldShowResults: false
    });
    sendResponse({received: true});
  }
  
  // Handle popup opened message to sync state
  else if (message.action === 'popupOpened') {
    chrome.storage.local.get(['scrapeState', 'totalStats', 'analysisState', 'analysisResults'], function(result) {
      // Send all relevant state to popup
      chrome.runtime.sendMessage({
        action: 'stateUpdate',
        state: result.scrapeState || {},
        stats: result.totalStats || {},
        analysisState: result.analysisState || {},
        analysisResults: result.analysisResults || null
      });
    });
    sendResponse({received: true});
  }
  
  // Handle getAnalysisStatus message
  else if (message.action === 'getAnalysisStatus') {
    chrome.storage.local.get(['analysisState', 'analysisResults'], function(result) {
      sendResponse({
        state: result.analysisState || {},
        results: result.analysisResults || null
      });
    });
    return true; // Needed for async response
  }
  
  // Return true to indicate async response
  return true;
});

// Helper function to update state
function updateScrapeState(updates) {
  chrome.storage.local.get(['scrapeState'], function(result) {
    const currentState = result.scrapeState || {};
    const newState = { ...currentState, ...updates };
    
    chrome.storage.local.set({ scrapeState: newState }, function() {
      // Broadcast state update to any open popups
      chrome.runtime.sendMessage({
        action: 'stateUpdate',
        state: newState
      });
    });
  });
}

// Helper function to update analysis state
function updateAnalysisState(updates) {
  chrome.storage.local.get(['analysisState'], function(result) {
    const currentState = result.analysisState || {};
    const newState = { ...currentState, ...updates };
    
    chrome.storage.local.set({ analysisState: newState }, function() {
      // Broadcast analysis update to any open popups
      chrome.runtime.sendMessage({
        action: 'analysisUpdate',
        analysisState: newState
      });
    });
  });
}

// Add a function to update total stats
function updateTotalStats(tweetCount, username) {
  chrome.storage.local.get(['totalStats'], function(result) {
    const currentStats = result.totalStats || {
      totalTweetsScraped: 0,
      totalAccountsScraped: 0,
      lastScrapedUsername: '',
      scrapedAccounts: {}
    };
    
    // Update total tweets count
    currentStats.totalTweetsScraped += tweetCount;
    
    // Check if this is a new account
    if (!currentStats.scrapedAccounts[username]) {
      currentStats.totalAccountsScraped++;
      currentStats.scrapedAccounts[username] = {
        firstScrapedAt: new Date().toISOString(),
        timesScraped: 0,
        totalTweets: 0
      };
    }
    
    // Update account-specific stats
    currentStats.scrapedAccounts[username].timesScraped++;
    currentStats.scrapedAccounts[username].totalTweets += tweetCount;
    currentStats.scrapedAccounts[username].lastScrapedAt = new Date().toISOString();
    
    // Update last scraped account
    currentStats.lastScrapedUsername = username;
    currentStats.lastScrapedAt = new Date().toISOString();
    
    // Save updated stats
    chrome.storage.local.set({ totalStats: currentStats });
  });
}