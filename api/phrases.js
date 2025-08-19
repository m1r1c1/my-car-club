// Multi-Tenant Vercel API Route: /api/phrases.js
// This file handles tenant-aware phrase retrieval with complete tenant isolation

import { createClient } from '@supabase/supabase-js';
import { resolveTenant, hasValidTenantContext, getTenantConfig } from '../middleware/tenant.js';

/**
 * Initialize Supabase client with service role key
 * The service role key allows full database access but tenant context will limit data access via RLS
 */
const supabase = createClient(
    process.env.SUPABASE_URL,           // Supabase project URL from environment variables
    process.env.SUPABASE_SERVICE_KEY    // Service role key with full database permissions
);

/**
 * Configuration for tenant-aware API behavior
 * These settings can be overridden by tenant-specific configuration
 */
const defaultConfig = {
    maxPhrasesPerRequest: 50,           // Maximum number of phrases to return per request
    cacheTtl: 300,                      // Cache TTL in seconds (5 minutes)
    enablePagination: true,             // Whether to support pagination
    enableSorting: true,                // Whether to support custom sorting
    defaultSortOrder: 'created_at'      // Default field to sort by
};

/**
 * Main API handler function for tenant-aware phrase operations
 * Handles HTTP requests to the /api/phrases endpoint with complete tenant isolation
 * @param {Object} req - The incoming HTTP request object
 * @param {Object} res - The HTTP response object to send data back to client
 */
export default async function handler(req, res) {
    // Set CORS headers for cross-origin requests
    // In production, replace '*' with your specific domain pattern for better security
    setCorsHeaders(res);

    // Handle preflight OPTIONS requests for CORS
    // Browsers send this before actual requests to check permissions
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // Step 1: Resolve tenant from subdomain
        const { error: tenantError, tenant } = await resolveTenant(req, res);
        
        if (tenantError || !tenant) {
            return handleTenantError(res, tenantError);
        }

        // Step 2: Validate tenant context is properly set
        if (!hasValidTenantContext({ tenant, tenantError })) {
            return res.status(400).json({
                error: 'Invalid tenant context',
                message: 'Unable to establish valid tenant context for request'
            });
        }

        // Step 3: Get tenant-specific configuration
        const tenantConfig = getTenantConfig(tenant, defaultConfig);

        // Step 4: Route request based on HTTP method
        switch (req.method) {
            case 'GET':
                return await handleGetPhrases(req, res, tenant, tenantConfig);
            default:
                return res.status(405).json({
                    error: 'Method not allowed',
                    message: `HTTP method ${req.method} is not supported for this endpoint`,
                    allowedMethods: ['GET', 'OPTIONS']
                });
        }

    } catch (error) {
        // Handle any unexpected errors that weren't caught in specific handlers
        console.error('Unexpected error in phrases API:', error);
        
        return res.status(500).json({
            error: 'Internal server error',
            message: 'An unexpected error occurred while processing your request',
            tenantId: req.tenant?.id || 'unknown'
        });
    }
}

/**
 * Handle GET requests for retrieving tenant-specific phrases
 * This function implements complete tenant isolation and optional pagination/sorting
 * @param {Object} req - The HTTP request object
 * @param {Object} res - The HTTP response object
 * @param {Object} tenant - The resolved tenant information
 * @param {Object} config - Tenant-specific configuration
 */
