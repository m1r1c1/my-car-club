// Tenant Resolution Middleware
// This middleware handles subdomain-based tenant identification and validation

import { createClient } from '@supabase/supabase-js';

/**
 * Initialize Supabase client for tenant operations
 * Uses service role key for administrative tenant lookup operations
 */
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

/**
 * Cache for tenant lookups to improve performance
 * Stores tenant information temporarily to avoid repeated database queries
 */
const tenantCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

/**
 * Extract subdomain from request headers
 * Supports various hosting scenarios and development environments
 * @param {Object} req - The HTTP request object
 * @returns {string|null} - The extracted subdomain or null if not found
 */
function extractSubdomain(req) {
    // Get the host header from the request
    const host = req.headers.host || req.headers['x-forwarded-host'];
    
    if (!host) {
        console.warn('No host header found in request');
        return null;
    }
    
    // Handle different environments and configurations
    const hostname = host.split(':')[0]; // Remove port if present
    const parts = hostname.split('.');
    
    // For development (localhost), check for test subdomains
    if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
        // Support localhost testing with format: subdomain-localhost:3000
        const dashIndex = hostname.indexOf('-');
        if (dashIndex > 0) {
            return hostname.substring(0, dashIndex);
        }
        // For local development, allow query parameter override
        return req.query?.tenant || 'demo';
    }
    
    // For production domains (e.g., acme.yourapp.com)
    if (parts.length >= 3) {
        const subdomain = parts[0];
        
        // Exclude common non-tenant subdomains
        if (['www', 'api', 'admin', 'app'].includes(subdomain.toLowerCase())) {
            return null;
        }
        
        return subdomain;
    }
    
    // No subdomain found
    return null;
}

/**
 * Validate subdomain format
 * Ensures subdomain meets security and format requirements
 * @param {string} subdomain - The subdomain to validate
 * @returns {boolean} - True if subdomain is valid, false otherwise
 */
function isValidSubdomain(subdomain) {
    if (!subdomain || typeof subdomain !== 'string') {
        return false;
    }
    
    // Check length constraints
    if (subdomain.length < 2 || subdomain.length > 50) {
        return false;
    }
    
    // Check format: alphanumeric and hyphens only, no leading/trailing hyphens
    const subdomainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
    if (!subdomainRegex.test(subdomain)) {
        return false;
    }
    
    // Check for reserved subdomains
    const reservedSubdomains = [
        'www', 'api', 'admin', 'app', 'mail', 'ftp', 'blog',
        'support', 'help', 'docs', 'status', 'cdn', 'assets'
    ];
    
    if (reservedSubdomains.includes(subdomain.toLowerCase())) {
        return false;
    }
    
    return true;
}

/**
 * Get tenant information from cache or database
 * Implements caching strategy to improve performance
 * @param {string} subdomain - The subdomain to look up
 * @returns {Object|null} - Tenant information or null if not found
 */
async function getTenantInfo(subdomain) {
    // Check cache first
    const cacheKey = `tenant:${subdomain}`;
    const cached = tenantCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.data;
    }
    
    try {
        // Query database for tenant information
        const { data, error } = await supabase
            .rpc('get_tenant_by_subdomain', { subdomain_param: subdomain });
        
        if (error) {
            console.error('Database error in tenant lookup:', error);
            return null;
        }
        
        // Check if tenant was found and is active
        if (!data || data.length === 0) {
            // Cache negative result to prevent repeated lookups
            tenantCache.set(cacheKey, {
                data: null,
                timestamp: Date.now()
            });
            return null;
        }
        
        const tenant = data[0];
        
        // Validate tenant status
        if (tenant.tenant_status !== 'active') {
            console.warn(`Tenant ${subdomain} is not active: ${tenant.tenant_status}`);
            return null;
        }
        
        // Prepare tenant information object
        const tenantInfo = {
            id: tenant.tenant_id,
            subdomain: subdomain,
            name: tenant.tenant_name,
            status: tenant.tenant_status,
            settings: tenant.tenant_settings || {}
        };
        
        // Cache the result
        tenantCache.set(cacheKey, {
            data: tenantInfo,
            timestamp: Date.now()
        });
        
        return tenantInfo;
        
    } catch (error) {
        console.error('Error looking up tenant:', error);
        return null;
    }
}

/**
 * Set tenant context in database session
 * This enables Row Level Security policies to filter data by tenant
 * @param {string} tenantId - The tenant UUID to set as context
 */
