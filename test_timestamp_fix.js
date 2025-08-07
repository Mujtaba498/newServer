const BinanceService = require('./services/binanceService');

// Test script to verify timestamp synchronization fix
async function testTimestampFix() {
  console.log('🔧 Testing Binance timestamp synchronization fix...');
  
  try {
    const binanceService = new BinanceService();
    
    console.log('📡 Testing server time sync...');
    const serverTime = await binanceService.getServerTime();
    console.log(`✅ Server time retrieved: ${new Date(serverTime).toISOString()}`);
    
    console.log('🔄 Testing synchronized timestamp...');
    const syncedTimestamp = await binanceService.getSyncedTimestamp();
    console.log(`✅ Synced timestamp: ${new Date(syncedTimestamp).toISOString()}`);
    console.log(`⏰ Time offset: ${binanceService.timeOffset}ms`);
    
    console.log('🏦 Testing account info with timestamp retry...');
    const accountInfo = await binanceService.getAccountInfo();
    console.log(`✅ Account info retrieved successfully`);
    console.log(`💰 Account has ${accountInfo.balances.length} assets`);
    
    console.log('📊 Testing open orders with timestamp retry...');
    // Test with a common trading pair
    try {
      const openOrders = await binanceService.getOpenOrders('BTCUSDT');
      console.log(`✅ Open orders retrieved: ${openOrders.length} orders`);
    } catch (error) {
      if (error.message.includes('Invalid symbol')) {
        console.log('ℹ️  BTCUSDT not available, trying ETHUSDT...');
        const openOrders = await binanceService.getOpenOrders('ETHUSDT');
        console.log(`✅ Open orders retrieved: ${openOrders.length} orders`);
      } else {
        throw error;
      }
    }
    
    console.log('\n🎉 All timestamp synchronization tests passed!');
    console.log('✅ The "Timestamp for this request is outside of the recvWindow" error should now be resolved.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.message.includes('Timestamp for this request is outside of the recvWindow')) {
      console.error('⚠️  The timestamp error still occurs. Please check:');
      console.error('   1. System clock synchronization');
      console.error('   2. Network latency');
      console.error('   3. Binance API key permissions');
    }
    
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testTimestampFix().catch(console.error);
}

module.exports = testTimestampFix;