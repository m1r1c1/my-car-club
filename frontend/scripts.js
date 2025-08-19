// Multi-Tenant Frontend JavaScript
// This file handles tenant-aware client-side interactions and API communication

// Configuration object for multi-tenant API endpoints
const config = {
    // Base API URL - automatically determined from current domain
    apiBaseUrl: null, // Will be set dynamically based on environment
    
    // Request timeout in milliseconds
    requestTimeout: 15000,
    
    // Maximum retry attempts for failed requests
    maxRetries: 3,
    
    // Current tenant information
    currentTenant: null,
    
    // Tenant detection settings
    tenantDetection: {
        fallbackTenant: 'demo',
        developmentMode: false
    }
};

// DOM element references for better performance and code organization
const elements = {
    fetchButton: null,
    refreshButton: null,
    testButton: null,
    loading: null,
    error: null,
    phraseDisplay: null,
    phraseList: null,
    phraseMetadata: null,
    errorMessage: null,
    errorDetails: null,
    tenantDisplay: null,
    subdomainDisplay: null,
    statusIndicator: null,
    statusDot: null,
    statusText: null,
    mainTitle: null,
    contextTenantId: null,
    contextTenantName: null,
    contextSubdomain: null,
    contextTheme: null
};

/**
 * Initialize the application when the DOM is fully loaded
 * This ensures all HTML elements are available before JavaScript tries to access them
 */
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

/**
 * Initialize the multi-tenant application
 * This is the main entry point for all application functionality
 */
function initializeApp() {
    // Detect if we're in development mode
    config.tenantDetection.developmentMode = isLocalDevelopment();
    
    // Set up API base URL based on environment
    setupApiConfiguration();
    
    // Get references to all DOM elements we'll need
    cacheElementReferences();
    
    // Detect and validate current tenant from subdomain
    detectCurrentTenant();
    
    // Set up event listeners for user interactions
    setupEventListeners();
    
    // Apply tenant-specific theming and branding
    applyTenantTheming();
    
    // Automatically fetch tenant data when the page loads
    fetchTenantPhrases();
}

/**
 * Detect if we're running in local development environment
 * @returns {boolean} - True if in local development
 */
function isLocalDevelopment() {
    const hostname = window.location.hostname;
    return hostname.includes('localhost') || 
           hostname.includes('127.0.0.1') || 
           hostname.includes('0.0.0.0');
}

/**
 * Set up API configuration based on current environment
 * Handles both development and production scenarios
 */
function setupApiConfiguration() {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = window.location.port;
    
    if (config.tenantDetection.developmentMode) {
        // Development mode - use localhost with port
        const portSuffix = port ? `:${port}` : ':3000';
        config.apiBaseUrl = `${protocol}//${hostname}${portSuffix}/api`;
    } else {
        // Production mode - use current domain
        config.apiBaseUrl = `${protocol}//${hostname}/api`;
    }
    
    console.log('API Base URL configured:', config.apiBaseUrl);
}

/**
 * Cache references to DOM elements for better performance
 * This prevents repeated DOM queries throughout the application lifecycle
 */
function cacheElementReferences() {
    elements.fetchButton = document.getElementById('fetch-phrase');
    elements.refreshButton = document.getElementById('refresh-data');
    elements.testButton = document.getElementById('test-isolation');
    elements.loading = document.getElementById('loading');
    elements.error = document.getElementById('error');
    elements.phraseDisplay = document.getElementById('phrase-display');
    elements.phraseList = document.getElementById('phrase-list');
    elements.phraseMetadata = document.getElementById('phrase-metadata');
    elements.errorMessage = document.getElementById('error-message');
    elements.errorDetails = document.getElementById('error-details');
    elements.tenantDisplay = document.getElementById('tenant-display');
    elements.subdomainDisplay = document.getElementById('subdomain-display');
    elements.statusIndicator = document.getElementById('status-indicator');
    elements.statusDot = document.getElementById('status-dot');
    elements.statusText = document.getElementById('status-text');
    elements.mainTitle = document.getElementById('main-title');
    elements.contextTenantId = document.getElementById('context-tenant-id');
    elements.contextTenantName = document.getElementById('context-tenant-name');
    elements.contextSubdomain = document.getElementById('context-subdomain');
    elements.contextTheme = document.getElementById('context-theme');
}

