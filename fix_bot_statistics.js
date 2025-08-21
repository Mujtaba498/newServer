const connectDB = require('./config/database');
const GridBot = require('./models/GridBot');
const GridBotService = require('./services/gridBotService');

async function fixBotStatistics() {
  try {
    console.log('🔧 Fixing bot statistics...');
    
    // Connect to database
    await connectDB();
    console.log('✅ Database connected');
    
    // Find the specific bot from the test
    const botId = '68976f4aa1121fdefc7b3001';
    const bot = await GridBot.findById(botId);
    
    if (!bot) {
      console.log('❌ Bot not found');
      process.exit(0);
    }
    
    console.log(`🤖 Analyzing bot: ${bot.name} (${bot._id})`);
    console.log(`📊 Current bot.statistics.totalProfit: ${bot.statistics.totalProfit || 0}`);
    
    // Get all filled orders
    const filledOrders = bot.orders.filter(o => o.status === 'FILLED');
    const filledBuyOrders = filledOrders.filter(o => o.side === 'BUY');
    const filledSellOrders = filledOrders.filter(o => o.side === 'SELL');
    
    console.log(`\n📋 Order Analysis:`);
    console.log(`Total filled orders: ${filledOrders.length}`);
    console.log(`Filled buy orders: ${filledBuyOrders.length}`);
    console.log(`Filled sell orders: ${filledSellOrders.length}`);
    
    // Show order details
    console.log(`\n🔍 Buy Orders:`);
    filledBuyOrders.forEach((order, index) => {
      console.log(`  ${index + 1}. ${order.orderId}: ${order.price} x ${order.quantity} = ${order.price * order.quantity} (hasCorrespondingSell: ${order.hasCorrespondingSell})`);
    });
    
    console.log(`\n🔍 Sell Orders:`);
    filledSellOrders.forEach((order, index) => {
      console.log(`  ${index + 1}. ${order.orderId}: ${order.price} x ${order.quantity} = ${order.price * order.quantity}`);
    });
    
    // Recalculate profit manually
    let recalculatedProfit = 0;
    const profitMargin = bot.config.profitPerGrid / 100;
    
    console.log(`\n💰 Recalculating Profit:`);
    
    for (const sellOrder of filledSellOrders) {
      // Find corresponding buy order with more flexible matching
      let correspondingBuy = filledBuyOrders.find(buyOrder => 
        buyOrder.hasCorrespondingSell && 
        Math.abs(buyOrder.price * (1 + profitMargin) - sellOrder.price) < sellOrder.price * 0.02
      );
      
      // If strict matching fails, try looser matching based on quantity and grid level
      if (!correspondingBuy) {
        correspondingBuy = filledBuyOrders.find(buyOrder => 
          buyOrder.quantity === sellOrder.quantity &&
          buyOrder.gridLevel === sellOrder.gridLevel
        );
      }
      
      // If still no match, try matching by quantity only
      if (!correspondingBuy) {
        correspondingBuy = filledBuyOrders.find(buyOrder => 
          buyOrder.quantity === sellOrder.quantity
        );
      }
      
      if (correspondingBuy) {
        const buyPrice = correspondingBuy.executedPrice || correspondingBuy.price;
        const sellPrice = sellOrder.executedPrice || sellOrder.price;
        const profit = (sellPrice - buyPrice) * sellOrder.quantity;
        recalculatedProfit += profit;
        
        console.log(`  Trade: Buy ${correspondingBuy.orderId} (${buyPrice}) → Sell ${sellOrder.orderId} (${sellPrice})`);
        console.log(`    Profit: (${sellPrice} - ${buyPrice}) * ${sellOrder.quantity} = ${profit}`);
      } else {
        console.log(`  ⚠️ No corresponding buy order found for sell order ${sellOrder.orderId}`);
      }
    }
    
    console.log(`\n📊 Profit Comparison:`);
    console.log(`Current bot.statistics.totalProfit: ${bot.statistics.totalProfit || 0}`);
    console.log(`Recalculated profit: ${recalculatedProfit}`);
    console.log(`Difference: ${Math.abs((bot.statistics.totalProfit || 0) - recalculatedProfit)}`);
    
    // Get detailed analysis for comparison
    const gridBotService = new GridBotService();
    const detailedAnalysis = await gridBotService.getDetailedBotAnalysis(bot._id);
    console.log(`Detailed analysis realized PnL: ${detailedAnalysis.profitLossAnalysis.realizedPnL}`);
    
    // Fix the bot statistics
    console.log(`\n🔧 Updating bot statistics...`);
    bot.statistics.totalProfit = recalculatedProfit;
    await bot.save();
    
    console.log(`✅ Bot statistics updated successfully!`);
    console.log(`New totalProfit: ${bot.statistics.totalProfit}`);
    
    // Verify the fix
    const updatedDetailedAnalysis = await gridBotService.getDetailedBotAnalysis(bot._id);
    const difference = Math.abs(bot.statistics.totalProfit - updatedDetailedAnalysis.profitLossAnalysis.realizedPnL);
    const percentageDiff = updatedDetailedAnalysis.profitLossAnalysis.realizedPnL !== 0 ? 
      (difference / Math.abs(updatedDetailedAnalysis.profitLossAnalysis.realizedPnL) * 100) : 0;
    
    console.log(`\n✅ Verification:`);
    console.log(`Bot Statistics Total Profit: ${bot.statistics.totalProfit}`);
    console.log(`Detailed Analysis Realized PnL: ${updatedDetailedAnalysis.profitLossAnalysis.realizedPnL}`);
    console.log(`Absolute Difference: ${difference}`);
    console.log(`Percentage Difference: ${percentageDiff.toFixed(4)}%`);
    
    if (percentageDiff < 1) {
      console.log('\n🎉 SUCCESS! Profit calculations are now consistent!');
    } else {
      console.log('\n⚠️ There is still a discrepancy that needs investigation.');
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
  } finally {
    process.exit(0);
  }
}

// Run the fix
fixBotStatistics();