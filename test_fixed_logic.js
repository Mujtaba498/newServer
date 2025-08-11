const connectDB = require('./config/database');
const GridBot = require('./models/GridBot');
const GridBotService = require('./services/gridBotService');
const User = require('./models/User');

async function testFixedLogic() {
  try {
    console.log('🧪 Testing fixed handleFilledOrder logic...');
    
    // Connect to database
    await connectDB();
    console.log('✅ Database connected');
    
    // Find an active bot
    const bot = await GridBot.findOne({ status: 'active' });
    
    if (!bot) {
      console.log('❌ No active bot found');
      process.exit(0);
    }
    
    console.log(`🤖 Testing with bot: ${bot.name} (${bot._id})`);
    
    // Create a mock filled buy order for testing
    const mockFilledBuyOrder = {
      orderId: 'TEST_ORDER_' + Date.now(),
      side: 'BUY',
      price: 0.20000,
      quantity: 10,
      status: 'FILLED',
      isFilled: true,
      filledAt: new Date(),
      executedQty: 10,
      gridLevel: 1
    };
    
    console.log(`📈 Mock filled buy order:`);
    console.log(`   Order ID: ${mockFilledBuyOrder.orderId}`);
    console.log(`   Price: ${mockFilledBuyOrder.price}`);
    console.log(`   Quantity: ${mockFilledBuyOrder.quantity}`);
    
    // Create GridBotService instance
    const gridBotService = new GridBotService();
    
    // Get user and Binance service
    const user = await User.findById(bot.userId).select('+binanceCredentials.apiKey +binanceCredentials.secretKey');
    if (!user || !user.hasBinanceCredentials()) {
      console.log('❌ User or credentials not found');
      process.exit(0);
    }
    
    const userBinance = await gridBotService.getUserBinanceService(bot.userId);
    const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);
    
    // Check current balances
    const baseBalance = await userBinance.getAssetBalance(symbolInfo.baseAsset);
    const quoteBalance = await userBinance.getAssetBalance(symbolInfo.quoteAsset);
    
    console.log(`💳 Current balances:`);
    console.log(`   ${symbolInfo.baseAsset}: ${baseBalance.free} (locked: ${baseBalance.locked})`);
    console.log(`   ${symbolInfo.quoteAsset}: ${quoteBalance.free} (locked: ${quoteBalance.locked})`);
    
    // Calculate expected sell order
    const profitMargin = bot.config.profitPerGrid / 100;
    const expectedSellPrice = mockFilledBuyOrder.price * (1 + profitMargin);
    const roundedSellPrice = gridBotService.roundPrice(expectedSellPrice, symbolInfo);
    
    console.log(`📊 Expected sell order:`);
    console.log(`   Expected sell price: ${expectedSellPrice}`);
    console.log(`   Rounded sell price: ${roundedSellPrice}`);
    console.log(`   Quantity needed: ${mockFilledBuyOrder.quantity}`);
    console.log(`   Available base: ${baseBalance.free}`);
    console.log(`   Sufficient balance: ${baseBalance.free >= mockFilledBuyOrder.quantity}`);
    
    // Check if price is within grid range
    const withinRange = roundedSellPrice >= bot.config.lowerPrice && roundedSellPrice <= bot.config.upperPrice;
    console.log(`📏 Price within grid range (${bot.config.lowerPrice} - ${bot.config.upperPrice}): ${withinRange}`);
    
    // Test scenarios
    console.log('\n🧪 Testing different scenarios:');
    
    // Scenario 1: Test with insufficient balance
    console.log('\n📋 Scenario 1: Insufficient balance');
    const insufficientBalanceOrder = {
      ...mockFilledBuyOrder,
      orderId: 'INSUFFICIENT_' + Date.now(),
      quantity: baseBalance.free + 100 // More than available
    };
    
    const ordersBefore1 = bot.orders.length;
    console.log(`   Orders before: ${ordersBefore1}`);
    
    await gridBotService.handleFilledOrder(bot, insufficientBalanceOrder, symbolInfo, userBinance);
    
    const ordersAfter1 = bot.orders.length;
    console.log(`   Orders after: ${ordersAfter1}`);
    console.log(`   New order created: ${ordersAfter1 > ordersBefore1}`);
    
    const testOrder1 = bot.orders.find(o => o.orderId === insufficientBalanceOrder.orderId);
    console.log(`   hasCorrespondingSell flag: ${testOrder1?.hasCorrespondingSell || false}`);
    
    if (ordersAfter1 === ordersBefore1 && !testOrder1?.hasCorrespondingSell) {
      console.log('   ✅ PASS: No sell order created and flag not set (correct behavior)');
    } else {
      console.log('   ❌ FAIL: Unexpected behavior');
    }
    
    // Scenario 2: Test with sufficient balance (if available)
    if (baseBalance.free >= mockFilledBuyOrder.quantity && withinRange) {
      console.log('\n📋 Scenario 2: Sufficient balance');
      
      const sufficientBalanceOrder = {
        ...mockFilledBuyOrder,
        orderId: 'SUFFICIENT_' + Date.now(),
        quantity: Math.min(mockFilledBuyOrder.quantity, baseBalance.free * 0.8) // Use 80% of available
      };
      
      const ordersBefore2 = bot.orders.length;
      console.log(`   Orders before: ${ordersBefore2}`);
      console.log(`   Test quantity: ${sufficientBalanceOrder.quantity}`);
      
      await gridBotService.handleFilledOrder(bot, sufficientBalanceOrder, symbolInfo, userBinance);
      
      const ordersAfter2 = bot.orders.length;
      console.log(`   Orders after: ${ordersAfter2}`);
      console.log(`   New order created: ${ordersAfter2 > ordersBefore2}`);
      
      const testOrder2 = bot.orders.find(o => o.orderId === sufficientBalanceOrder.orderId);
      console.log(`   hasCorrespondingSell flag: ${testOrder2?.hasCorrespondingSell || false}`);
      
      if (ordersAfter2 > ordersBefore2 && testOrder2?.hasCorrespondingSell) {
        console.log('   ✅ PASS: Sell order created and flag set (correct behavior)');
        
        // Find the created sell order
        const newSellOrder = bot.orders[bot.orders.length - 1];
        console.log(`   Created sell order: ${newSellOrder.orderId} at ${newSellOrder.price}`);
        
        // Clean up - cancel the test order
        try {
          await userBinance.cancelOrder(bot.symbol, newSellOrder.orderId);
          console.log(`   🧹 Cleaned up test sell order`);
          
          // Remove from bot orders
          bot.orders = bot.orders.filter(o => o.orderId !== newSellOrder.orderId);
        } catch (error) {
          console.log(`   ⚠️  Could not cancel test order: ${error.message}`);
        }
      } else {
        console.log('   ❌ FAIL: Expected sell order creation but it failed');
      }
    } else {
      console.log('\n📋 Scenario 2: Skipped (insufficient balance or price out of range)');
    }
    
    // Scenario 3: Test with price outside grid range
    console.log('\n📋 Scenario 3: Price outside grid range');
    const outsideRangeOrder = {
      ...mockFilledBuyOrder,
      orderId: 'OUTSIDE_RANGE_' + Date.now(),
      price: bot.config.upperPrice * 0.99, // This will make sell price above upper limit
      quantity: Math.min(5, baseBalance.free * 0.5)
    };
    
    const ordersBefore3 = bot.orders.length;
    console.log(`   Orders before: ${ordersBefore3}`);
    
    await gridBotService.handleFilledOrder(bot, outsideRangeOrder, symbolInfo, userBinance);
    
    const ordersAfter3 = bot.orders.length;
    console.log(`   Orders after: ${ordersAfter3}`);
    console.log(`   New order created: ${ordersAfter3 > ordersBefore3}`);
    
    const testOrder3 = bot.orders.find(o => o.orderId === outsideRangeOrder.orderId);
    console.log(`   hasCorrespondingSell flag: ${testOrder3?.hasCorrespondingSell || false}`);
    
    if (ordersAfter3 === ordersBefore3 && !testOrder3?.hasCorrespondingSell) {
      console.log('   ✅ PASS: No sell order created for out-of-range price (correct behavior)');
    } else {
      console.log('   ❌ FAIL: Unexpected behavior for out-of-range price');
    }
    
    console.log('\n🏁 Logic test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

// Run the test
testFixedLogic();