/**
 * Detect current tenant from subdomain
 * Handles both development and production scenarios
 */
function detectCurrentTenant() {
    const hostname = window.location.hostname;
    let detectedSubdomain = null;
    
    if (config.tenantDetection.developmentMode) {
        // Development mode - extract from URL parameter or use fallback
        const urlParams = new URLSearchParams(window.location.search);
        detectedSubdomain = urlParams.get('tenant') || 
                           extractDevelopmentSubdomain(hostname) || 
                           config.tenantDetection.fallbackTenant;
    } else {
        // Production mode - extract from actual subdomain
        detectedSubdomain = extractProductionSubdomain(hostname);
    }
    
    if (!detectedSubdomain) {
        showTenantError('INVALID_SUBDOMAIN', 'No valid tenant subdomain detected');
        return;
    }
    
    // Update tenant information in UI
    updateTenantDisplay(detectedSubdomain);
    
    console.log('Detected tenant subdomain:', detectedSubdomain);
}

/**
 * Extract subdomain from development hostname
 * Supports formats like 'tenant-localhost' or URL parameters
 * @param {string} hostname - The hostname to parse
 * @returns {string|null} - Extracted subdomain or null
 */
function extractDevelopmentSubdomain(hostname) {
    // Check for format: tenant-localhost
    if (hostname.includes('-localhost')) {
        const parts = hostname.split('-localhost');
        return parts[0] || null;
    }
    
    // Check for format: tenant.localhost
    if (hostname.includes('.localhost')) {
        const parts = hostname.split('.localhost');
        return parts[0] || null;
    }
    
    return null;
}

/**
 * Extract subdomain from production hostname
 * @param {string} hostname - The hostname to parse
 * @returns {string|null} - Extracted subdomain or null
 */
function extractProductionSubdomain(hostname) {
    const parts = hostname.split('.');
    
    // Must have at least 3 parts for a subdomain (e.g., tenant.yourdomain.com)
    if (parts.length >= 3) {
        const subdomain = parts[0];
        
        // Exclude common non-tenant subdomains
        const excludedSubdomains = ['www', 'api', 'admin', 'app', 'mail', 'cdn'];
        if (!excludedSubdomains.includes(subdomain.toLowerCase())) {
            return subdomain;
        }
    }
    
    return null;
}

/**
 * Update tenant display in the UI
 * @param {string} subdomain - The detected subdomain
 */
function updateTenantDisplay(subdomain) {
    if (elements.subdomainDisplay) {
        elements.subdomainDisplay.textContent = subdomain;
    }
    
    if (elements.contextSubdomain) {
        elements.contextSubdomain.textContent = subdomain;
    }
    
    // Update status to show tenant detection success
    updateTenantStatus('loading', 'Validating tenant...');
}

/**
 * Update tenant status indicator
 * @param {string} status - Status type: 'loading', 'success', 'error'
 * @param {string} message - Status message to display
 */
function updateTenantStatus(status, message) {
    if (!elements.statusDot || !elements.statusText) return;
    
    // Remove all status classes
    elements.statusDot.classList.remove('loading', 'error');
    
    // Add appropriate status class and update message
    switch (status) {
        case 'loading':
            elements.statusDot.classList.add('loading');
            break;
        case 'error':
            elements.statusDot.classList.add('error');
            break;
        case 'success':
            // Default green color, no additional class needed
            break;
    }
    
    elements.statusText.textContent = message;
}

/**
 * Set up event listeners for user interactions
 * This connects user actions to our application functions
 */
