const { PROXY_LIST } = require('../config/env');
const { HttpsProxyAgent } = require('https-proxy-agent');

class ProxyManager {
  constructor() {
    this.rawProxies = this.parseProxyList(PROXY_LIST);
    this.proxies = this.rawProxies.map((url, idx) => ({
      id: idx,
      url,
      agent: new HttpsProxyAgent(url),
      lastErrorAt: null,
      cooldownUntil: 0,
      failCount: 0,
    }));
    this.userAssignments = new Map(); // userId -> { group: [proxyIds], index: 0 }
    this.defaultGroupSize = 1; // start with 1 proxy per user
    this.maxGroupSize = 2; // heavy users promoted to 2
    this.cooldownMs = 5 * 60 * 1000; // 5 minutes cooldown for failing proxy
    this.rateLimitThreshold = 3; // promotion threshold within window
    this.rateLimitWindowMs = 10 * 60 * 1000; // 10 min window
    this.userRateLimitEvents = new Map(); // userId -> [timestamps]
    
    console.log(`🔧 ProxyManager initialized with ${this.proxies.length} proxies`);
    this.logProxyPool();
  }

  parseProxyList(list) {
    if (!list) return [];
    return list
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  // Extract IP from proxy URL for logging
  extractIP(proxyUrl) {
    try {
      const url = new URL(proxyUrl);
      return url.hostname;
    } catch {
      return 'unknown';
    }
  }

  // Log proxy pool status
  logProxyPool() {
    console.log('📡 Available proxy IPs:');
    this.proxies.forEach((proxy, idx) => {
      const ip = this.extractIP(proxy.url);
      const status = this.isProxyUsable(proxy) ? '✅ Active' : '❌ Cooldown';
      console.log(`  [${idx}] ${ip} - ${status}`);
    });
  }

  // Choose initial proxy or rotate within group
  chooseForUser(userId) {
    const key = String(userId);
    let assignment = this.userAssignments.get(key);

    if (!assignment) {
      // Assign a sticky group (size 1 initially)
      assignment = {
        group: this.pickHealthyProxies(this.defaultGroupSize),
        index: 0,
      };
      this.userAssignments.set(key, assignment);
      
      // Log initial assignment
      const proxyId = assignment.group[assignment.index];
      const proxy = this.proxies[proxyId];
      const ip = this.extractIP(proxy.url);
      console.log(`🔗 User ${userId} assigned to proxy [${proxyId}] ${ip}`);
    }

    // Rotate to next healthy proxy if current is cooling down
    const startIndex = assignment.index;
    for (let i = 0; i < assignment.group.length; i++) {
      const idx = (startIndex + i) % assignment.group.length;
      const proxy = this.proxies[assignment.group[idx]];
      if (this.isProxyUsable(proxy)) {
        assignment.index = idx;
        
        // Log if we switched to a different proxy
        if (i > 0) {
          const ip = this.extractIP(proxy.url);
          console.log(`🔄 User ${userId} rotated to proxy [${assignment.group[idx]}] ${ip}`);
        }
        
        return this.buildProxyConfig(proxy);
      }
    }

    // If no healthy proxy in group, pick a new healthy one from pool and replace current index
    const replacement = this.pickHealthyProxies(1)[0];
    if (replacement !== undefined) {
      assignment.group[assignment.index] = replacement;
      const proxy = this.proxies[replacement];
      const ip = this.extractIP(proxy.url);
      console.log(`🆘 User ${userId} switched to replacement proxy [${replacement}] ${ip}`);
      return this.buildProxyConfig(proxy);
    }

    console.log(`⚠️ No proxy available for user ${userId}`);
    return null; // No proxy available
  }

  pickHealthyProxies(n) {
    const now = Date.now();
    const healthy = this.proxies
      .map((p, i) => ({ i, p }))
      .filter(({ p }) => !p.cooldownUntil || p.cooldownUntil <= now);

    if (healthy.length === 0) return [];

    // Simple round-robin selection across pool
    const result = [];
    let start = Math.floor(Math.random() * healthy.length);
    for (let k = 0; k < n; k++) {
      result.push(healthy[(start + k) % healthy.length].i);
    }
    return result;
  }

  isProxyUsable(proxy) {
    return !proxy.cooldownUntil || proxy.cooldownUntil <= Date.now();
  }

  // Build config to be used by axios and ws
  buildProxyConfig(proxy) {
    return {
      url: proxy.url,
      agent: proxy.agent,
      httpAgent: proxy.agent,
      httpsAgent: proxy.agent,
    };
  }

  // Report events to influence health and assignment
  reportEvent(userId, event) {
    const { type, status } = event; // type: 'rest-error' | 'ws-error' | 'rate-limit'
    const assignment = this.userAssignments.get(String(userId));
    const proxyId = assignment?.group[assignment.index];
    const ip = proxyId !== undefined ? this.extractIP(this.proxies[proxyId].url) : 'unknown';
    
    if (type === 'rate-limit' || status === 418 || status === 429) {
      console.log(`⚠️ Rate limit detected for user ${userId} on proxy [${proxyId}] ${ip} (status: ${status})`);
      this.noteUserRateLimit(userId);
      this.cooldownCurrentProxy(userId);
      this.maybePromoteUserGroup(userId);
    }
    if (type === 'rest-error' || type === 'ws-error') {
      if (status === 451) {
        // HTTP 451: Unavailable For Legal Reasons (banned region)
        console.log(`🚫 Proxy IP banned in region for user ${userId} on [${proxyId}] ${ip} (status: 451)`);
        this.cooldownCurrentProxy(userId, 15 * 60 * 1000); // 15 minute cooldown for banned regions
      } else if (status === 503 || status === 'timeout') {
        console.log(`🚫 Proxy error for user ${userId} on [${proxyId}] ${ip}: ${status}`);
        this.cooldownCurrentProxy(userId, 2 * 60 * 1000);
      }
    }
  }

  cooldownCurrentProxy(userId, customMs = null) {
    const key = String(userId);
    const assignment = this.userAssignments.get(key);
    if (!assignment) return;
    const proxyId = assignment.group[assignment.index];
    const p = this.proxies[proxyId];
    const ms = customMs || this.cooldownMs;
    p.cooldownUntil = Date.now() + ms;
    p.failCount += 1;
    
    const ip = this.extractIP(p.url);
    const cooldownMinutes = Math.round(ms / 60000);
    console.log(`❄️ Proxy [${proxyId}] ${ip} cooled down for ${cooldownMinutes} minutes (fail count: ${p.failCount})`);
  }

  noteUserRateLimit(userId) {
    const key = String(userId);
    const now = Date.now();
    const arr = this.userRateLimitEvents.get(key) || [];
    arr.push(now);
    // remove out-of-window
    const cutoff = now - this.rateLimitWindowMs;
    while (arr.length && arr[0] < cutoff) arr.shift();
    this.userRateLimitEvents.set(key, arr);
  }

  maybePromoteUserGroup(userId) {
    const key = String(userId);
    const events = this.userRateLimitEvents.get(key) || [];
    if (events.length >= this.rateLimitThreshold) {
      const assignment = this.userAssignments.get(key);
      if (assignment && assignment.group.length < this.maxGroupSize) {
        const needed = this.maxGroupSize - assignment.group.length;
        const add = this.pickHealthyProxies(needed);
        if (add.length) {
          assignment.group.push(...add);
          console.log(`📈 User ${userId} promoted to ${assignment.group.length} proxies due to rate limiting`);
        }
      }
    }
  }

  // Get current proxy assignments for debugging
  getAssignmentStatus() {
    const status = {
      totalProxies: this.proxies.length,
      activeUsers: this.userAssignments.size,
      assignments: []
    };

    this.userAssignments.forEach((assignment, userId) => {
      const currentProxyId = assignment.group[assignment.index];
      const proxy = this.proxies[currentProxyId];
      const ip = this.extractIP(proxy.url);
      status.assignments.push({
        userId,
        proxyId: currentProxyId,
        ip,
        groupSize: assignment.group.length,
        isHealthy: this.isProxyUsable(proxy)
      });
    });

    return status;
  }
}

module.exports = new ProxyManager();