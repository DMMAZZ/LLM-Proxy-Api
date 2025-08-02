/**
 * Durable Object for storing LLM Proxy configuration and request logs
 */
export class LLMProxyStorage {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // Handle HTTP requests from clients
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // Handle CORS preflight requests
      if (method === 'OPTIONS') {
        return this.handleOptions(request);
      }

      // Route requests based on path
      if (path.startsWith('/config')) {
        return this.handleConfig(request, method);
      } else if (path.startsWith('/logs')) {
        return this.handleLogs(request, method);
      } else if (path.startsWith('/stats')) {
        return this.handleStats(request, method);
      } else {
        return new Response('Not found', { status: 404 });
      }
    } catch (error) {
      console.error('Error in Durable Object:', error);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // Handle CORS preflight requests
  handleOptions(request) {
    const headers = request.headers.get('Access-Control-Request-Headers');
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': headers || '*',
      },
    });
  }

  // Handle configuration requests
  async handleConfig(request, method) {
    switch (method) {
      case 'GET':
        return await this.getConfig();
      case 'POST':
        const data = await request.json();
        return await this.setConfig(data);
      default:
        return new Response('Method not allowed', { status: 405 });
    }
  }

  // Handle logs requests
  async handleLogs(request, method) {
    switch (method) {
      case 'GET':
        const url = new URL(request.url);
        const limit = parseInt(url.searchParams.get('limit')) || 50;
        return await this.getLogs(limit);
      case 'POST':
        const logData = await request.json();
        return await this.addLog(logData);
      case 'DELETE':
        return await this.clearLogs();
      default:
        return new Response('Method not allowed', { status: 405 });
    }
  }

  // Handle stats requests
  async handleStats(request, method) {
    if (method === 'GET') {
      return await this.getStats();
    } else {
      return new Response('Method not allowed', { status: 405 });
    }
  }

  // Get configuration
  async getConfig() {
    // Retrieve configuration from storage
    const config = await this.state.storage.get('config') || {};
    return new Response(JSON.stringify(config), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Set configuration
  async setConfig(data) {
    // Validate input
    if (data.targetApiUrl && typeof data.targetApiUrl !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid targetApiUrl' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (data.adminPassword && typeof data.adminPassword !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid adminPassword' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get existing config
    const existingConfig = await this.state.storage.get('config') || {};

    // Update config
    const newConfig = {
      ...existingConfig,
      ...data,
      updatedAt: new Date().toISOString()
    };

    // Save to storage
    await this.state.storage.put('config', newConfig);

    return new Response(JSON.stringify(newConfig), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get logs
  async getLogs(limit) {
    // Get logs from storage (they are stored as an array)
    const logs = await this.state.storage.get('logs') || [];
    
    // Limit the number of logs returned
    const limitedLogs = logs.slice(-limit);
    
    return new Response(JSON.stringify(limitedLogs), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Add a log entry
  async addLog(logData) {
    // Validate input
    if (!logData.endpoint || !logData.timestamp) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get existing logs
    const logs = await this.state.storage.get('logs') || [];
    
    // Add new log entry
    const newLog = {
      id: this.generateId(),
      ...logData,
      timestamp: new Date().toISOString()
    };
    
    logs.push(newLog);
    
    // Keep only the last 1000 logs to prevent storage from growing too large
    if (logs.length > 1000) {
      logs.splice(0, logs.length - 1000);
    }
    
    // Save to storage
    await this.state.storage.put('logs', logs);
    
    return new Response(JSON.stringify(newLog), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Clear all logs
  async clearLogs() {
    await this.state.storage.put('logs', []);
    return new Response(JSON.stringify({ message: 'Logs cleared' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get statistics
  async getStats() {
    // Get configuration
    const config = await this.state.storage.get('config') || {};
    
    // Get logs
    const logs = await this.state.storage.get('logs') || [];
    
    // Calculate statistics
    const totalRequests = logs.length;
    
    // Calculate success rate
    const successfulRequests = logs.filter(log => log.status >= 200 && log.status < 300).length;
    const successRate = totalRequests > 0 ? Math.round((successfulRequests / totalRequests) * 100) : 0;
    
    // Calculate average response time
    const totalDuration = logs.reduce((sum, log) => sum + (log.duration || 0), 0);
    const avgResponseTime = totalRequests > 0 ? Math.round(totalDuration / totalRequests) : 0;
    
    const stats = {
      totalRequests,
      successRate,
      avgResponseTime,
      currentTarget: config.targetApiUrl || null,
      lastUpdated: config.updatedAt || null
    };
    
    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Generate a simple ID for log entries
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }
}