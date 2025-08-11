const connectDB = require('./config/database');
const GridBot = require('./models/GridBot');
const GridBotService = require('./services/gridBotService');
const User = require('./models/User');

async function testHandleFilledOrder() {
  try {
    console.log('🔍 Testing handleFilledOrder function...');
    
    // Connect to database
    await connectDB();
    console.log('✅ Database connected');
    
    // Find an active bot with filled buy orders
    const bot = await GridBot.findOne({ 
      status: 'active',
      'orders.side': 'BUY',
      'orders.status': 'FILLED'
    });
    
    if (!bot) {
      console.log('❌ No active bot with filled buy orders found');
      process.exit(0);
    }
    
    console.log(`🤖 Testing with bot: ${bot.name} (${bot._id})`);
    
    // Find any filled buy order (even if marked as having corresponding sell)
    const filledBuyOrder = bot.orders.find(o => 
      o.side === 'BUY' && 
      o.status === 'FILLED'
    );
    
    if (!filledBuyOrder) {
      console.log('❌ No filled buy order found');
      process.exit(0);
    }
    
    console.log(`🔍 Found filled buy order with hasCorrespondingSell: ${filledBuyOrder.hasCorrespondingSell || false}`);
    
    // Create GridBotService instance early
    const gridBotService = new GridBotService();
    
    // Check if there's actually a corresponding sell order on Binance
    const tempUserBinance = await gridBotService.getUserBinanceService(bot.userId);
    
    const openOrders = await tempUserBinance.getOpenOrders(bot.symbol);
    const profitMargin = bot.config.profitPerGrid / 100;
    const expectedSellPrice = filledBuyOrder.price * (1 + profitMargin);
    
    // Look for a sell order with similar price and quantity
    const correspondingSellOrder = openOrders.find(o => 
      o.side === 'SELL' && 
      Math.abs(parseFloat(o.price) - expectedSellPrice) < expectedSellPrice * 0.01 && // Within 1%
      Math.abs(parseFloat(o.origQty) - filledBuyOrder.quantity) < filledBuyOrder.quantity * 0.01 // Within 1%
    );
    
    console.log(`🔍 Expected sell price: ${expectedSellPrice}`);
    console.log(`🔍 Found corresponding sell order on Binance: ${correspondingSellOrder ? 'YES' : 'NO'}`);
    
    if (filledBuyOrder.hasCorrespondingSell && !correspondingSellOrder) {
      console.log('🚨 ISSUE FOUND: Buy order marked as having corresponding sell, but no sell order found on Binance!');
    }
    
    console.log(`📈 Testing with filled buy order: ${filledBuyOrder.orderId}`);
    console.log(`   Price: ${filledBuyOrder.price}`);
    console.log(`   Quantity: ${filledBuyOrder.quantity}`);
    console.log(`   Filled at: ${filledBuyOrder.filledAt}`);
    
    // Get user and Binance service
    const user = await User.findById(bot.userId).select('+binanceCredentials.apiKey +binanceCredentials.secretKey');
    if (!user || !user.hasBinanceCredentials()) {
      console.log('❌ User or credentials not found');
      process.exit(0);
    }
    
    const userBinance = await gridBotService.getUserBinanceService(bot.userId);
    const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);
    
    console.log(`💰 Symbol info: ${bot.symbol}`);
    console.log(`   Base asset: ${symbolInfo.baseAsset}`);
    console.log(`   Quote asset: ${symbolInfo.quoteAsset}`);
    console.log(`   Price precision: ${symbolInfo.pricePrecision}`);
    console.log(`   Quantity precision: ${symbolInfo.quantityPrecision}`);
    
    // Check current balances
    const baseBalance = await userBinance.getAssetBalance(symbolInfo.baseAsset);
    const quoteBalance = await userBinance.getAssetBalance(symbolInfo.quoteAsset);
    
    console.log(`💳 Current balances:`);
    console.log(`   ${symbolInfo.baseAsset}: ${baseBalance.free} (locked: ${baseBalance.locked})`);
    console.log(`   ${symbolInfo.quoteAsset}: ${quoteBalance.free} (locked: ${quoteBalance.locked})`);
    
    // Calculate what the sell order should be
    const sellPrice = filledBuyOrder.price * (1 + profitMargin);
    const roundedSellPrice = gridBotService.roundPrice(sellPrice, symbolInfo);
    
    console.log(`📊 Calculated sell order:`);
    console.log(`   Raw sell price: ${sellPrice}`);
    console.log(`   Rounded sell price: ${roundedSellPrice}`);
    console.log(`   Quantity needed: ${filledBuyOrder.quantity}`);
    console.log(`   Available base: ${baseBalance.free}`);
    console.log(`   Sufficient balance: ${baseBalance.free >= filledBuyOrder.quantity}`);
    
    // Check if price is within grid range
    const withinRange = roundedSellPrice >= bot.config.lowerPrice && roundedSellPrice <= bot.config.upperPrice;
    console.log(`📏 Price within grid range (${bot.config.lowerPrice} - ${bot.config.upperPrice}): ${withinRange}`);
    
    if (!withinRange) {
      console.log('⚠️  Sell price is outside grid range - this might be why no sell order was placed');
    }
    
    if (baseBalance.free < filledBuyOrder.quantity) {
      console.log('⚠️  Insufficient base asset balance - this might be why no sell order was placed');
    }
    
    // Count orders before
    const ordersBefore = bot.orders.length;
    console.log(`📋 Orders before handleFilledOrder: ${ordersBefore}`);
    
    // Test handleFilledOrder function
    console.log('🔄 Calling handleFilledOrder...');
    
    try {
      await gridBotService.handleFilledOrder(bot, filledBuyOrder, symbolInfo, userBinance);
      console.log('✅ handleFilledOrder completed without throwing error');
    } catch (error) {
      console.log('❌ handleFilledOrder threw an error:', error.message);
      console.log('Stack trace:', error.stack);
    }
    
    // Check if new order was added
    const ordersAfter = bot.orders.length;
    console.log(`📋 Orders after handleFilledOrder: ${ordersAfter}`);
    
    if (ordersAfter > ordersBefore) {
      const newOrder = bot.orders[bot.orders.length - 1];
      console.log('🎉 New sell order was created:');
      console.log(`   Order ID: ${newOrder.orderId}`);
      console.log(`   Side: ${newOrder.side}`);
      console.log(`   Price: ${newOrder.price}`);
      console.log(`   Quantity: ${newOrder.quantity}`);
      console.log(`   Status: ${newOrder.status}`);
    } else {
      console.log('❌ No new order was created');
    }
    
    // Check if hasCorrespondingSell was set
    const updatedBuyOrder = bot.orders.find(o => o.orderId === filledBuyOrder.orderId);
    console.log(`🔗 hasCorrespondingSell flag: ${updatedBuyOrder?.hasCorrespondingSell || false}`);
    
    console.log('\n🏁 Test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

// Run the test
testHandleFilledOrder();