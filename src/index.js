/**
 * Cloudflare Worker to proxy LLM API requests following OpenAI's API specification
 */

// Import the Durable Object class
import { LLMProxyStorage } from './storage.js';

// Export the Durable Object class
export { LLMProxyStorage };

// Main handler for all incoming requests
export default {
  async fetch(request, env, ctx) {
    try {
      // Enforce HTTPS in production
      if (env.ENVIRONMENT === 'production') {
        const url = new URL(request.url);
        if (url.protocol !== 'https:') {
          return new Response('Please use HTTPS', { status: 403 });
        }
      }
      
      // Get the URL and determine the API endpoint
      const url = new URL(request.url);
      const pathname = url.pathname;
      
      // Handle requests to the Durable Object
      if (pathname.startsWith('/api/storage')) {
        // Route to the Durable Object
        return await this.handleStorageRequest(request, env, ctx);
      }
      
      // Handle admin interface requests
      if (pathname === '/admin' || pathname === '/admin/') {
        return await this.serveAdminInterface(request, env, ctx);
      }
      
      // Handle admin API requests
      if (pathname.startsWith('/admin/')) {
        // Verify authentication for admin API requests
        if (!(await this.verifyAdminAuth(request, env))) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }) , {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        // Route to the admin API
        return await this.handleAdminApi(request, env, ctx);
      }
      
      // Handle CORS preflight requests
      if (request.method === 'OPTIONS') {
        return this.handleOptions(request);
      }

      // Only allow POST requests for API endpoints (except for health check)
      if (request.method !== 'POST' && request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Handle health check endpoint
      if (request.method === 'GET') {
        if (pathname === '/' || pathname === '/health') {
          return new Response(JSON.stringify({ status: 'OK', message: 'LLM Proxy API is running' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } else {
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Handle different OpenAI API endpoints
      if (pathname === '/v1/chat/completions') {
        return await this.handleChatCompletion(request, env, ctx);
      } else if (pathname === '/v1/completions') {
        return await this.handleCompletions(request, env, ctx);
      } else if (pathname === '/v1/embeddings') {
        return await this.handleEmbeddings(request, env, ctx);
      } else {
        return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (error) {
      console.error('Error in main handler:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
  
  // Handle requests to the Durable Object
  async handleStorageRequest(request, env, ctx) {
    // Get the Durable Object stub
    const id = env.LLM_PROXY_STORAGE.idFromName('llm-proxy-storage');
    const stub = env.LLM_PROXY_STORAGE.get(id);
    
    // Rewrite the URL to remove the /api/storage prefix
    const url = new URL(request.url);
    url.pathname = url.pathname.replace('/api/storage', '');
    
    // Create a new request with the rewritten URL
    const newRequest = new Request(url.toString(), request);
    
    // Forward the request to the Durable Object
    return await stub.fetch(newRequest);
  },
  
  // Serve the admin interface
  async serveAdminInterface(request, env, ctx) {
    // Serve the admin HTML file
    const html = await this.getAdminHtml(env);
    return new Response(html, {
      headers: { 
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
      }
    });
  },
  
  // Get admin HTML content
  async getAdminHtml(env) {
    try {
      // Use the environment variable to locate the admin.html file
      const adminHtmlPath = env.ADMIN_HTML_PATH || 'src/admin.html';

      // Fetch the admin.html file content
      const response = await fetch(adminHtmlPath);
      if (response.ok) {
        return await response.text();
      } else {
        console.error('Failed to fetch admin.html:', response.statusText);
      }
    } catch (error) {
      console.error('Error fetching admin.html:', error);
    }

    // Fallback: Return a simple admin interface if we can't load the file
    return `<!DOCTYPE html>
<html>
<head>
    <title>LLM API Proxy Admin</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <div id="app">
        <h1>LLM API Proxy Admin</h1>
        <p>Admin interface is available but the admin.html file could not be loaded.</p>
        <p>Please check the worker configuration or serve the admin interface from a CDN.</p>
    </div>
</body>
</html>`;
  },
  
  // Handle admin API requests
  async handleAdminApi(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace('/admin', '');
    
    // Handle test connection endpoint
    if (pathname === '/test-connection' && request.method === 'POST') {
      return await this.handleTestConnection(request, env, ctx);
    }
    
    // Get the Durable Object stub
    const id = env.LLM_PROXY_STORAGE.idFromName('llm-proxy-storage');
    const stub = env.LLM_PROXY_STORAGE.get(id);
    
    // Rewrite the URL to match the Durable Object API
    url.pathname = `/api/storage${pathname}`;
    
    // Create a new request with the rewritten URL
    const newRequest = new Request(url.toString(), request);
    
    // Forward the request to the Durable Object
    return await stub.fetch(newRequest);
  },
  
  // Handle test connection request
  async handleTestConnection(request, env, ctx) {
    try {
      const data = await request.json();
      const targetApiUrl = data.targetApiUrl;
      
      if (!targetApiUrl) {
        return new Response(JSON.stringify({ error: 'Missing targetApiUrl' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Test connection by making a request to the target API
      // We'll try to get the model list as a test
      const testUrl = `${targetApiUrl}/v1/models`;
      
      // We only want to check if the connection can be established, not the actual response
      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'LLM-Proxy-API/1.0'
        }
      });
      
      // If we get a response (even an error response), the connection is working
      // OpenAI API returns 401 for missing/invalid API key, which is still a successful connection
      if (response.status === 401 || response.status === 403 || response.status === 404 || response.status >= 200) {
        return new Response(JSON.stringify({ 
          message: 'Connection successful',
          status: response.status
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        return new Response(JSON.stringify({ 
          error: 'Connection failed',
          status: response.status,
          statusText: response.statusText
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (error) {
      console.error('Test connection error:', error);
      return new Response(JSON.stringify({ 
        error: 'Connection failed',
        message: error.message 
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
  
  // Verify admin authentication
  async verifyAdminAuth(request, env) {
    // Get the authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return false;
    }
    
    // Check if it's a Bearer token
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return false;
    }
    
    // For now, we'll use a simple check against the ADMIN_PASSWORD environment variable
    // In a production environment, you should use a more secure method
    return token === env.ADMIN_PASSWORD || token === 'admin-token'; // 'admin-token' for demo purposes
  },
  
  // Handle CORS preflight requests
  handleOptions(request) {
    const headers = request.headers.get('Access-Control-Request-Headers');
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': headers || '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  },
  
  // Handle chat completions endpoint
  async handleChatCompletion(request, env, ctx) {
    // Record the start time for logging
    const startTime = Date.now();
    
    try {
      // Get the target API URL from environment variables or use default
      const targetApiUrl = await this.getTargetApiUrl(request, env);
      const targetUrl = `${targetApiUrl}/v1/chat/completions`;
      
      // Forward the request to the target API
      const response = await this.forwardRequest(request, targetUrl, env);
      
      // Record the end time
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Log the request (in a production environment, you might want to do this asynchronously)
      await this.logRequest(request, env, {
        endpoint: '/v1/chat/completions',
        targetApi: targetApiUrl,
        status: response.status,
        duration: duration,
        timestamp: new Date().toISOString()
      });
      
      return response;
    } catch (error) {
      // Record the end time
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Log the error request
      await this.logRequest(request, env, {
        endpoint: '/v1/chat/completions',
        targetApi: await this.getTargetApiUrl(request, env),
        status: 500,
        duration: duration,
        timestamp: new Date().toISOString(),
        error: error.message
      });
      
      throw error;
    }
  },
  
  // Handle completions endpoint
  async handleCompletions(request, env, ctx) {
    // Record the start time for logging
    const startTime = Date.now();
    
    try {
      // Get the target API URL from environment variables or use default
      const targetApiUrl = await this.getTargetApiUrl(request, env);
      const targetUrl = `${targetApiUrl}/v1/completions`;
      
      // Forward the request to the target API
      const response = await this.forwardRequest(request, targetUrl, env);
      
      // Record the end time
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Log the request
      await this.logRequest(request, env, {
        endpoint: '/v1/completions',
        targetApi: targetApiUrl,
        status: response.status,
        duration: duration,
        timestamp: new Date().toISOString()
      });
      
      return response;
    } catch (error) {
      // Record the end time
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Log the error request
      await this.logRequest(request, env, {
        endpoint: '/v1/completions',
        targetApi: await this.getTargetApiUrl(request, env),
        status: 500,
        duration: duration,
        timestamp: new Date().toISOString(),
        error: error.message
      });
      
      throw error;
    }
  },
  
  // Handle embeddings endpoint
  async handleEmbeddings(request, env, ctx) {
    // Record the start time for logging
    const startTime = Date.now();
    
    try {
      // Get the target API URL from environment variables or use default
      const targetApiUrl = await this.getTargetApiUrl(request, env);
      const targetUrl = `${targetApiUrl}/v1/embeddings`;
      
      // Forward the request to the target API
      const response = await this.forwardRequest(request, targetUrl, env);
      
      // Record the end time
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Log the request
      await this.logRequest(request, env, {
        endpoint: '/v1/embeddings',
        targetApi: targetApiUrl,
        status: response.status,
        duration: duration,
        timestamp: new Date().toISOString()
      });
      
      return response;
    } catch (error) {
      // Record the end time
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Log the error request
      await this.logRequest(request, env, {
        endpoint: '/v1/embeddings',
        targetApi: await this.getTargetApiUrl(request, env),
        status: 500,
        duration: duration,
        timestamp: new Date().toISOString(),
        error: error.message
      });
      
      throw error;
    }
  },
  
  // Get target API URL from request headers or environment variables
  async getTargetApiUrl(request, env) {
    // Check if target API URL is specified in request headers
    const targetApiUrlHeader = request.headers.get('x-target-api-url');
    if (targetApiUrlHeader) {
      // Remove trailing slash if present
      return targetApiUrlHeader.replace(/\/$/, '');
    }
    
    // Check if target API URL is stored in Durable Object
    try {
      const id = env.LLM_PROXY_STORAGE.idFromName('llm-proxy-storage');
      const stub = env.LLM_PROXY_STORAGE.get(id);
      
      const configResponse = await stub.fetch('http://llm-proxy-storage/api/storage/config');
      if (configResponse.ok) {
        const config = await configResponse.json();
        if (config.targetApiUrl) {
          return config.targetApiUrl.replace(/\/$/, '');
        }
      }
    } catch (error) {
      console.error('Error getting config from Durable Object:', error);
    }
    
    // Fall back to environment variables
    return (env.TARGET_API_URL || 'https://api.openai.com').replace(/\/$/, '');
  },
  
  // Forward request to target API
  async forwardRequest(request, targetUrl, env) {
    try {
      // Log the target URL for debugging
      if (env.DEBUG) {
        console.log(`Forwarding request to: ${targetUrl}`);
      }
      
      // Prepare headers for the target API request
      const headers = new Headers(request.headers);
      
      // Handle API key - check for custom header first, then environment variable
      const customApiKey = request.headers.get('x-target-api-key');
      const targetApiKey = customApiKey || env.TARGET_API_KEY;
      
      if (targetApiKey) {
        headers.set('Authorization', `Bearer ${targetApiKey}`);
      } else {
        // Log warning if no API key is provided
        console.warn('No API key provided for target API');
      }
      
      // Remove headers that might cause issues
      headers.delete('Host');
      headers.delete('Content-Length');
      headers.delete('x-target-api-url');
      headers.delete('x-target-api-key');
      
      // Add security headers
      headers.set('User-Agent', 'LLM-Proxy-API/1.0');
      
      // Create the request to the target API
      const targetRequest = new Request(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.body,
      });
      
      // Forward the request to the target API
      const response = await fetch(targetRequest);
      
      // Log response status for debugging
      if (env.DEBUG) {
        console.log(`Target API response status: ${response.status}`);
      }
      
      // Handle error responses from target API
      if (!response.ok) {
        console.error(`Target API error: ${response.status} ${response.statusText}`);
        
        // Try to parse error response from target API
        let errorBody;
        try {
          errorBody = await response.clone().text();
          const errorJson = JSON.parse(errorBody);
          console.error('Target API error details:', errorJson);
        } catch (parseError) {
          // If we can't parse JSON, log the raw response
          console.error('Target API error body:', errorBody || 'Unable to parse error response');
        }
      }
      
      // Create a new response with the target API's response
      const modifiedResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
      
      // Add CORS headers to the response
      modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');
      modifiedResponse.headers.set('X-Content-Type-Options', 'nosniff');
      
      return modifiedResponse;
    } catch (error) {
      console.error('Error forwarding request:', error);
      return new Response(JSON.stringify({ 
        error: 'Failed to forward request', 
        message: error.message 
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
  
  // Log request to Durable Object
  async logRequest(request, env, logData) {
    try {
      // Get the Durable Object stub
      const id = env.LLM_PROXY_STORAGE.idFromName('llm-proxy-storage');
      const stub = env.LLM_PROXY_STORAGE.get(id);
      
      // Send log data to the Durable Object
      await stub.fetch(new Request('http://llm-proxy-storage/api/storage/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logData)
      }));
    } catch (error) {
      console.error('Error logging request:', error);
    }
  }
};