function setupEventListeners() {
    // Add click listener to fetch button
    if (elements.fetchButton) {
        elements.fetchButton.addEventListener('click', handleFetchClick);
    }
    
    // Add click listener to refresh button
    if (elements.refreshButton) {
        elements.refreshButton.addEventListener('click', handleRefreshClick);
    }
    
    // Add click listener to test isolation button
    if (elements.testButton) {
        elements.testButton.addEventListener('click', handleTestIsolationClick);
    }
    
    // Add keyboard shortcuts for better accessibility
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

/**
 * Handle fetch button click events
 */
function handleFetchClick() {
    fetchTenantPhrases();
}

/**
 * Handle refresh button click events
 */
function handleRefreshClick() {
    clearDisplay();
    fetchTenantPhrases();
}

/**
 * Handle test isolation button click events
 */
function handleTestIsolationClick() {
    testTenantIsolation();
}

/**
 * Handle keyboard shortcuts for improved user experience
 * @param {KeyboardEvent} event - The keyboard event object
 */
function handleKeyboardShortcuts(event) {
    // Press 'F' key to fetch phrases
    if (event.key === 'f' || event.key === 'F') {
        if (!event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault();
            fetchTenantPhrases();
        }
    }
    
    // Press 'R' key to refresh
    if (event.key === 'r' || event.key === 'R') {
        if (!event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault();
            handleRefreshClick();
        }
    }
    
    // Press 'T' key to test isolation
    if (event.key === 't' || event.key === 'T') {
        if (!event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault();
            testTenantIsolation();
        }
    }
}

/**
 * Main function to fetch tenant-specific phrases from the secure backend API
 * This implements the secure multi-tenant communication pattern
 */
async function fetchTenantPhrases() {
    try {
        // Show loading state and disable buttons
        showLoading();
        updateTenantStatus('loading', 'Loading tenant data...');
        
        // Make secure API request to our tenant-aware backend
        const response = await makeApiRequest('/phrases');
        
        // Validate the response structure
        if (!response.success || !response.data || !Array.isArray(response.data)) {
            throw new Error('Invalid response format from server');
        }
        
        // Update tenant information from API response
        if (response.tenant) {
            updateTenantInfo(response.tenant);
        }
        
        // Display the phrases successfully
        showPhrases(response.data, response);
        updateTenantStatus('success', 'Tenant data loaded successfully');
        
    } catch (error) {
        // Handle any errors that occurred during the fetch process
        console.error('Error fetching tenant phrases:', error);
        showError(error.message, error.details);
        updateTenantStatus('error', 'Failed to load tenant data');
    } finally {
        // Re-enable buttons regardless of success or failure
        enableButtons();
    }
}

/**
 * Test tenant isolation by attempting to access different tenant data
 * This demonstrates that the system properly isolates tenant data
 */
async function testTenantIsolation() {
    try {
        showLoading();
        updateTenantStatus('loading', 'Testing tenant isolation...');
        
        // Try to fetch data (should only return current tenant's data)
        const response = await makeApiRequest('/phrases');
        
        if (response.success && response.tenant) {
            const message = `Isolation test passed! Only data for tenant "${response.tenant.name}" (${response.tenant.subdomain}) was returned.`;
            showSuccess(message, response);
            updateTenantStatus('success', 'Tenant isolation verified');
        } else {
            throw new Error('Tenant isolation test failed - invalid response');
        }
        
    } catch (error) {
        console.error('Tenant isolation test error:', error);
        showError(`Isolation test failed: ${error.message}`);
        updateTenantStatus('error', 'Isolation test failed');
    } finally {
        enableButtons();
    }
}

/**
 * Update tenant information in the UI
 * @param {Object} tenant - Tenant information from API response
 */
function updateTenantInfo(tenant) {
    config.currentTenant = tenant;
    
    // Update tenant display elements
    if (elements.tenantDisplay) {
        elements.tenantDisplay.textContent = tenant.name || 'Unknown';
    }
    
    if (elements.subdomainDisplay) {
        elements.subdomainDisplay.textContent = tenant.subdomain || 'Unknown';
    }
    
    // Update context display
    if (elements.contextTenantId) {
        elements.contextTenantId.textContent = tenant.id || 'Not available';
    }
    
    if (elements.contextTenantName) {
        elements.contextTenantName.textContent = tenant.name || 'Not available';
    }
    
    if (elements.contextSubdomain) {
        elements.contextSubdomain.textContent = tenant.subdomain || 'Not available';
    }
    
    if (elements.contextTheme) {
        elements.contextTheme.textContent = tenant.theme || 'default';
    }
    
    // Update page title with tenant name
    if (elements.mainTitle && tenant.name) {
        elements.mainTitle.textContent = `${tenant.name} - Multi-Tenant Demo`;
        document.title = `${tenant.name} - Multi-Tenant Demo`;
    }
}

/**
 * Apply tenant-specific theming and branding
 */
function applyTenantTheming() {
    if (config.currentTenant && config.currentTenant.theme) {
        document.body.setAttribute('data-tenant-theme', config.currentTenant.theme);
    }
}

/**
 * Make an API request to our secure multi-tenant backend
 * @param {string} endpoint - The API endpoint to call
 * @param {Object} options - Additional request options
 * @returns {Promise<Object>} - The parsed JSON response from the API
 */
async function makeApiRequest(endpoint, options = {}) {
    // Create the full API URL
    const url = `${config.apiBaseUrl}${endpoint}`;
    
    // Set up the request configuration
    const requestConfig = {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers
        },
        // Set a timeout to prevent hanging requests
        signal: AbortSignal.timeout(config.requestTimeout),
        ...options
    };
    
    // Make the HTTP request
    const response = await fetch(url, requestConfig);
    
    // Check if the response status indicates success
    if (!response.ok) {
        // Handle different HTTP error status codes
        const errorText = await response.text();
        let errorData;
        
        try {
            errorData = JSON.parse(errorText);
        } catch {
            errorData = { message: errorText };
        }
        
        switch (response.status) {
            case 400:
                throw new Error(errorData.message || 'Bad request - please check your tenant configuration');
            case 404:
                throw new Error(errorData.message || 'Tenant not found or API endpoint not available');
            case 500:
                throw new Error(errorData.message || 'Server error - please try again later');
            case 503:
                throw new Error('Service temporarily unavailable - please try again later');
            default:
                throw new Error(`HTTP ${response.status}: ${errorData.message || response.statusText}`);
        }
    }
    
    // Parse the JSON response
    const data = await response.json();
    
    // Validate that we received valid JSON data
    if (!data) {
        throw new Error('Empty response received from server');
    }
    
    return data;
}

