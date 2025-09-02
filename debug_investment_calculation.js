/**
 * Debug script to understand the investment calculation discrepancy
 */

const mongoose = require('mongoose');
require('dotenv').config();

const GridBot = require('./models/GridBot');
const gridBotService = require('./services/gridBotService');

async function debugInvestmentCalculation() {
  console.log('🔍 Debugging Investment Calculation Discrepancy\n');
  
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database\n');
    
    const allBots = await GridBot.find();
    const activeBots = allBots.filter(bot => bot.status === 'active');
    
    console.log(`Found ${allBots.length} total bots, ${activeBots.length} active bots\n`);
    
    let totalConfiguredInvestment = 0;
    let totalExecutedInvestment = 0;
    
    console.log('📊 Active Bots Analysis:');
    console.log('='.repeat(80));
    
    for (const bot of activeBots) {
      console.log(`\nBot ID: ${bot._id}`);
      console.log(`Symbol: ${bot.symbol}`);
      console.log(`Status: ${bot.status}`);
      console.log(`Configured Investment: ${bot.config.investmentAmount}`);
      
      totalConfiguredInvestment += bot.config.investmentAmount || 0;
      
      // Calculate executed buy orders manually
      const executedBuyOrders = bot.orders.filter(order => 
        order.side === 'BUY' && 
        order.status === 'FILLED' && 
        !order.isLiquidation
      );
      
      let botExecutedInvestment = 0;
      console.log(`Executed Buy Orders: ${executedBuyOrders.length}`);
      
      for (const order of executedBuyOrders) {
        const price = order.executedPrice || order.price;
        const qty = order.executedQty || order.quantity;
        const value = price * qty;
        botExecutedInvestment += value;
        
        console.log(`  Order ${order.orderId}: ${qty} @ ${price} = ${value}`);
      }
      
      console.log(`Bot Executed Investment: ${botExecutedInvestment}`);
      console.log(`Difference: ${botExecutedInvestment - bot.config.investmentAmount}`);
      
      totalExecutedInvestment += botExecutedInvestment;
      
      // Try to get detailed analysis
      try {
        const analysis = await gridBotService.getDetailedBotAnalysis(bot._id);
        
        console.log(`Analysis Holdings:`);
        if (analysis.currentPositions && analysis.currentPositions.holdings) {
          let holdingsValue = 0;
          for (const holding of analysis.currentPositions.holdings) {
            const value = holding.quantity * holding.avgPrice;
            holdingsValue += value;
            console.log(`  Holding: ${holding.quantity} @ ${holding.avgPrice} = ${value}`);
          }
          console.log(`Total Holdings Value: ${holdingsValue}`);
        } else {
          console.log(`  No holdings found`);
        }
        
        console.log(`Analysis Realized PnL: ${analysis.profitLossAnalysis.realizedPnL}`);
        console.log(`Analysis Unrealized PnL: ${analysis.profitLossAnalysis.unrealizedPnL}`);
        
      } catch (error) {
        console.log(`Analysis failed: ${error.message}`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY:');
    console.log(`Total Configured Investment (active bots): ${totalConfiguredInvestment}`);
    console.log(`Total Executed Investment (active bots): ${totalExecutedInvestment}`);
    console.log(`Difference: ${totalExecutedInvestment - totalConfiguredInvestment}`);
    console.log(`Percentage Difference: ${((totalExecutedInvestment - totalConfiguredInvestment) / totalConfiguredInvestment * 100).toFixed(2)}%`);
    
    // Check if the difference is due to:
    console.log('\n🔍 Possible Reasons for Difference:');
    console.log('1. Bots executing more buy orders than initial investment');
    console.log('2. Price differences between configured and executed prices');
    console.log('3. Reinvestment of profits');
    console.log('4. Multiple grid levels being filled');
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from database');
  }
}

if (require.main === module) {
  debugInvestmentCalculation();
}

module.exports = { debugInvestmentCalculation };