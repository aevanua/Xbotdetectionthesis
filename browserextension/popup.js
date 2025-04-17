document.addEventListener('DOMContentLoaded', function() {
  // Tab navigation
  setupTabs();
  
  // Notify background script that popup is opened
  chrome.runtime.sendMessage({
    action: 'popupOpened'
  });
  
  // Load saved settings and state
  loadSavedSettings();
  loadCurrentState();
  
  // Button event listeners
  document.getElementById('scrapeButton').addEventListener('click', handleScrapeButton);
  document.getElementById('analyzeButton').addEventListener('click', handleAnalyzeButton);
  document.getElementById('downloadButton').addEventListener('click', handleDownloadButton);
  
  // Download server links
  document.getElementById('downloadServerLink').addEventListener('click', function(e) {
    e.preventDefault();
    alert('Server script would be downloaded here. This is a mock link for demonstration purposes.');
  });
  
  document.getElementById('downloadModelLink').addEventListener('click', function(e) {
    e.preventDefault();
    alert('LLM model would be downloaded here. This is a mock link for demonstration purposes.');
  });
  
  // Handle Enter key press in username field to trigger scrape
  document.getElementById('username').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      handleScrapeButton();
    }
  });
  
  // Check if there's existing data
  checkForExistingData();
  
  // Check if there are analysis results to display
  checkForAnalysisResults();
  
  // Listen for messages from content script
  setupMessageListeners();
  
  // Load stats
  loadStats();
});

// Tab functionality
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      
      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Show active content
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `${tabName}-tab`) {
          content.classList.add('active');
        }
      });
      
      // Special case for results tab - always show container
      if (tabName === 'results') {
        document.getElementById('resultsContainer').style.display = 'block';
      }
    });
  });
}

// Load saved settings
function loadSavedSettings() {
  chrome.storage.local.get([
    'username',
    'tweetCount', 
    'includeReplies', 
    'includeRetweets',
    'autoAnalyze',
    'apiUrl'
  ], function(data) {
    if (data.username) document.getElementById('username').value = data.username;
    if (data.tweetCount) document.getElementById('tweetCount').value = data.tweetCount;
    if (data.includeReplies !== undefined) document.getElementById('includeReplies').checked = data.includeReplies;
    if (data.includeRetweets !== undefined) document.getElementById('includeRetweets').checked = data.includeRetweets;
    if (data.autoAnalyze !== undefined) document.getElementById('autoAnalyze').checked = data.autoAnalyze;
    if (data.apiUrl) document.getElementById('apiUrl').value = data.apiUrl;
  });
}

// Load current scraping state
function loadCurrentState() {
  chrome.storage.local.get(['scrapeState'], function(data) {
    if (data.scrapeState) {
      // Update UI based on saved state
      updateStatus(data.scrapeState.status, data.scrapeState.statusType);
      
      // Restore progress bar state
      if (data.scrapeState.progressBarVisible) {
        showProgressBar();
        updateProgressBar(data.scrapeState.currentCount, data.scrapeState.tweetCount);
      } else {
        hideProgressBar(false); // Hide without animation
      }
      
      // Enable/disable buttons based on state
      if (data.scrapeState.scrapeCompleted) {
        document.getElementById('analyzeButton').disabled = false;
        document.getElementById('downloadButton').disabled = false;
      }
      
      // If scraping is in progress and we're reopening the popup
      if (data.scrapeState.inProgress) {
        // Keep UI updated for ongoing process
        showProgressBar();
        updateProgressBar(data.scrapeState.currentCount, data.scrapeState.tweetCount);
      }
    }
  });
}