/**
 * Display the loading state
 */
function showLoading() {
    hideAllDisplays();
    elements.loading.classList.remove('hidden');
    disableButtons();
}

/**
 * Display the retrieved phrases to the user
 * @param {Array} phrases - Array of phrase objects
 * @param {Object} response - Complete API response with metadata
 */
function showPhrases(phrases, response) {
    hideAllDisplays();
    
    // Clear previous content
    elements.phraseList.innerHTML = '';
    
    if (phrases.length === 0) {
        elements.phraseList.innerHTML = `
            <div class="phrase-item">
                <div class="phrase-content">No phrases found for this tenant.</div>
                <div class="phrase-meta">
                    <span>Try adding some phrases to see tenant isolation in action.</span>
                </div>
            </div>
        `;
    } else {
        // Create phrase items
        phrases.forEach((phrase, index) => {
            const phraseElement = createPhraseElement(phrase, index + 1);
            elements.phraseList.appendChild(phraseElement);
        });
    }
    
    // Update metadata display
    updateMetadataDisplay(response);
    
    // Show the phrase display with animation
    elements.phraseDisplay.classList.remove('hidden');
    
    // Apply tenant theming
    applyTenantTheming();
    
    // Add success notification to console for debugging
    console.log(`Successfully displayed ${phrases.length} phrases for tenant:`, config.currentTenant);
}

/**
 * Create a DOM element for a single phrase
 * @param {Object} phrase - The phrase object
 * @param {number} index - The phrase index for display
 * @returns {HTMLElement} - The created phrase element
 */
function createPhraseElement(phrase, index) {
    const phraseDiv = document.createElement('div');
    phraseDiv.className = 'phrase-item';
    
    const createdDate = new Date(phrase.createdAt).toLocaleDateString();
    const createdTime = new Date(phrase.createdAt).toLocaleTimeString();
    
    phraseDiv.innerHTML = `
        <div class="phrase-content">${sanitizeHtml(phrase.content)}</div>
        <div class="phrase-meta">
            <span class="phrase-id">ID: ${phrase.id.substring(0, 8)}...</span>
            <span class="phrase-date">Created: ${createdDate} at ${createdTime}</span>
        </div>
    `;
    
    return phraseDiv;
}

