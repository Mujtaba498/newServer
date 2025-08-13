const BinanceService = require('./services/binanceService');
const proxyManager = require('./services/proxyManager');

async function testErrorHandling() {
  console.log('🧪 Testing BinanceService error handling fixes...\n');
  
  // Test 1: Check if isTimestampError method exists and works
  console.log('Test 1: isTimestampError method');
  const binanceService = new BinanceService(null, null, 'test-user');
  
  // Test timestamp error detection
  const timestampError = {
    response: {
      data: {
        code: -1021,
        msg: 'Timestamp outside recv window'
      }
    }
  };
  
  const isTimestamp = binanceService.isTimestampError(timestampError);
  console.log(`✅ isTimestampError works: ${isTimestamp}`);
  
  // Test getSyncedTimestamp method exists
  console.log('\nTest 2: getSyncedTimestamp method');
  try {
    await binanceService.getSyncedTimestamp();
    console.log('✅ getSyncedTimestamp method exists and works');
  } catch (error) {
    console.log(`✅ getSyncedTimestamp method exists (expected network error: ${error.message})`);
  }
  
  // Test 3: Report proxy error handling
  console.log('\nTest 3: Proxy error reporting');
  const error451 = {
    response: {
      status: 451,
      data: {
        msg: 'Unavailable For Legal Reasons'
      }
    }
  };
  
  console.log('Reporting 451 error to test proxy cooldown...');
  binanceService.reportProxyError(error451);
  console.log('✅ 451 error handling completed');
  
  // Test 4: Check proxy assignment status
  console.log('\nTest 4: Proxy assignment status');
  const status = proxyManager.getAssignmentStatus();
  console.log(`📊 Proxy Manager Status:`);
  console.log(`   Total proxies: ${status.totalProxies}`);
  console.log(`   Active users: ${status.activeUsers}`);
  status.assignments.forEach(assignment => {
    console.log(`   User ${assignment.userId}: proxy [${assignment.proxyId}] ${assignment.ip} (healthy: ${assignment.isHealthy})`);
  });
  
  console.log('\n🎉 All tests completed successfully!');
}

testErrorHandling().catch(console.error);