// Check if there are analysis results to display
function checkForAnalysisResults() {
  console.log('Checking for analysis results...');
  
  chrome.storage.local.get(['analysisState', 'analysisResults'], function(data) {
    console.log('Retrieved from storage:', data);
    
    if (data.analysisState && data.analysisState.resultsAvailable && data.analysisResults) {
      console.log('Found valid analysis results to display');
      
      // Enable analyze button if it was disabled
      document.getElementById('analyzeButton').disabled = false;
      
      // Display the analysis results in the UI
      displayBatchResult(data.analysisResults, data.analysisState.tweetCount, data.analysisState.username);
      
      // If analysis is in progress, show the progress
      if (data.analysisState.inProgress) {
        showProgressBar();
        updateProgressBar(50, 100); // Show indeterminate progress
        updateStatus(data.analysisState.status || 'Analysis in progress...', data.analysisState.statusType || 'info');
      } else {
        hideProgressBar(false);
        updateStatus(data.analysisState.status || 'Analysis complete!', data.analysisState.statusType || 'success');
      }
      
      // If this is a newly completed analysis that hasn't been shown yet
      if (data.analysisState.shouldShowResults) {
        // Switch to results tab
        document.querySelector('[data-tab="results"]').click();
        
        // Mark results as shown
        chrome.runtime.sendMessage({
          action: 'resultsShown'
        });
      }
    } else if (data.analysisState && data.analysisState.inProgress) {
      // Analysis is still in progress
      showProgressBar();
      updateProgressBar(50, 100); // Show indeterminate progress
      updateStatus(data.analysisState.status || 'Analysis in progress...', data.analysisState.statusType || 'info');
      
      // Start polling for completion
      startAnalysisPolling();
    } else if (data.analysisState && data.analysisState.error) {
      // There was an error in the analysis
      updateStatus(`Error in analysis: ${data.analysisState.error}`, 'error');
    }
  });
}

// Check if there's existing data
function checkForExistingData() {
  chrome.storage.local.get(['scrapedData', 'analysisResults', 'scrapeState'], function(data) {
    // Check for scraped data
    if (data.scrapedData && data.scrapedData.tweets && data.scrapedData.tweets.length > 0) {
      // Enable download and analyze buttons
      document.getElementById('downloadButton').disabled = false;
      document.getElementById('analyzeButton').disabled = false;
      
      // Set the username field to the previously scraped profile
      if (data.scrapedData.username) {
        document.getElementById('username').value = data.scrapedData.username;
      }
      
      // If there's a state, mark scraping as completed
      if (data.scrapeState) {
        const updatedState = {
          ...data.scrapeState,
          scrapeCompleted: true
        };
        chrome.storage.local.set({ scrapeState: updatedState });
      }
    }
  });
}

// Load stats from storage
function loadStats() {
  chrome.storage.local.get(['totalStats'], function(data) {
    if (data.totalStats) {
      updateStatsDisplay(data.totalStats);
    }
  });
}

// Update the stats display
function updateStatsDisplay(stats) {
  if (!stats) return;
  
  // Update the stats tab
  document.getElementById('total-tweets-count').textContent = stats.totalTweetsScraped || 0;
  document.getElementById('total-accounts-count').textContent = stats.totalAccountsScraped || 0;
  document.getElementById('last-account').textContent = stats.lastScrapedUsername || 'None';
}

// Set up message listeners
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'scrapeUpdate') {
      updateStatus(`Scraped ${message.count} tweets so far...`, 'info');
      updateProgressBar(message.count, message.target);
      sendResponse({received: true});
    } 
    else if (message.action === 'scrapeComplete') {
      const tweetCount = message.data.tweets ? message.data.tweets.length : 0;
      updateStatus(`Scraped ${tweetCount} tweets successfully!`, 'success');
      document.getElementById('downloadButton').disabled = false;
      document.getElementById('analyzeButton').disabled = false;
      hideProgressBar();
      
      // Update stats after scraping
      chrome.storage.local.get(['totalStats'], function(data) {
        if (data.totalStats) {
          updateStatsDisplay(data.totalStats);
        }
      });
      
      // Auto-analyze if enabled
      if (document.getElementById('autoAnalyze').checked) {
        setTimeout(() => {
          handleAnalyzeButton();
        }, 500);
      }
      
      sendResponse({received: true});
    } 
    else if (message.action === 'scrapeError') {
      updateStatus(`Error: ${message.error}`, 'error');
      hideProgressBar();
      sendResponse({received: true});
    }
    else if (message.action === 'stateUpdate') {
      // Handle state updates from background script
      if (message.state) {
        updateUIFromState(message.state, message.stats);
      }
      
      // Handle analysis state
      if (message.analysisState) {
        handleAnalysisStateUpdate(message.analysisState, message.analysisResults);
      }
      
      sendResponse({received: true});
    }
    else if (message.action === 'analysisUpdate') {
      // Handle analysis updates from background
      if (message.analysisState) {
        chrome.storage.local.get(['analysisResults'], function(data) {
          handleAnalysisStateUpdate(message.analysisState, data.analysisResults);
        });
      }
      sendResponse({received: true});
    }
    
    // Keep listener active
    return true;
  });
}

