const KimiAIService = require('./services/kimiAIService');

// Test the AI integration
async function testAIIntegration() {
  console.log('Testing Kimi AI Integration for Grid Bot Parameters...');
  
  const kimiAIService = new KimiAIService();
  
  try {
    // Test with BTCUSDT
    console.log('\n=== Testing BTCUSDT ===');
    const btcResult = await kimiAIService.analyzeGridBotParameters('BTCUSDT', 1000, 'BTC Grid Bot Test');
    console.log('BTC Result:', JSON.stringify(btcResult, null, 2));
    
    // Test with ETHUSDT
    console.log('\n=== Testing ETHUSDT ===');
    const ethResult = await kimiAIService.analyzeGridBotParameters('ETHUSDT', 500, 'ETH Grid Bot Test');
    console.log('ETH Result:', JSON.stringify(ethResult, null, 2));
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
if (require.main === module) {
  testAIIntegration();
}

module.exports = { testAIIntegration };