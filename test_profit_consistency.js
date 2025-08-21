const connectDB = require('./config/database');
const GridBot = require('./models/GridBot');
const GridBotService = require('./services/gridBotService');

async function testProfitConsistency() {
  try {
    console.log('🔍 Testing profit calculation consistency...');
    
    // Connect to database
    await connectDB();
    console.log('✅ Database connected');
    
    // Find a bot with completed trades (both buy and sell orders)
    const bot = await GridBot.findOne({ 
      status: { $in: ['active', 'stopped'] },
      'orders.side': 'BUY',
      'orders.status': 'FILLED',
      'orders.hasCorrespondingSell': true
    });
    
    if (!bot) {
      console.log('❌ No bot with completed trades found');
      process.exit(0);
    }
    
    console.log(`🤖 Testing with bot: ${bot.name} (${bot._id})`);
    console.log(`📊 Current bot.statistics.totalProfit: ${bot.statistics.totalProfit || 0}`);
    
    // Get detailed analysis
    const gridBotService = new GridBotService();
    const detailedAnalysis = await gridBotService.getDetailedBotAnalysis(bot._id);
    
    console.log('\n📈 Profit Comparison:');
    console.log(`Bot Statistics Total Profit: ${bot.statistics.totalProfit || 0}`);
    console.log(`Detailed Analysis Realized PnL: ${detailedAnalysis.profitLossAnalysis.realizedPnL}`);
    console.log(`Detailed Analysis Total PnL: ${detailedAnalysis.profitLossAnalysis.totalPnL}`);
    
    // Calculate the difference
    const difference = Math.abs((bot.statistics.totalProfit || 0) - detailedAnalysis.profitLossAnalysis.realizedPnL);
    const percentageDiff = detailedAnalysis.profitLossAnalysis.realizedPnL !== 0 ? 
      (difference / Math.abs(detailedAnalysis.profitLossAnalysis.realizedPnL) * 100) : 0;
    
    console.log(`\n🔍 Analysis:`);
    console.log(`Absolute Difference: ${difference}`);
    console.log(`Percentage Difference: ${percentageDiff.toFixed(4)}%`);
    
    // Show completed trades from detailed analysis
    console.log(`\n📋 Completed Trades (${detailedAnalysis.tradingActivity.completedTrades}):`);
    if (detailedAnalysis.tradeHistory.completedTrades.length > 0) {
      detailedAnalysis.tradeHistory.completedTrades.forEach((trade, index) => {
        console.log(`  ${index + 1}. Buy: ${trade.buyOrder.price} → Sell: ${trade.sellOrder.price} = Profit: ${trade.profit}`);
      });
    }
    
    // Show filled orders from bot
    const filledBuyOrders = bot.orders.filter(o => o.side === 'BUY' && o.status === 'FILLED');
    const filledSellOrders = bot.orders.filter(o => o.side === 'SELL' && o.status === 'FILLED');
    
    console.log(`\n📊 Bot Orders Summary:`);
    console.log(`Filled Buy Orders: ${filledBuyOrders.length}`);
    console.log(`Filled Sell Orders: ${filledSellOrders.length}`);
    
    // Check for consistency
    if (percentageDiff < 1) { // Less than 1% difference
      console.log('\n✅ PROFIT CALCULATIONS ARE CONSISTENT!');
      console.log('The fix has resolved the discrepancy between the two APIs.');
    } else {
      console.log('\n⚠️ PROFIT CALCULATIONS STILL DIFFER!');
      console.log('Further investigation may be needed.');
      
      // Show detailed order analysis
      console.log('\n🔍 Detailed Order Analysis:');
      filledSellOrders.forEach(sellOrder => {
        const correspondingBuy = filledBuyOrders.find(buyOrder => 
          buyOrder.hasCorrespondingSell && 
          Math.abs(buyOrder.price * (1 + bot.config.profitPerGrid / 100) - sellOrder.price) < sellOrder.price * 0.02
        );
        
        if (correspondingBuy) {
          const profit = (sellOrder.price - correspondingBuy.price) * sellOrder.quantity;
          console.log(`  Sell ${sellOrder.orderId}: (${sellOrder.price} - ${correspondingBuy.price}) * ${sellOrder.quantity} = ${profit}`);
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    process.exit(0);
  }
}

// Run the test
testProfitConsistency();