// Add a helper function to handle analysis state updates
function handleAnalysisStateUpdate(analysisState, analysisResults) {
  console.log('Analysis state update:', analysisState);
  
  if (!analysisState) return;
  
  // Update UI based on analysis state
  if (analysisState.inProgress) {
    // Analysis is in progress
    showProgressBar();
    updateProgressBar(50, 100); // Show indeterminate progress
    updateStatus(analysisState.status || 'Analysis in progress...', analysisState.statusType || 'info');
  } else if (analysisState.error) {
    // There was an error
    hideProgressBar();
    updateStatus(`Error in analysis: ${analysisState.error}`, 'error');
    document.getElementById('analyzeButton').disabled = false;
  } else if (analysisState.analysisComplete && analysisState.resultsAvailable && analysisResults) {
    // Analysis completed successfully
    hideProgressBar();
    updateStatus(analysisState.status || 'Analysis complete!', analysisState.statusType || 'success');
    document.getElementById('analyzeButton').disabled = false;
    
    // Display the results
    displayBatchResult(analysisResults, analysisState.tweetCount, analysisState.username);
    
    // If this is a newly completed analysis that hasn't been shown yet
    if (analysisState.shouldShowResults) {
      // Switch to results tab
      document.querySelector('[data-tab="results"]').click();
      
      // Mark results as shown
      chrome.runtime.sendMessage({
        action: 'resultsShown'
      });
    }
  }
}

// Update UI based on state object
function updateUIFromState(state, stats) {
  if (state && state.status) {
    // Update status without saving to avoid loops
    updateStatusWithoutSaving(state.status, state.statusType || 'info');
  }
  
  // Update progress bar
  if (state && state.progressBarVisible) {
    document.getElementById('progressContainer').style.display = 'block';
    const percentage = state.tweetCount > 0 ? (state.currentCount / state.tweetCount * 100) : 0;
    document.getElementById('progressBar').style.width = `${percentage}%`;
  } else if (state) {
    document.getElementById('progressContainer').style.display = 'none';
  }
  
  // Update buttons based on scrape status
  if (state && state.scrapeCompleted) {
    document.getElementById('downloadButton').disabled = false;
    document.getElementById('analyzeButton').disabled = false;
  }
  
  // If username exists, populate the field
  if (state && state.username) {
    document.getElementById('username').value = state.username;
  }
  
  // Update stats if available
  if (stats) {
    updateStatsDisplay(stats);
  }
}

// Update status without saving to storage (to avoid loops)
function updateStatusWithoutSaving(message, type = 'info') {
  const statusElement = document.getElementById('status');
  statusElement.textContent = message;
  
  // Remove all status classes
  statusElement.classList.remove('status-error', 'status-success', 'status-info', 'status-warning');
  
  // Add appropriate class
  statusElement.classList.add(`status-${type}`);
}