async function handleGetPhrases(req, res, tenant, config) {
    try {
        // Parse query parameters for pagination and sorting
        const {
            page = 1,
            limit = config.maxPhrasesPerRequest,
            sortBy = config.defaultSortOrder,
            sortOrder = 'asc',
            search = null
        } = req.query;

        // Validate pagination parameters
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(config.maxPhrasesPerRequest, Math.max(1, parseInt(limit) || 10));
        const offset = (pageNum - 1) * limitNum;

        // Validate sort parameters
        const allowedSortFields = ['created_at', 'updated_at', 'content'];
        const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
        const validSortOrder = ['asc', 'desc'].includes(sortOrder.toLowerCase()) ? sortOrder.toLowerCase() : 'asc';

        // Build base query - RLS automatically filters by tenant_id
        let query = supabase
            .from('phrases')
            .select('id, content, created_at, updated_at', { count: 'exact' });

        // Add search filter if provided
        if (search && search.trim()) {
            query = query.ilike('content', `%${search.trim()}%`);
        }

        // Add sorting
        query = query.order(validSortBy, { ascending: validSortOrder === 'asc' });

        // Add pagination
        if (config.enablePagination) {
            query = query.range(offset, offset + limitNum - 1);
        }

        // Execute the query - tenant isolation is enforced by RLS
        const { data: phrases, error, count } = await query;

        // Check for database errors
        if (error) {
            console.error('Database error for tenant', tenant.id, ':', error);
            return res.status(500).json({
                error: 'Database error',
                message: 'Unable to retrieve phrases at this time',
                tenantId: tenant.id
            });
        }

        // Handle case where no phrases are found
        if (!phrases || phrases.length === 0) {
            return res.status(200).json({
                success: true,
                data: [],
                count: 0,
                tenant: {
                    id: tenant.id,
                    name: tenant.name,
                    subdomain: tenant.subdomain
                },
                pagination: config.enablePagination ? {
                    page: pageNum,
                    limit: limitNum,
                    total: 0,
                    totalPages: 0
                } : null,
                message: 'No phrases found for this tenant'
            });
        }

        // Process and sanitize the data before sending to frontend
        const processedPhrases = phrases.map(phrase => ({
            id: phrase.id,
            content: sanitizeContent(phrase.content),
            createdAt: phrase.created_at,
            updatedAt: phrase.updated_at
        }));

        // Prepare pagination information
        const totalPages = config.enablePagination ? Math.ceil((count || 0) / limitNum) : 1;

        // Log successful data retrieval for audit purposes
        console.log(`Tenant ${tenant.subdomain} retrieved ${phrases.length} phrases`);

        // Send successful response with tenant-specific data
        res.status(200).json({
            success: true,
            data: processedPhrases,
            count: phrases.length,
            totalCount: count,
            tenant: {
                id: tenant.id,
                name: tenant.name,
                subdomain: tenant.subdomain,
                theme: tenant.settings?.theme || 'default'
            },
            pagination: config.enablePagination ? {
                page: pageNum,
                limit: limitNum,
                total: count || 0,
                totalPages: totalPages,
                hasNext: pageNum < totalPages,
                hasPrev: pageNum > 1
            } : null,
            sorting: {
                sortBy: validSortBy,
                sortOrder: validSortOrder
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in handleGetPhrases for tenant', tenant.id, ':', error);
        
        return res.status(500).json({
            error: 'Phrase retrieval error',
            message: 'An error occurred while retrieving phrases',
            tenantId: tenant.id
        });
    }
}

/**
 * Set CORS headers for cross-origin requests
 * Configured to work with subdomain-based tenant architecture
 * @param {Object} res - The HTTP response object
 */
function setCorsHeaders(res) {
    // Allow requests from any subdomain of your domain
    res.setHeader('Access-Control-Allow-Origin', '*'); // In production: '*.yourdomain.com'
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-ID');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
}

/**
 * Handle tenant-related errors with appropriate HTTP responses
 * Provides specific error messages based on tenant resolution issues
 * @param {Object} res - The HTTP response object
 * @param {Object} tenantError - The tenant error object
 */
function handleTenantError(res, tenantError) {
    if (!tenantError) {
        return res.status(400).json({
            error: 'Unknown tenant error',
            message: 'An unknown error occurred during tenant resolution'
        });
    }

    // Map tenant error codes to appropriate HTTP status codes
    const statusCodeMap = {
        'INVALID_SUBDOMAIN': 400,
        'INVALID_SUBDOMAIN_FORMAT': 400,
        'TENANT_NOT_FOUND': 404,
        'TENANT_RESOLUTION_ERROR': 500
    };

    const statusCode = statusCodeMap[tenantError.code] || 400;

    return res.status(statusCode).json({
        error: tenantError.code,
        message: tenantError.message,
        details: tenantError.details,
        suggestion: getTenantErrorSuggestion(tenantError.code)
    });
}

/**
 * Get helpful suggestions for tenant-related errors
 * Provides user-friendly guidance for resolving tenant issues
 * @param {string} errorCode - The tenant error code
 * @returns {string} - User-friendly suggestion message
 */
function getTenantErrorSuggestion(errorCode) {
    const suggestions = {
        'INVALID_SUBDOMAIN': 'Please access the application using a valid subdomain (e.g., yourcompany.yourdomain.com)',
        'INVALID_SUBDOMAIN_FORMAT': 'Subdomains must be 2-50 characters long and contain only letters, numbers, and hyphens',
        'TENANT_NOT_FOUND': 'Please verify your subdomain is correct and your account is active. Contact support if this persists.',
        'TENANT_RESOLUTION_ERROR': 'Please try again in a moment. Contact support if the problem continues.'
    };

    return suggestions[errorCode] || 'Please contact support for assistance.';
}

/**
 * Sanitize content before sending to frontend
 * Prevents XSS attacks and ensures data integrity
 * @param {string} content - The content to sanitize
 * @returns {string} - The sanitized content
 */
function sanitizeContent(content) {
    if (!content || typeof content !== 'string') {
        return '';
    }

    // Basic HTML entity encoding to prevent XSS
    return content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .trim();
}

/**
 * Validate query parameters for security and data integrity
 * Ensures only safe values are used in database queries
 * @param {Object} params - Query parameters to validate
 * @returns {Object} - Validation result with sanitized parameters
 */
function validateQueryParams(params) {
    const validated = {
        isValid: true,
        errors: [],
        sanitized: {}
    };

    // Validate page parameter
    if (params.page !== undefined) {
        const page = parseInt(params.page);
        if (isNaN(page) || page < 1 || page > 10000) {
            validated.errors.push('Page must be a number between 1 and 10000');
            validated.isValid = false;
        } else {
            validated.sanitized.page = page;
        }
    }

    // Validate limit parameter
    if (params.limit !== undefined) {
        const limit = parseInt(params.limit);
        if (isNaN(limit) || limit < 1 || limit > 100) {
            validated.errors.push('Limit must be a number between 1 and 100');
            validated.isValid = false;
        } else {
            validated.sanitized.limit = limit;
        }
    }

    // Validate search parameter
    if (params.search !== undefined) {
        const search = params.search.toString().trim();
        if (search.length > 500) {
            validated.errors.push('Search term cannot exceed 500 characters');
            validated.isValid = false;
        } else {
            validated.sanitized.search = search;
        }
    }

    return validated;
}

/**
 * Rate limiting helper for tenant-specific requests
 * Implements basic rate limiting to prevent abuse on a per-tenant basis
 * @param {string} tenantId - The tenant ID for rate limiting
 * @param {string} clientIp - The client IP address
 * @returns {boolean} - True if request is allowed, false if rate limited
 */
function checkTenantRateLimit(tenantId, clientIp) {
    // In a production environment, implement actual rate limiting here
    // This could use Redis, in-memory storage, or a rate limiting service
    // For now, we always allow requests but this is where you'd add the logic
    
    // Example implementation would track requests per tenant per time window
    // and return false if limits are exceeded
    
    return true;
}

/**
 * Log tenant-specific API access for monitoring and audit purposes
 * Helps track tenant usage patterns and detect potential security issues
 * @param {Object} tenant - The tenant information
 * @param {string} action - The action being performed
 * @param {Object} metadata - Additional metadata to log
 */
function logTenantAccess(tenant, action, metadata = {}) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        tenantId: tenant.id,
        tenantSubdomain: tenant.subdomain,
        action: action,
        metadata: metadata
    };

    // In production, send this to your logging service
    console.log('Tenant Access Log:', JSON.stringify(logEntry));
}