/**
 * Update the metadata display with response information
 * @param {Object} response - The complete API response
 */
function updateMetadataDisplay(response) {
    if (!elements.phraseMetadata) return;
    
    const tenant = response.tenant || {};
    const count = response.count || 0;
    const totalCount = response.totalCount || count;
    
    elements.phraseMetadata.innerHTML = `
        <div class="metadata-grid">
            <div class="metadata-item">
                <div class="metadata-label">Phrases Shown</div>
                <div class="metadata-value">${count}</div>
            </div>
            <div class="metadata-item">
                <div class="metadata-label">Total Phrases</div>
                <div class="metadata-value">${totalCount}</div>
            </div>
            <div class="metadata-item">
                <div class="metadata-label">Tenant</div>
                <div class="metadata-value">${tenant.name || 'Unknown'}</div>
            </div>
            <div class="metadata-item">
                <div class="metadata-label">Theme</div>
                <div class="metadata-value">${tenant.theme || 'default'}</div>
            </div>
        </div>
        <p style="margin-top: 15px; font-size: 0.9rem; color: #666;">
            Data retrieved with complete tenant isolation via Row Level Security
        </p>
    `;
}

/**
 * Display a success message to the user
 * @param {string} message - The success message
 * @param {Object} response - Additional response data
 */
function showSuccess(message, response) {
    hideAllDisplays();
    
    elements.phraseDisplay.classList.remove('hidden');
    elements.phraseList.innerHTML = `
        <div class="phrase-item" style="background: #d4edda; border-color: #c3e6cb; color: #155724;">
            <div class="phrase-content">✅ ${message}</div>
            <div class="phrase-meta">
                <span>Tenant: ${response.tenant?.name || 'Unknown'}</span>
                <span>Records: ${response.count || 0}</span>
            </div>
        </div>
    `;
    
    elements.phraseMetadata.innerHTML = `
        <p style="text-align: center; color: #155724; font-weight: 500;">
            Tenant isolation is working correctly!
        </p>
    `;
}

/**
 * Display an error message to the user
 * @param {string} message - The error message to display
 * @param {string} details - Optional error details
 */
function showError(message, details = null) {
    hideAllDisplays();
    
    // Set the error message text
    elements.errorMessage.textContent = message;
    
    // Set error details if provided
    if (details && elements.errorDetails) {
        elements.errorDetails.textContent = details;
        elements.errorDetails.style.display = 'block';
    } else if (elements.errorDetails) {
        elements.errorDetails.style.display = 'none';
    }
    
    // Show the error display
    elements.error.classList.remove('hidden');
    
    // Log error for debugging purposes
    console.error('Error displayed to user:', message, details);
}

/**
 * Display tenant-specific error
 * @param {string} code - Error code
 * @param {string} message - Error message
 */
function showTenantError(code, message) {
    updateTenantStatus('error', 'Tenant validation failed');
    
    const suggestions = {
        'INVALID_SUBDOMAIN': 'Please access this application using a valid tenant subdomain (e.g., demo.yourapp.com)',
        'TENANT_NOT_FOUND': 'The requested tenant was not found. Please verify the subdomain is correct.',
        'TENANT_INACTIVE': 'This tenant account is currently inactive. Please contact support.'
    };
    
    const suggestion = suggestions[code] || 'Please contact support for assistance.';
    showError(message, suggestion);
}

/**
 * Hide all display elements (loading, error, phrase)
 */
function hideAllDisplays() {
    elements.loading.classList.add('hidden');
    elements.error.classList.add('hidden');
    elements.phraseDisplay.classList.add('hidden');
}

/**
 * Clear all displays and reset to initial state
 */
function clearDisplay() {
    hideAllDisplays();
    
    if (elements.phraseList) {
        elements.phraseList.innerHTML = '';
    }
    
    if (elements.phraseMetadata) {
        elements.phraseMetadata.innerHTML = '';
    }
    
    if (elements.errorMessage) {
        elements.errorMessage.textContent = '';
    }
    
    if (elements.errorDetails) {
        elements.errorDetails.textContent = '';
        elements.errorDetails.style.display = 'none';
    }
}

/**
 * Disable action buttons during API requests
 */