// Handle scrape button click
function handleScrapeButton() {
  // Get username from input field
  let username = document.getElementById('username').value.trim();
  
  // Clean username (remove @ if present)
  if (username.startsWith('@')) {
    username = username.substring(1);
  }
  
  // Validate username
  if (!username) {
    updateStatus('Please enter a Twitter username', 'error');
    return;
  }
  
  const tweetCount = parseInt(document.getElementById('tweetCount').value);
  const includeReplies = document.getElementById('includeReplies').checked;
  const includeRetweets = document.getElementById('includeRetweets').checked;
  const apiUrl = document.getElementById('apiUrl').value.trim();
  
  // Save settings including username
  chrome.storage.local.set({
    username: username,
    tweetCount: tweetCount,
    includeReplies: includeReplies,
    includeRetweets: includeRetweets,
    apiUrl: apiUrl
  });
  
  // Reset previous analysis results when starting a new scrape
  chrome.storage.local.remove(['analysisResults', 'analysisState'], function() {
    // Clear any data from previous scrapes
    chrome.storage.local.remove(['scrapedData'], function() {
      // Clear results container
      const resultsContainer = document.getElementById('resultsContainer');
      const summary = document.getElementById('resultsSummary');
      summary.innerHTML = 'No analysis results yet. Scrape and analyze tweets first.';
      
      // Disable analyze and download buttons for new scrape
      document.getElementById('analyzeButton').disabled = true;
      document.getElementById('downloadButton').disabled = true;
      
      updateStatus(`Starting to scrape tweets from @${username}...`, 'info');
      showProgressBar();
      
      // Notify background script about starting scrape
      chrome.runtime.sendMessage({
        action: 'scrapeStart',
        username: username,
        tweetCount: tweetCount
      });
      
      // Check if user is on Twitter
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const currentTab = tabs[0];
        if (!currentTab || !currentTab.url) {
          updateStatus('Error: Cannot access current tab', 'error');
          hideProgressBar();
          return;
        }
        
        const currentUrl = currentTab.url;
        
        if ((currentUrl.includes('twitter.com') || currentUrl.includes('x.com'))) {
          // Check if we're on the right profile page
          const urlUsername = extractUsernameFromUrl(currentUrl);
          
          if (urlUsername !== username) {
            updateStatus(`Navigating to @${username}'s profile...`, 'info');
            chrome.tabs.update({url: `https://twitter.com/${username}`}, function(tab) {
              // Wait for page to load before scraping
              chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
                if (tabId === tab.id && changeInfo.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(listener);
                  
                  // Wait a bit more for Twitter to fully load
                  setTimeout(() => {
                    sendScrapeMessage(tabId, username, tweetCount, includeReplies, includeRetweets);
                  }, 2000);
                }
              });
            });
          } else {
            // Already on the right profile page
            sendScrapeMessage(currentTab.id, username, tweetCount, includeReplies, includeRetweets);
          }
        } else {
          // Not on Twitter at all, navigate to profile
          updateStatus(`Navigating to Twitter...`, 'info');
          chrome.tabs.update({url: `https://twitter.com/${username}`}, function(tab) {
            // Wait for page to load before scraping
            chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
              if (tabId === tab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                
                // Wait a bit more for Twitter to fully load
                setTimeout(() => {
                  sendScrapeMessage(tabId, username, tweetCount, includeReplies, includeRetweets);
                }, 2000);
              }
            });
          });
        }
      });
    });
  });
}

// Helper function to extract username from URL
function extractUsernameFromUrl(url) {
  const match = url.match(/^https?:\/\/(twitter|x)\.com\/([a-zA-Z0-9_]+)/i);
  return match ? match[2] : null;
}

// Send message to content script to start scraping
function sendScrapeMessage(tabId, username, tweetCount, includeReplies, includeRetweets) {
  chrome.tabs.sendMessage(
    tabId, 
    {
      action: 'scrape',
      username: username,
      tweetCount: tweetCount,
      includeReplies: includeReplies,
      includeRetweets: includeRetweets
    },
    function(response) {
      if (chrome.runtime.lastError) {
        // If there's an error, content script might not be ready yet
        setTimeout(() => {
          // Try again after a delay
          chrome.tabs.sendMessage(
            tabId,
            {
              action: 'scrape',
              username: username,
              tweetCount: tweetCount,
              includeReplies: includeReplies,
              includeRetweets: includeRetweets
            },
            function(retryResponse) {
              if (chrome.runtime.lastError) {
                updateStatus('Error connecting to Twitter page. Please refresh and try again.', 'error');
                hideProgressBar();
              }
            }
          );
        }, 1000);
      }
    }
  );
}

// Handle analyze button click - updated to use batch analysis with new data format
function handleAnalyzeButton() {
  updateStatus('Analyzing account for bot detection...', 'info');
  
  // Disable analyze button during analysis
  document.getElementById('analyzeButton').disabled = true;
  
  chrome.storage.local.get(['scrapedData', 'apiUrl'], function(data) {
    if (!data.scrapedData || !data.scrapedData.tweets || data.scrapedData.tweets.length === 0) {
      updateStatus('No data available to analyze', 'error');
      document.getElementById('analyzeButton').disabled = false;
      return;
    }
    
    const apiUrl = data.apiUrl || document.getElementById('apiUrl').value.trim();
    
    // Send the entire profile data structure to the API via the background script
    analyzeAccountData(data.scrapedData, apiUrl);
  });
}

