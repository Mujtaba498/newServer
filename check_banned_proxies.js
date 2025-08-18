const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

// Parse proxy list from environment
const PROXY_LIST = process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',').map(p => p.trim()) : [];

const BINANCE_TEST_URL = 'https://api.binance.com/api/v3/exchangeInfo';
const REQUEST_TIMEOUT = 10000; // 10 seconds

async function testProxy(proxyUrl, index) {
    try {
        console.log(`\n🔍 Testing proxy [${index}] ${proxyUrl}...`);
        
        // Create proxy agents
        const httpsAgent = new HttpsProxyAgent(proxyUrl);
        
        // Make request through proxy
        const response = await axios.get(BINANCE_TEST_URL, {
            httpsAgent,
            proxy: false, // Disable axios proxy in favor of agent
            timeout: REQUEST_TIMEOUT,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        console.log(`✅ Proxy [${index}] ${proxyUrl} - Status: ${response.status}`);
        return { index, proxyUrl, status: 'working', httpStatus: response.status };
        
    } catch (error) {
        const status = error.response?.status;
        const statusText = error.response?.statusText || error.message;
        
        if (status === 451) {
            console.log(`🚫 Proxy [${index}] ${proxyUrl} - BANNED IN REGION (451)`);
            return { index, proxyUrl, status: 'banned_region', httpStatus: 451, error: statusText };
        } else if (status === 403) {
            console.log(`🚫 Proxy [${index}] ${proxyUrl} - FORBIDDEN (403)`);
            return { index, proxyUrl, status: 'forbidden', httpStatus: 403, error: statusText };
        } else if (status === 429) {
            console.log(`⚠️ Proxy [${index}] ${proxyUrl} - RATE LIMITED (429)`);
            return { index, proxyUrl, status: 'rate_limited', httpStatus: 429, error: statusText };
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
            console.log(`❌ Proxy [${index}] ${proxyUrl} - CONNECTION FAILED (${error.code})`);
            return { index, proxyUrl, status: 'connection_failed', error: error.code };
        } else {
            console.log(`❓ Proxy [${index}] ${proxyUrl} - OTHER ERROR: ${status || error.code} - ${statusText}`);
            return { index, proxyUrl, status: 'other_error', httpStatus: status, error: statusText || error.code };
        }
    }
}

async function checkAllProxies() {
    console.log(`🚀 Starting proxy check for ${PROXY_LIST.length} proxies...\n`);
    
    if (PROXY_LIST.length === 0) {
        console.log('❌ No proxies found in PROXY_LIST environment variable');
        return;
    }
    
    const results = [];
    const bannedProxies = [];
    const workingProxies = [];
    const failedProxies = [];
    
    // Test each proxy
    for (let i = 0; i < PROXY_LIST.length; i++) {
        const result = await testProxy(PROXY_LIST[i], i);
        results.push(result);
        
        if (result.status === 'banned_region') {
            bannedProxies.push(result);
        } else if (result.status === 'working') {
            workingProxies.push(result);
        } else {
            failedProxies.push(result);
        }
        
        // Small delay between requests to avoid overwhelming
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Summary report
    console.log('\n' + '='.repeat(60));
    console.log('📊 PROXY CHECK SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total proxies tested: ${PROXY_LIST.length}`);
    console.log(`✅ Working proxies: ${workingProxies.length}`);
    console.log(`🚫 Banned in region (451): ${bannedProxies.length}`);
    console.log(`❌ Failed/Other errors: ${failedProxies.length}`);
    
    if (bannedProxies.length > 0) {
        console.log('\n🚫 PROXIES BANNED IN REGION (451):');
        console.log('-'.repeat(40));
        bannedProxies.forEach(proxy => {
            console.log(`[${proxy.index}] ${proxy.proxyUrl}`);
        });
    }
    
    if (workingProxies.length > 0) {
        console.log('\n✅ WORKING PROXIES:');
        console.log('-'.repeat(40));
        workingProxies.forEach(proxy => {
            console.log(`[${proxy.index}] ${proxy.proxyUrl}`);
        });
    }
    
    if (failedProxies.length > 0) {
        console.log('\n❌ FAILED PROXIES (Other Issues):');
        console.log('-'.repeat(40));
        failedProxies.forEach(proxy => {
            console.log(`[${proxy.index}] ${proxy.proxyUrl} - ${proxy.error}`);
        });
    }
    
    console.log('\n' + '='.repeat(60));
    
    return {
        total: PROXY_LIST.length,
        working: workingProxies,
        banned: bannedProxies,
        failed: failedProxies
    };
}

// Run the check
checkAllProxies()
    .then(results => {
        if (results && results.banned.length > 0) {
            console.log(`\n🎯 Found ${results.banned.length} proxies banned in region (451)`);
        } else {
            console.log('\n🎉 No proxies found with 451 errors!');
        }
    })
    .catch(error => {
        console.error('❌ Error during proxy check:', error);
    });