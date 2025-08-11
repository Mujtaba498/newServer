const connectDB = require('./config/database');
const GridBot = require('./models/GridBot');
const BinanceService = require('./services/binanceService');
const User = require('./models/User');

async function debugBotOrders() {
  try {
    console.log('🔍 Starting Bot Orders Debug...');
    
    // Connect to database
    await connectDB();
    console.log('✅ Database connected');
    
    // Find active bots
    const activeBots = await GridBot.find({ status: 'active' });
    console.log(`📊 Found ${activeBots.length} active bots`);
    
    if (activeBots.length === 0) {
      console.log('❌ No active bots found');
      process.exit(0);
    }
    
    for (const bot of activeBots) {
      console.log(`\n🤖 Bot: ${bot.name} (${bot._id})`);
      console.log(`   Symbol: ${bot.symbol}`);
      console.log(`   Status: ${bot.status}`);
      console.log(`   Total Orders: ${bot.orders.length}`);
      
      // Count order types and statuses
      const buyOrders = bot.orders.filter(o => o.side === 'BUY');
      const sellOrders = bot.orders.filter(o => o.side === 'SELL');
      const filledBuyOrders = buyOrders.filter(o => o.status === 'FILLED');
      const filledSellOrders = sellOrders.filter(o => o.status === 'FILLED');
      const newBuyOrders = buyOrders.filter(o => o.status === 'NEW');
      const newSellOrders = sellOrders.filter(o => o.status === 'NEW');
      
      console.log(`   📈 Buy Orders: ${buyOrders.length} (${filledBuyOrders.length} filled, ${newBuyOrders.length} new)`);
      console.log(`   📉 Sell Orders: ${sellOrders.length} (${filledSellOrders.length} filled, ${newSellOrders.length} new)`);
      
      // Show recent filled buy orders
      const recentFilledBuys = filledBuyOrders
        .filter(o => o.filledAt && new Date() - new Date(o.filledAt) < 24 * 60 * 60 * 1000) // Last 24 hours
        .sort((a, b) => new Date(b.filledAt) - new Date(a.filledAt))
        .slice(0, 5);
      
      if (recentFilledBuys.length > 0) {
        console.log(`   🔥 Recent Filled Buy Orders (last 24h):`);
        recentFilledBuys.forEach(order => {
          console.log(`      - Order ${order.orderId}: ${order.executedQty} @ ${order.price} (filled: ${order.filledAt})`);
          console.log(`        Has corresponding sell: ${order.hasCorrespondingSell || false}`);
        });
      }
      
      // Get user and create Binance service to check actual order status
      const user = await User.findById(bot.userId).select('+binanceCredentials.apiKey +binanceCredentials.secretKey');
      if (user && user.hasBinanceCredentials()) {
        const credentials = user.decryptApiCredentials();
        const binanceService = new BinanceService(credentials.apiKey, credentials.secretKey, bot.userId);
        
        try {
          // Check open orders on Binance
          const openOrders = await binanceService.getOpenOrders(bot.symbol);
          console.log(`   🔄 Open orders on Binance: ${openOrders.length}`);
          
          // Compare with bot's NEW orders
          const botNewOrders = bot.orders.filter(o => o.status === 'NEW');
          console.log(`   📋 Bot's NEW orders: ${botNewOrders.length}`);
          
          // Check for discrepancies
          const binanceOrderIds = openOrders.map(o => o.orderId);
          const botNewOrderIds = botNewOrders.map(o => o.orderId);
          
          const missingFromBinance = botNewOrderIds.filter(id => !binanceOrderIds.includes(id));
          const extraOnBinance = binanceOrderIds.filter(id => !botNewOrderIds.includes(id));
          
          if (missingFromBinance.length > 0) {
            console.log(`   ⚠️  Orders marked as NEW in bot but not found on Binance: ${missingFromBinance.length}`);
            console.log(`      These might be filled orders that weren't processed: ${missingFromBinance.slice(0, 3).join(', ')}`);
          }
          
          if (extraOnBinance.length > 0) {
            console.log(`   ⚠️  Orders on Binance but not in bot: ${extraOnBinance.length}`);
          }
          
          // Check a few potentially filled orders
          if (missingFromBinance.length > 0) {
            console.log(`   🔍 Checking status of potentially filled orders...`);
            for (let i = 0; i < Math.min(3, missingFromBinance.length); i++) {
              const orderId = missingFromBinance[i];
              try {
                const orderStatus = await binanceService.getOrderStatus(bot.symbol, orderId);
                console.log(`      Order ${orderId}: ${orderStatus.status} (${orderStatus.side} ${orderStatus.executedQty}/${orderStatus.origQty})`);
                
                if (orderStatus.status === 'FILLED') {
                  console.log(`      🚨 FOUND FILLED ORDER THAT WASN'T PROCESSED!`);
                  console.log(`         Side: ${orderStatus.side}, Price: ${orderStatus.price}, Qty: ${orderStatus.executedQty}`);
                }
              } catch (error) {
                console.log(`      Error checking order ${orderId}: ${error.message}`);
              }
            }
          }
          
        } catch (error) {
          console.log(`   ❌ Error checking Binance orders: ${error.message}`);
        }
      }
    }
    
    console.log('\n🏁 Bot orders debug completed');
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

// Run the debug
debugBotOrders();