// Function to request analysis via background script
function analyzeAccountData(profileData, apiUrl) {
  console.log(`Requesting analysis via background script`);
  
  showProgressBar();
  updateProgressBar(0, 1);
  updateStatus(`Requesting analysis for ${profileData.tweets.length} tweets...`, 'info');
  
  // Request analysis through the background script
  chrome.runtime.sendMessage({
    action: 'requestAnalysis',
    profileData: profileData,
    apiUrl: apiUrl
  }, function(response) {
    if (chrome.runtime.lastError) {
      console.error('Error communicating with background script:', chrome.runtime.lastError);
      updateStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
      document.getElementById('analyzeButton').disabled = false;
      hideProgressBar();
      return;
    }
    
    if (response && response.received) {
      console.log(`Analysis request received by background script, ID: ${response.requestId}`);
      updateStatus(`Analysis in progress. You can close this popup and return later.`, 'info');
      
      // Start polling for results
      startAnalysisPolling();
    } else {
      updateStatus(`Error submitting analysis request`, 'error');
      document.getElementById('analyzeButton').disabled = false;
      hideProgressBar();
    }
  });
}

// Add a function to poll for analysis status
function startAnalysisPolling() {
  const pollInterval = 1000; // 1 second
  const maxPolls = 120; // Poll for up to 2 minutes
  let pollCount = 0;
  
  const pollTimer = setInterval(() => {
    pollCount++;
    
    chrome.runtime.sendMessage({
      action: 'getAnalysisStatus'
    }, function(response) {
      if (chrome.runtime.lastError) {
        console.error('Error checking analysis status:', chrome.runtime.lastError);
        clearInterval(pollTimer);
        return;
      }
      
      if (!response || !response.state) {
        return;
      }
      
      const state = response.state;
      
      // Update progress UI based on state
      if (state.inProgress) {
        updateStatus(state.status || 'Analysis in progress...', state.statusType || 'info');
        updateProgressBar(50, 100); // Show indeterminate progress
      }
      
      // If analysis completed
      if (state.analysisComplete && response.results) {
        clearInterval(pollTimer);
        
        // Display results
        displayBatchResult(response.results, state.tweetCount, state.username);
        
        // Update UI
        document.getElementById('analyzeButton').disabled = false;
        hideProgressBar();
        
        // Switch to results tab
        document.querySelector('[data-tab="results"]').click();
        
        updateStatus(state.status || 'Analysis complete!', state.statusType || 'success');
        
        // Mark results as viewed
        chrome.runtime.sendMessage({ action: 'resultsShown' });
      }
      
      // If there was an error
      if (state.error) {
        clearInterval(pollTimer);
        updateStatus(`Error analyzing tweets: ${state.error}`, 'error');
        document.getElementById('analyzeButton').disabled = false;
        hideProgressBar();
      }
      
      // Stop polling after max attempts
      if (pollCount >= maxPolls) {
        clearInterval(pollTimer);
        
        // Only show timeout error if analysis is still in progress
        if (state.inProgress) {
          updateStatus('Analysis is taking longer than expected. Please check back later.', 'warning');
          document.getElementById('analyzeButton').disabled = false;
          hideProgressBar();
        }
      }
    });
  }, pollInterval);
}

