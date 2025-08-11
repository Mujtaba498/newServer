const webSocketManager = require('./services/webSocketManager');
const BinanceService = require('./services/binanceService');
const User = require('./models/User');
const connectDB = require('./config/database');

async function debugWebSocketConnections() {
  try {
    console.log('🔍 Starting WebSocket Connection Debug...');
    
    // Connect to database
    await connectDB();
    console.log('✅ Database connected');
    
    // Initialize WebSocket Manager
    webSocketManager.initialize();
    console.log('✅ WebSocket Manager initialized');
    
    // Find a user with Binance credentials
    const user = await User.findOne({
      'binanceCredentials.apiKey': { $exists: true, $ne: null }
    }).select('+binanceCredentials.apiKey +binanceCredentials.secretKey');
    
    if (!user) {
      console.log('❌ No user found with Binance credentials');
      process.exit(1);
    }
    
    console.log(`✅ Found user: ${user._id}`);
    
    // Check if user has valid credentials
    if (!user.hasBinanceCredentials()) {
      console.log('❌ User does not have valid Binance credentials');
      process.exit(1);
    }
    
    console.log('✅ User has valid Binance credentials');
    
    // Decrypt credentials
    const credentials = user.decryptApiCredentials();
    if (!credentials) {
      console.log('❌ Failed to decrypt user credentials');
      process.exit(1);
    }
    
    console.log('✅ Credentials decrypted successfully');
    
    // Create BinanceService instance
    console.log('🔄 Creating BinanceService instance...');
    const binanceService = new BinanceService(credentials.apiKey, credentials.secretKey, user._id);
    
    // Wait a bit for WebSocket to initialize
    console.log('⏳ Waiting 3 seconds for WebSocket initialization...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check WebSocket connection status
    const isConnected = webSocketManager.isUserConnected(user._id);
    console.log(`🔗 WebSocket connected for user ${user._id}: ${isConnected}`);
    
    // Get connection stats
    const stats = webSocketManager.getConnectionStats();
    console.log('📊 Connection Stats:', JSON.stringify(stats, null, 2));
    
    // Test account info to verify API credentials work
    console.log('🔄 Testing Binance API credentials...');
    try {
      const accountInfo = await binanceService.getAccountInfo();
      console.log('✅ Binance API credentials are working');
      console.log(`💰 Account has ${accountInfo.balances.length} assets`);
    } catch (error) {
      console.log('❌ Binance API credentials test failed:', error.message);
    }
    
    // Listen for order updates for 10 seconds
    console.log('👂 Listening for order updates for 10 seconds...');
    let orderUpdateReceived = false;
    
    const orderListener = (data) => {
      console.log('🔔 Order update received:', data);
      orderUpdateReceived = true;
    };
    
    webSocketManager.on('orderUpdate', orderListener);
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    webSocketManager.removeListener('orderUpdate', orderListener);
    
    if (orderUpdateReceived) {
      console.log('✅ Order updates are working!');
    } else {
      console.log('⚠️  No order updates received (this is normal if no trades occurred)');
    }
    
    console.log('🏁 WebSocket debug completed');
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

// Run the debug
debugWebSocketConnections();