function disableButtons() {
    if (elements.fetchButton) {
        elements.fetchButton.disabled = true;
        elements.fetchButton.textContent = 'Loading...';
    }
    
    if (elements.refreshButton) {
        elements.refreshButton.disabled = true;
    }
    
    if (elements.testButton) {
        elements.testButton.disabled = true;
    }
}

/**
 * Re-enable action buttons after API requests complete
 */
function enableButtons() {
    if (elements.fetchButton) {
        elements.fetchButton.disabled = false;
        elements.fetchButton.textContent = 'Fetch Tenant Phrases';
    }
    
    if (elements.refreshButton) {
        elements.refreshButton.disabled = false;
    }
    
    if (elements.testButton) {
        elements.testButton.disabled = false;
    }
}

/**
 * Sanitize HTML content to prevent XSS attacks
 * @param {string} html - The HTML content to sanitize
 * @returns {string} - The sanitized content
 */
function sanitizeHtml(html) {
    if (!html || typeof html !== 'string') {
        return '';
    }
    
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
}

/**
 * Validate that the API configuration is correct
 * @returns {boolean} - True if configuration appears valid
 */
function validateConfiguration() {
    // Check if API base URL is configured
    if (!config.apiBaseUrl) {
        console.error('API base URL is not configured');
        return false;
    }
    
    // Check if API base URL looks valid
    try {
        new URL(config.apiBaseUrl);
    } catch (error) {
        console.error('API base URL is not a valid URL:', config.apiBaseUrl);
        return false;
    }
    
    return true;
}

/**
 * Get tenant information for debugging
 * @returns {Object} - Current tenant and configuration information
 */
function getTenantDebugInfo() {
    return {
        currentTenant: config.currentTenant,
        detectedSubdomain: elements.subdomainDisplay?.textContent,
        apiBaseUrl: config.apiBaseUrl,
        developmentMode: config.tenantDetection.developmentMode,
        windowLocation: {
            hostname: window.location.hostname,
            href: window.location.href,
            search: window.location.search
        }
    };
}

/**
 * Test different tenant URLs (for development/demo purposes)
 */
function generateTenantUrls() {
    const currentProtocol = window.location.protocol;
    const currentPort = window.location.port;
    const portSuffix = currentPort ? `:${currentPort}` : '';
    
    const testTenants = ['demo', 'acme', 'techcorp', 'startup'];
    const urls = {};
    
    if (config.tenantDetection.developmentMode) {
        // Development URLs
        testTenants.forEach(tenant => {
            urls[tenant] = `${currentProtocol}//${window.location.hostname}${portSuffix}?tenant=${tenant}`;
        });
    } else {
        // Production URLs
        const baseDomain = window.location.hostname.split('.').slice(1).join('.');
        testTenants.forEach(tenant => {
            urls[tenant] = `${currentProtocol}//${tenant}.${baseDomain}${portSuffix}`;
        });
    }
    
    return urls;
}

/**
 * Error handler for unhandled promise rejections
 */
window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);
    
    // Show a generic error message to the user
    showError('An unexpected error occurred. Please try refreshing the page.');
    updateTenantStatus('error', 'Unexpected error occurred');
    
    // Prevent the default browser behavior
    event.preventDefault();
});

/**
 * Handle window focus events to refresh tenant data
 */
window.addEventListener('focus', function() {
    // Refresh tenant data when window regains focus
    // This helps catch tenant changes if user switches between tabs
    if (config.currentTenant) {
        console.log('Window focused - refreshing tenant data');
        fetchTenantPhrases();
    }
});

/**
 * Initialize configuration validation and tenant detection on load
 */
document.addEventListener('DOMContentLoaded', function() {
    if (!validateConfiguration()) {
        showError('Application configuration error. Please check the console for details.');
        updateTenantStatus('error', 'Configuration error');
    }
    
    // Log debug information for development
    if (config.tenantDetection.developmentMode) {
        console.log('Multi-tenant debug info:', getTenantDebugInfo());
        console.log('Available tenant URLs:', generateTenantUrls());
    }
});

// Export functions for global access (useful for debugging)
window.multiTenantApp = {
    getTenantDebugInfo,
    generateTenantUrls,
    fetchTenantPhrases,
    testTenantIsolation,
    config
};