// Display the result for the entire batch
function displayBatchResult(result, tweetCount, username) {
  console.log('displayBatchResult called with:', result, tweetCount, username);
  
  const container = document.getElementById('resultsContainer');
  const summary = document.getElementById('resultsSummary');
  const resultsList = document.getElementById('resultsList');
  
  if (!container || !summary || !resultsList) {
    console.error('Required DOM elements not found');
    return;
  }
  
  // Clear previous results
  resultsList.innerHTML = '';
  container.style.display = 'block';
  
  // Extract the classification with fallback
  const classification = result.classification || 'UNKNOWN';
  const isBot = classification.toUpperCase() === 'BOT';
  
  // Display summary with overall result
  summary.innerHTML = `
    <div class="overall-result ${isBot ? 'bot-result' : 'human-result'}">
      <h2>@${username} is likely a ${isBot ? 'BOT' : 'HUMAN'}</h2>
      <p>Based on analysis of ${tweetCount} tweets</p>
    </div>
  `;
        
  // Add download results button
  const downloadBtn = document.createElement('button');
  downloadBtn.id = 'downloadResultsBtn';
  downloadBtn.textContent = 'Download Analysis Results';
  downloadBtn.className = 'download-results-btn';
  downloadBtn.addEventListener('click', function() {
    const analysisData = {
      username: username,
      analysis_date: new Date().toISOString(),
      tweets_analyzed: tweetCount,
      result: {
        classification: classification,
        is_bot: isBot
      }
    };
    
    const jsonData = JSON.stringify(analysisData, null, 2);
    const blob = new Blob([jsonData], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${username}_bot_analysis.json`;
    a.click();
    
    updateStatus('Analysis results downloaded', 'success');
  });
  
  summary.appendChild(downloadBtn);
}

// Handle download button click - updated for new data format
function handleDownloadButton() {
  chrome.storage.local.get(['scrapedData', 'analysisResults'], function(data) {
    if (!data.scrapedData || !data.scrapedData.tweets || data.scrapedData.tweets.length === 0) {
      updateStatus('No data available to download', 'error');
      return;
    }
    
    // Include analysis results if available
    let downloadData = data.scrapedData;
    
    if (data.analysisResults) {
      // Add analysis result to the profile data
      downloadData = {
        ...data.scrapedData,
        analysis_result: data.analysisResults
      };
    }
    
    const username = data.scrapedData.username || 'user';
    const jsonData = JSON.stringify(downloadData, null, 2);
    const blob = new Blob([jsonData], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${username}_twitter_data.json`;
    a.click();
    
    updateStatus('Data downloaded successfully!', 'success');
  });
}

// Status update utility
function updateStatus(message, type = 'info') {
  const statusElement = document.getElementById('status');
  statusElement.textContent = message;
  
  // Remove all status classes
  statusElement.classList.remove('status-error', 'status-success', 'status-info', 'status-warning');
  
  // Add appropriate class
  statusElement.classList.add(`status-${type}`);
  
  // Also update the state in storage for persistence
  chrome.storage.local.get(['scrapeState'], function(data) {
    const currentState = data.scrapeState || {};
    const updatedState = {
      ...currentState,
      status: message,
      statusType: type,
      lastUpdated: Date.now()
    };
    
    chrome.storage.local.set({ scrapeState: updatedState });
  });
}

// Progress bar utilities
function showProgressBar() {
  document.getElementById('progressContainer').style.display = 'block';
  document.getElementById('progressBar').style.width = '0%';
  
  // Update state
  chrome.storage.local.get(['scrapeState'], function(data) {
    const currentState = data.scrapeState || {};
    const updatedState = {
      ...currentState,
      inProgress: true,
      progressBarVisible: true
    };
    
    chrome.storage.local.set({ scrapeState: updatedState });
  });
}

function hideProgressBar(animate = true) {
  if (animate) {
    setTimeout(() => {
      document.getElementById('progressContainer').style.display = 'none';
      
      // Update state
      chrome.storage.local.get(['scrapeState'], function(data) {
        const currentState = data.scrapeState || {};
        const updatedState = {
          ...currentState,
          inProgress: false,
          progressBarVisible: false
        };
        
        chrome.storage.local.set({ scrapeState: updatedState });
      });
    }, 1000);
  } else {
    // Hide immediately without animation
    document.getElementById('progressContainer').style.display = 'none';
  }
}

function updateProgressBar(current, total) {
  const percentage = total > 0 ? (current / total * 100) : 0;
  document.getElementById('progressBar').style.width = `${percentage}%`;
  
  // Update state
  chrome.storage.local.get(['scrapeState'], function(data) {
    const currentState = data.scrapeState || {};
    const updatedState = {
      ...currentState,
      currentCount: current,
      tweetCount: total,
      progressBarVisible: true
    };
    
    chrome.storage.local.set({ scrapeState: updatedState });
  });
}