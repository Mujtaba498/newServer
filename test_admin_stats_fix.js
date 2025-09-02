/**
 * Test script to verify the admin stats API fixes
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const User = require('./models/User');
const GridBot = require('./models/GridBot');
const Subscription = require('./models/Subscription');

// Import the admin controller function
const { getPlatformStats } = require('./controllers/adminController');

async function testAdminStatsFixes() {
  console.log('🧪 Testing Admin Stats API Fixes\n');
  
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database');
    
    // Create mock request and response objects
    const mockReq = {};
    const mockRes = {
      status: (code) => ({
        json: (data) => {
          console.log(`\n📊 Admin Stats Response (Status: ${code}):`);
          console.log(JSON.stringify(data, null, 2));
          return data;
        }
      })
    };
    
    // Test the getPlatformStats function
    console.log('\n🔄 Calling getPlatformStats...');
    await getPlatformStats(mockReq, mockRes);
    
    // Additional verification - check individual bot data
    console.log('\n🔍 Verifying individual bot data:');
    const allBots = await GridBot.find();
    
    for (const bot of allBots) {
      console.log(`\nBot ${bot._id}:`);
      console.log(`  Status: ${bot.status}`);
      console.log(`  Investment: ${bot.config.investmentAmount}`);
      console.log(`  Total Orders: ${bot.orders.length}`);
      
      const filledBuyOrders = bot.orders.filter(o => o.side === 'BUY' && o.status === 'FILLED');
      const filledSellOrders = bot.orders.filter(o => o.side === 'SELL' && o.status === 'FILLED');
      
      console.log(`  Filled Buy Orders: ${filledBuyOrders.length}`);
      console.log(`  Filled Sell Orders: ${filledSellOrders.length}`);
      
      // Calculate executed buy orders value
      let executedBuyValue = 0;
      for (const order of filledBuyOrders) {
        const price = order.executedPrice || order.price;
        const qty = order.executedQty || order.quantity;
        executedBuyValue += price * qty;
      }
      console.log(`  Executed Buy Orders Value: ${executedBuyValue}`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from database');
  }
}

// Run the test
if (require.main === module) {
  testAdminStatsFixes();
}

module.exports = { testAdminStatsFixes };