async function setTenantContext(tenantId) {
    try {
        // Set tenant context for RLS policies
        const { error } = await supabase
            .rpc('set_tenant_context', { tenant_uuid: tenantId });
        
        if (error) {
            console.error('Error setting tenant context:', error);
            throw new Error('Failed to set tenant context');
        }
        
    } catch (error) {
        console.error('Error in setTenantContext:', error);
        throw error;
    }
}

/**
 * Main tenant middleware function
 * Resolves tenant from subdomain and sets up tenant context for the request
 * @param {Object} req - The HTTP request object
 * @param {Object} res - The HTTP response object
 * @param {Function} next - The next middleware function (for Express-style middleware)
 * @returns {Object|void} - Tenant information or void if used as middleware
 */
export async function resolveTenant(req, res, next = null) {
    try {
        // Extract subdomain from request
        const subdomain = extractSubdomain(req);
        
        if (!subdomain) {
            const error = {
                code: 'INVALID_SUBDOMAIN',
                message: 'No valid subdomain found in request',
                details: 'Please access the application using a valid tenant subdomain (e.g., acme.yourapp.com)'
            };
            
            if (next) {
                req.tenantError = error;
                return next();
            }
            return { error, tenant: null };
        }
        
        // Validate subdomain format
        if (!isValidSubdomain(subdomain)) {
            const error = {
                code: 'INVALID_SUBDOMAIN_FORMAT',
                message: 'Invalid subdomain format',
                details: 'Subdomain must be 2-50 characters, alphanumeric with hyphens allowed'
            };
            
            if (next) {
                req.tenantError = error;
                return next();
            }
            return { error, tenant: null };
        }
        
        // Get tenant information from database
        const tenant = await getTenantInfo(subdomain);
        
        if (!tenant) {
            const error = {
                code: 'TENANT_NOT_FOUND',
                message: 'Tenant not found or inactive',
                details: `No active tenant found for subdomain: ${subdomain}`
            };
            
            if (next) {
                req.tenantError = error;
                return next();
            }
            return { error, tenant: null };
        }
        
        // Set tenant context in database for RLS
        await setTenantContext(tenant.id);
        
        // Add tenant information to request object
        if (next) {
            req.tenant = tenant;
            req.tenantError = null;
            return next();
        }
        
        return { error: null, tenant };
        
    } catch (error) {
        console.error('Error in tenant resolution middleware:', error);
        
        const tenantError = {
            code: 'TENANT_RESOLUTION_ERROR',
            message: 'Error resolving tenant',
            details: 'An internal error occurred while resolving tenant information'
        };
        
        if (next) {
            req.tenantError = tenantError;
            return next();
        }
        
        return { error: tenantError, tenant: null };
    }
}

/**
 * Clear tenant cache for a specific subdomain
 * Useful for cache invalidation when tenant information changes
 * @param {string} subdomain - The subdomain to clear from cache
 */
export function clearTenantCache(subdomain) {
    const cacheKey = `tenant:${subdomain}`;
    tenantCache.delete(cacheKey);
}

/**
 * Clear all tenant cache
 * Useful for bulk cache invalidation
 */
export function clearAllTenantCache() {
    tenantCache.clear();
}

/**
 * Get cache statistics for monitoring
 * @returns {Object} - Cache statistics including size and hit rates
 */
export function getTenantCacheStats() {
    return {
        size: tenantCache.size,
        keys: Array.from(tenantCache.keys())
    };
}

/**
 * Express-style middleware wrapper
 * Use this when integrating with Express.js applications
 */
export const tenantMiddleware = (req, res, next) => {
    return resolveTenant(req, res, next);
};

/**
 * Validate that a request has proper tenant context
 * Use this as a guard in API endpoints
 * @param {Object} req - The HTTP request object
 * @returns {boolean} - True if tenant context is valid
 */
export function hasValidTenantContext(req) {
    return req.tenant && req.tenant.id && !req.tenantError;
}

/**
 * Get tenant-specific configuration
 * Merges default configuration with tenant-specific settings
 * @param {Object} tenant - The tenant object
 * @param {Object} defaultConfig - Default configuration object
 * @returns {Object} - Merged configuration
 */
export function getTenantConfig(tenant, defaultConfig = {}) {
    if (!tenant || !tenant.settings) {
        return defaultConfig;
    }
    
    return {
        ...defaultConfig,
        ...tenant.settings
    };
}
