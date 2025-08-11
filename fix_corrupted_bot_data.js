const connectDB = require('./config/database');
const GridBot = require('./models/GridBot');
const GridBotService = require('./services/gridBotService');
const User = require('./models/User');

async function fixCorruptedBotData() {
  try {
    console.log('🔧 Fixing corrupted bot data...');
    
    // Connect to database
    await connectDB();
    console.log('✅ Database connected');
    
    // Find active bots
    const activeBots = await GridBot.find({ status: 'active' });
    console.log(`📊 Found ${activeBots.length} active bots`);
    
    const gridBotService = new GridBotService();
    
    for (const bot of activeBots) {
      console.log(`\n🤖 Checking bot: ${bot.name} (${bot._id})`);
      
      let hasChanges = false;
      
      // Get user Binance service
      const user = await User.findById(bot.userId).select('+binanceCredentials.apiKey +binanceCredentials.secretKey');
      if (!user || !user.hasBinanceCredentials()) {
        console.log('   ❌ User or credentials not found, skipping');
        continue;
      }
      
      const userBinance = await gridBotService.getUserBinanceService(bot.userId);
      const openOrders = await userBinance.getOpenOrders(bot.symbol);
      const openOrderIds = openOrders.map(o => o.orderId);
      
      console.log(`   📋 Open orders on Binance: ${openOrders.length}`);
      
      // Check filled buy orders marked as having corresponding sell
      const filledBuyOrders = bot.orders.filter(o => 
        o.side === 'BUY' && 
        o.status === 'FILLED' && 
        o.hasCorrespondingSell === true
      );
      
      console.log(`   📈 Filled buy orders marked as having corresponding sell: ${filledBuyOrders.length}`);
      
      for (const buyOrder of filledBuyOrders) {
        // Calculate expected sell price
        const profitMargin = bot.config.profitPerGrid / 100;
        const expectedSellPrice = buyOrder.price * (1 + profitMargin);
        
        // Look for corresponding sell order on Binance
        const correspondingSellOrder = openOrders.find(o => 
          o.side === 'SELL' && 
          Math.abs(parseFloat(o.price) - expectedSellPrice) < expectedSellPrice * 0.02 && // Within 2%
          Math.abs(parseFloat(o.origQty) - buyOrder.quantity) < buyOrder.quantity * 0.02 // Within 2%
        );
        
        if (!correspondingSellOrder) {
          console.log(`   🚨 Buy order ${buyOrder.orderId} marked as having sell but no sell order found on Binance`);
          console.log(`      Expected sell price: ${expectedSellPrice}, Buy price: ${buyOrder.price}`);
          
          // Reset the flag
          buyOrder.hasCorrespondingSell = false;
          hasChanges = true;
          
          // Try to place the missing sell order
          try {
            const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);
            const baseBalance = await userBinance.getAssetBalance(symbolInfo.baseAsset);
            
            console.log(`      Available ${symbolInfo.baseAsset}: ${baseBalance.free}, Required: ${buyOrder.quantity}`);
            
            if (baseBalance.free >= buyOrder.quantity) {
              const roundedSellPrice = gridBotService.roundPrice(expectedSellPrice, symbolInfo);
              
              // Check if price is within grid range
              if (roundedSellPrice >= bot.config.lowerPrice && roundedSellPrice <= bot.config.upperPrice) {
                console.log(`      🔄 Attempting to place missing sell order at ${roundedSellPrice}`);
                
                const sellOrder = await userBinance.placeLimitOrder(
                  bot.symbol,
                  'SELL',
                  buyOrder.quantity,
                  roundedSellPrice
                );
                
                // Add the sell order to bot
                bot.orders.push({
                  orderId: sellOrder.orderId,
                  side: 'SELL',
                  price: roundedSellPrice,
                  quantity: buyOrder.quantity,
                  status: 'NEW',
                  gridLevel: buyOrder.gridLevel
                });
                
                // Now mark as having corresponding sell
                buyOrder.hasCorrespondingSell = true;
                hasChanges = true;
                
                console.log(`      ✅ Successfully placed missing sell order ${sellOrder.orderId}`);
              } else {
                console.log(`      ⚠️  Sell price ${roundedSellPrice} is outside grid range (${bot.config.lowerPrice} - ${bot.config.upperPrice})`);
              }
            } else {
              console.log(`      ⚠️  Insufficient balance to place sell order`);
            }
          } catch (error) {
            console.log(`      ❌ Failed to place missing sell order: ${error.message}`);
          }
        }
      }
      
      // Check for orders marked as NEW but not found on Binance (might be filled)
      const newOrders = bot.orders.filter(o => o.status === 'NEW');
      const missingOrders = newOrders.filter(o => !openOrderIds.includes(o.orderId));
      
      if (missingOrders.length > 0) {
        console.log(`   🔍 Found ${missingOrders.length} orders marked as NEW but not on Binance`);
        
        for (const missingOrder of missingOrders) {
          try {
            const orderStatus = await userBinance.getOrderStatus(bot.symbol, missingOrder.orderId);
            
            if (orderStatus.status === 'FILLED') {
              console.log(`   🎯 Order ${missingOrder.orderId} is actually FILLED, updating status`);
              
              missingOrder.status = 'FILLED';
              missingOrder.isFilled = true;
              missingOrder.filledAt = new Date(orderStatus.updateTime);
              missingOrder.executedQty = parseFloat(orderStatus.executedQty);
              hasChanges = true;
              
              // If it's a buy order without corresponding sell, try to place sell order
              if (missingOrder.side === 'BUY' && !missingOrder.hasCorrespondingSell) {
                console.log(`   🔄 Processing filled buy order ${missingOrder.orderId}`);
                
                const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);
                await gridBotService.handleFilledOrder(bot, missingOrder, symbolInfo, userBinance);
                hasChanges = true;
              }
            }
          } catch (error) {
            console.log(`   ❌ Error checking order ${missingOrder.orderId}: ${error.message}`);
          }
        }
      }
      
      if (hasChanges) {
        await bot.save();
        console.log(`   💾 Bot data updated and saved`);
      } else {
        console.log(`   ✅ Bot data is consistent`);
      }
    }
    
    console.log('\n🏁 Bot data fix completed');
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

// Run the fix
fixCorruptedBotData();