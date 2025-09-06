const BinanceService = require('./binanceService');
const GridBot = require('../models/GridBot');
const webSocketManager = require('./webSocketManager');
const proxyManager = require('./proxyManager');

class GridBotService {
  constructor() {
    this.binance = new BinanceService(); // Default instance for non-user specific operations
    this.activeBots = new Map(); // Store active bot instances
    this.intervals = new Map(); // Store interval timers
    this.userBinanceServices = new Map(); // Store user-specific Binance service instances
    
    // WebSocket order listener is now handled by webSocketManager.initializeOrderUpdateListener()
    // No need for duplicate listener setup here
  }

  // WebSocket order listener is now handled by webSocketManager.initializeOrderUpdateListener()
  // This method has been removed to avoid duplicate listeners and conflicts

  // Find bot by order ID and symbol
  async findBotByOrder(userId, orderId, symbol) {
    try {
      // Convert orderId to string for consistent matching (database stores as string)
      const orderIdStr = orderId.toString();
      const userIdStr = userId.toString();
      
      console.log(`🔍 Looking for bot with order ${orderIdStr} for user ${userIdStr} on ${symbol}`);
      
      // Search through active bots for this user (refresh from DB to avoid stale cache)
      for (const [botId, bot] of this.activeBots) {
        if (bot.userId.toString() === userIdStr && bot.symbol === symbol) {
          // Refresh bot data from database to ensure we have latest state
          const freshBot = await GridBot.findOne({ _id: botId, deleted: false });
          if (freshBot && freshBot.orders.some(order => order.orderId.toString() === orderIdStr)) {
            console.log(`✅ Found bot ${botId} in active cache with order ${orderIdStr}`);
            return freshBot;
          }
        }
      }
      
      // If not found in active bots cache, search database directly
      console.log(`🔄 Searching database for bot with order ${orderIdStr}...`);
      let bot = await GridBot.findOne({
        userId: userId,
        symbol: symbol,
        'orders.orderId': orderIdStr,
        deleted: false
      });
      
      // If still not found, retry once after a short delay (for timing issues with recovery orders)
      if (!bot) {
        console.log(`⏳ Order not found, retrying in 500ms (recovery order timing)...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        
        bot = await GridBot.findOne({
          userId: userId,
          symbol: symbol,
          'orders.orderId': orderIdStr,
          deleted: false
        });
      }
      
      if (bot) {
        console.log(`✅ Found bot ${bot._id} in database with order ${orderIdStr}`);
        // Log order details for debugging
        const matchingOrder = bot.orders.find(order => order.orderId.toString() === orderIdStr);
        if (matchingOrder) {
          console.log(`📋 Order details: side=${matchingOrder.side}, price=${matchingOrder.price}, status=${matchingOrder.status}, isRecoveryOrder=${matchingOrder.isRecoveryOrder}`);
        }
      } else {
        console.log(`❌ No bot found with order ${orderIdStr} for user ${userIdStr} on ${symbol}`);
        
        // Additional debug: Search for any bot with this symbol for this user
        const anyBotForSymbol = await GridBot.findOne({
          userId: userId,
          symbol: symbol,
          deleted: false
        });
        
        if (anyBotForSymbol) {
          console.log(`🔍 Found bot ${anyBotForSymbol._id} for ${symbol} but without order ${orderIdStr}`);
          const orderIds = anyBotForSymbol.orders.map(o => o.orderId.toString());
          console.log(`📝 Bot has orders: [${orderIds.slice(0, 5).join(', ')}]${orderIds.length > 5 ? '...' : ''}`);
        } else {
          console.log(`❌ No bot found for user ${userIdStr} on ${symbol} at all`);
        }
      }
      
      return bot;
    } catch (error) {
      console.error('Error finding bot by order:', error.message);
      return null;
    }
  }

  // Get or create user-specific Binance service
  async getUserBinanceService(userId) {
    const key = userId.toString();
    if (this.userBinanceServices.has(key)) {
      return this.userBinanceServices.get(key);
    }

    const User = require('../models/User');
    const user = await User.findById(userId).select('+binanceCredentials.apiKey +binanceCredentials.secretKey');
    
    if (!user || !user.hasBinanceCredentials()) {
      throw new Error('User does not have configured Binance credentials');
    }

    const credentials = user.decryptApiCredentials();
    if (!credentials) {
      throw new Error('Failed to decrypt user Binance credentials');
    }

    // Proxy assignment is handled inside BinanceService via ProxyManager
    const userBinanceService = new BinanceService(credentials.apiKey, credentials.secretKey, userId);
    this.userBinanceServices.set(key, userBinanceService);
    return userBinanceService;
  }

  // Clear cached Binance service for a user (useful when proxy issues occur)
  clearUserBinanceService(userId) {
    const key = userId.toString();
    if (this.userBinanceServices.has(key)) {
      console.log(`🗑️ Clearing cached BinanceService for user ${userId}`);
      this.userBinanceServices.delete(key);
    }
  }

  // Get fresh Binance service (bypasses cache)
  async getFreshUserBinanceService(userId) {
    this.clearUserBinanceService(userId);
    return await this.getUserBinanceService(userId);
  }

  // Calculate grid levels and prices
  calculateGridLevels(upperPrice, lowerPrice, gridLevels) {
    const priceRange = upperPrice - lowerPrice;
    const priceStep = priceRange / (gridLevels - 1);
    
    const levels = [];
    for (let i = 0; i < gridLevels; i++) {
      levels.push({
        level: i,
        price: lowerPrice + (priceStep * i),
        type: i === 0 ? 'buy_only' : i === gridLevels - 1 ? 'sell_only' : 'both'
      });
    }
    
    return levels;
  }

  // Calculate quantity for each grid level (only for buy orders)
  calculateGridQuantity(investmentAmount, buyOrderCount, price, symbolInfo) {
    const amountPerBuyOrder = investmentAmount / buyOrderCount;
    let quantity = amountPerBuyOrder / price;
    
    // Round to step size (Binance LOT_SIZE filter)
    const stepSize = symbolInfo.stepSize;
    if (stepSize > 0) {
      quantity = Math.floor(quantity / stepSize) * stepSize;
    }
    
    // Round to symbol precision for display
    const precision = symbolInfo.quantityPrecision;
    quantity = Math.round(quantity * Math.pow(10, precision)) / Math.pow(10, precision);
    
    // Ensure minimum quantity
    if (quantity < symbolInfo.minQty) {
      throw new Error(`Calculated quantity ${quantity} is below minimum ${symbolInfo.minQty}`);
    }
    
    // Ensure minimum notional value
    const notional = quantity * price;
    if (notional < symbolInfo.minNotional) {
      throw new Error(`Order value ${notional} is below minimum notional ${symbolInfo.minNotional}`);
    }
    
    return quantity;
  }

  // Round price to symbol precision and tick size
  roundPrice(price, symbolInfo) {
    // Round to tick size (Binance PRICE_FILTER)
    const tickSize = symbolInfo.tickSize;
    if (tickSize > 0) {
      price = Math.round(price / tickSize) * tickSize;
    }
    
    // Round to precision for display
    const precision = symbolInfo.pricePrecision;
    return Math.round(price * Math.pow(10, precision)) / Math.pow(10, precision);
  }

  // Round quantity to symbol precision
  roundQuantity(quantity, symbolInfo) {
    const precision = symbolInfo.quantityPrecision;
    return Math.floor(quantity * Math.pow(10, precision)) / Math.pow(10, precision);
  }

  // Create initial grid orders
  async createInitialGridOrders(botId) {
    try {
      console.log(`Creating initial grid orders for bot ${botId}`);
      const bot = await GridBot.findOne({ _id: botId, deleted: false });
      if (!bot) throw new Error('Bot not found');

      // Get user-specific Binance service
      const userBinance = await this.getUserBinanceService(bot.userId);
      
      const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);
      const currentPrice = await userBinance.getSymbolPrice(bot.symbol);
      
      console.log(`Current ${bot.symbol} price: ${currentPrice}`);
      
      const gridLevels = this.calculateGridLevels(
        bot.config.upperPrice,
        bot.config.lowerPrice,
        bot.config.gridLevels
      );

      // Count buy orders (below current price)
      const buyOrderCount = gridLevels.filter(level => 
        level.price < currentPrice && (level.type === 'buy_only' || level.type === 'both')
      ).length;

      console.log(`Will place ${buyOrderCount} buy orders below current price`);

      const orders = [];
      let totalInvestmentUsed = 0;
      let buyOrdersPlaced = 0;
      let sellOrdersPlaced = 0;
      const failedOrders = [];
      
      // **CRITICAL: Check balance before each order placement**
      const initialQuoteBalance = await userBinance.getAssetBalance(symbolInfo.quoteAsset);
      console.log(`Initial ${symbolInfo.quoteAsset} balance: ${initialQuoteBalance.free}`);
      
      for (const level of gridLevels) {
        const roundedPrice = this.roundPrice(level.price, symbolInfo);

        // Place buy orders below current price
        if (level.price < currentPrice && (level.type === 'buy_only' || level.type === 'both')) {
          try {
            const quantity = this.calculateGridQuantity(
              bot.config.investmentAmount,
              buyOrderCount,
              roundedPrice,
              symbolInfo
            );
            
            const orderValue = quantity * roundedPrice;
            
            // **REAL-TIME BALANCE CHECK before each order**
            const currentBalance = await userBinance.getAssetBalance(symbolInfo.quoteAsset);
            if (currentBalance.free < orderValue) {
              const errorMsg = `Insufficient balance for buy order at level ${level.level}. Required: ${orderValue}, Available: ${currentBalance.free}`;
              console.error(errorMsg);
              failedOrders.push({ level: level.level, side: 'BUY', error: errorMsg });
              continue;
            }
            
            console.log(`Placing BUY order: ${quantity} ${symbolInfo.baseAsset} at ${roundedPrice} (Value: ${orderValue} ${symbolInfo.quoteAsset})`);
            
            const order = await userBinance.placeLimitOrder(
              bot.symbol,
              'BUY',
              quantity,
              roundedPrice
            );
            
            orders.push({
              orderId: order.orderId,
              side: 'BUY',
              price: roundedPrice,
              quantity: quantity,
              status: 'NEW',
              gridLevel: level.level
            });
            
            totalInvestmentUsed += orderValue;
            buyOrdersPlaced++;
            console.log(`✅ BUY order placed successfully at level ${level.level}`);
            
          } catch (error) {
            const errorMsg = `Failed to place buy order at level ${level.level}: ${error.message}`;
            console.error(errorMsg);
            failedOrders.push({ level: level.level, side: 'BUY', error: errorMsg });
            
            // If it's a balance-related error, stop trying to place more buy orders
            if (error.message.includes('balance') || error.message.includes('insufficient')) {
              console.error('Balance insufficient, stopping buy order placement');
              break;
            }
          }
        }
        
        // Place sell orders above current price (if we have base asset)
        if (level.price > currentPrice && (level.type === 'sell_only' || level.type === 'both')) {
          try {
            // Check if we have enough base asset to sell
            const baseAsset = symbolInfo.baseAsset;
            const balance = await userBinance.getAssetBalance(baseAsset);
            
            // For sell orders, use a standard quantity (can be adjusted based on strategy)
            const sellQuantity = this.calculateGridQuantity(
              bot.config.investmentAmount,
              buyOrderCount,
              roundedPrice,
              symbolInfo
            );
            
            if (balance.free >= sellQuantity) {
              console.log(`Placing SELL order: ${sellQuantity} ${baseAsset} at ${roundedPrice}`);
              
              const order = await userBinance.placeLimitOrder(
                bot.symbol,
                'SELL',
                sellQuantity,
                roundedPrice
              );
              
              orders.push({
                orderId: order.orderId,
                side: 'SELL',
                price: roundedPrice,
                quantity: sellQuantity,
                status: 'NEW',
                gridLevel: level.level
              });
              
              sellOrdersPlaced++;
              console.log(`✅ SELL order placed successfully at level ${level.level}`);
            } else {
              console.log(`Insufficient ${baseAsset} balance for sell order at level ${level.level}. Required: ${sellQuantity}, Available: ${balance.free}`);
            }
          } catch (error) {
            const errorMsg = `Failed to place sell order at level ${level.level}: ${error.message}`;
            console.error(errorMsg);
            failedOrders.push({ level: level.level, side: 'SELL', error: errorMsg });
          }
        }
      }

      // **VALIDATION: Ensure at least some orders were placed**
      if (orders.length === 0) {
        const errorDetails = failedOrders.length > 0 ? 
          `All order placements failed. Errors: ${failedOrders.map(f => f.error).join('; ')}` :
          'No orders could be placed due to configuration or balance issues';
        throw new Error(errorDetails);
      }
      
      if (buyOrdersPlaced === 0 && buyOrderCount > 0) {
        throw new Error(`No buy orders were placed despite ${buyOrderCount} being planned. Check your ${symbolInfo.quoteAsset} balance.`);
      }

      // Update bot with orders
      bot.orders = orders;
      bot.statistics.totalInvestment = totalInvestmentUsed;
      await bot.save();
      
      console.log(`📊 Order placement summary:`);
      console.log(`  - Buy orders placed: ${buyOrdersPlaced}/${buyOrderCount}`);
      console.log(`  - Sell orders placed: ${sellOrdersPlaced}`);
      console.log(`  - Total investment used: ${totalInvestmentUsed} ${symbolInfo.quoteAsset}`);
      console.log(`  - Failed orders: ${failedOrders.length}`);
      
      if (failedOrders.length > 0) {
        console.warn('⚠️  Some orders failed to place:', failedOrders);
      }
      
      return orders;
    } catch (error) {
      console.error('❌ Failed to create initial grid orders:', error.message);
      throw new Error(`Failed to create initial grid orders: ${error.message}`);
    }
  }

  // Monitor and manage grid orders
  async monitorGridOrders(botId) {
    try {
      const bot = await GridBot.findOne({ _id: botId, deleted: false });
      if (!bot || bot.status !== 'active') return;

      const userBinance = await this.getUserBinanceService(bot.userId);
      const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);
      const openOrders = await userBinance.getOpenOrders(bot.symbol);
      const openOrderIds = openOrders.map(o => o.orderId);

      // Check for filled orders
      for (const order of bot.orders) {
        if (order.status === 'NEW' && !openOrderIds.includes(order.orderId)) {
          // Order was filled
          const orderStatus = await userBinance.getOrderStatus(bot.symbol, order.orderId);
          
          if (orderStatus.status === 'FILLED') {
            const orderIndex = bot.orders.findIndex(o => o.orderId === order.orderId);
            if (orderIndex !== -1) {
              bot.orders[orderIndex].status = 'FILLED';
              bot.orders[orderIndex].isFilled = true;
              bot.orders[orderIndex].filledAt = new Date();
              bot.orders[orderIndex].executedQty = parseFloat(orderStatus.executedQty);
              
              // **CRITICAL: Capture executed price for accurate profit calculations**
              if (orderStatus.fills && orderStatus.fills.length > 0) {
                // Calculate weighted average executed price from fills
                let totalQuantity = 0;
                let totalValue = 0;
                
                for (const fill of orderStatus.fills) {
                  const fillQty = parseFloat(fill.qty);
                  const fillPrice = parseFloat(fill.price);
                  totalQuantity += fillQty;
                  totalValue += fillQty * fillPrice;
                }
                
                if (totalQuantity > 0) {
                  bot.orders[orderIndex].executedPrice = totalValue / totalQuantity;
                  console.log(`📊 Order ${order.orderId} executed at average price: ${bot.orders[orderIndex].executedPrice}`);
                }
              } else {
                // Fallback: use order price if no fills data available
                bot.orders[orderIndex].executedPrice = parseFloat(orderStatus.price);
              }
            }
            await this.handleFilledOrder(bot, order, symbolInfo, userBinance);
          }
        }
      }

      await bot.save();
    } catch (error) {
      console.error(`Error monitoring grid orders for bot ${botId}:`, error.message);
      
      // Update bot with error
      const bot = await GridBot.findOne({ _id: botId, deleted: false });
      if (bot) {
        bot.lastError = {
          message: error.message,
          timestamp: new Date()
        };
        await bot.save();
      }
    }
  }

  // Handle filled order and place opposite order
  async handleFilledOrder(bot, filledOrder, symbolInfo, userBinance) {
    try {
      // Update order status
      const orderIndex = bot.orders.findIndex(o => o.orderId === filledOrder.orderId);
      if (orderIndex !== -1) {
        bot.orders[orderIndex].status = 'FILLED';
      }

      // Calculate opposite order price
      const profitMargin = bot.config.profitPerGrid / 100;
      let oppositePrice;
      let oppositeSide;

      if (filledOrder.side === 'BUY') {
        // Place sell order above buy price
        oppositePrice = filledOrder.price * (1 + profitMargin);
        oppositeSide = 'SELL';
      } else {
        // Place buy order below sell price
        oppositePrice = filledOrder.price * (1 - profitMargin);
        oppositeSide = 'BUY';
      }

      // Round price to symbol precision
      oppositePrice = this.roundPrice(oppositePrice, symbolInfo);

      // Check if price is within grid range
      if (oppositePrice >= bot.config.lowerPrice && oppositePrice <= bot.config.upperPrice) {
        try {
          // **FIX: Wait for balance to update after order execution**
          console.log(`Waiting for balance update after ${filledOrder.side} order...`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          
          // **FIX: Calculate actual quantity accounting for trading fees**
          let actualQuantity = filledOrder.quantity;
          
          if (oppositeSide === 'SELL' && filledOrder.side === 'BUY') {
            // For sell orders after buy fills, account for trading fees deducted from purchased asset
            const BINANCE_TRADING_FEE = 0.001; // 0.1%
            
            if (filledOrder.commission && filledOrder.commission > 0 && filledOrder.commissionAsset === symbolInfo.baseAsset) {
              // Use actual commission if available and paid in base asset
              actualQuantity = filledOrder.executedQty - filledOrder.commission;
              console.log(`📊 Using actual commission: ${filledOrder.commission} ${filledOrder.commissionAsset}, Net quantity: ${actualQuantity}`);
            } else {
              // Estimate fee deduction for buy orders (assume fee paid in purchased asset)
              const estimatedFee = filledOrder.executedQty * BINANCE_TRADING_FEE;
              actualQuantity = filledOrder.executedQty - estimatedFee;
              console.log(`📊 Estimated trading fee: ${estimatedFee}, Net quantity: ${actualQuantity}`);
            }
            
            // Round down to symbol precision
            if (symbolInfo.stepSize > 0) {
              actualQuantity = Math.floor(actualQuantity / symbolInfo.stepSize) * symbolInfo.stepSize;
            }
            if (symbolInfo.quantityPrecision >= 0) {
              const p = Math.pow(10, symbolInfo.quantityPrecision);
              actualQuantity = Math.floor(actualQuantity * p) / p;
            }
            
            console.log(`🔧 Fee-adjusted sell quantity: ${actualQuantity} (original: ${filledOrder.quantity})`);
          }
          
          // **FIX: Check balance before placing opposite order**
          if (oppositeSide === 'SELL') {
            const baseBalance = await userBinance.getAssetBalance(symbolInfo.baseAsset);
            console.log(`${symbolInfo.baseAsset} balance: ${baseBalance.free}, Required: ${actualQuantity}`);
            
            if (baseBalance.free < actualQuantity) {
              console.error(`❌ Insufficient ${symbolInfo.baseAsset} balance for sell order. Available: ${baseBalance.free}, Required: ${actualQuantity}`);
              return; // Exit without setting hasCorrespondingSell flag
            }
          } else {
            const quoteBalance = await userBinance.getAssetBalance(symbolInfo.quoteAsset);
            const requiredAmount = actualQuantity * oppositePrice;
            console.log(`${symbolInfo.quoteAsset} balance: ${quoteBalance.free}, Required: ${requiredAmount}`);
            
            if (quoteBalance.free < requiredAmount) {
              console.error(`❌ Insufficient ${symbolInfo.quoteAsset} balance for buy order. Available: ${quoteBalance.free}, Required: ${requiredAmount}`);
              return; // Exit without setting hasCorrespondingSell flag
            }
          }
          
          const oppositeOrder = await userBinance.placeLimitOrder(
            bot.symbol,
            oppositeSide,
            actualQuantity,
            oppositePrice
          );

          // Add new order to bot
          bot.orders.push({
            orderId: oppositeOrder.orderId,
            side: oppositeSide,
            price: oppositePrice,
            quantity: actualQuantity,
            status: 'NEW',
            gridLevel: filledOrder.gridLevel
          });

          // Mark buy order as having corresponding sell ONLY after successful placement
          if (filledOrder.side === 'BUY') {
            const buyOrderIndex = bot.orders.findIndex(o => o.orderId === filledOrder.orderId);
            if (buyOrderIndex !== -1) {
              bot.orders[buyOrderIndex].hasCorrespondingSell = true;
            }
          }

          console.log(`✅ Successfully placed opposite ${oppositeSide} order ${oppositeOrder.orderId} for bot ${bot._id} at price ${oppositePrice}`);

          // Update statistics
          bot.statistics.totalTrades += 1;
          bot.statistics.successfulTrades += 1;
          
          if (filledOrder.side === 'SELL') {
            // Calculate profit (only count when selling)
            // Find the corresponding buy order to calculate actual profit
            const correspondingBuyOrder = bot.orders.find(o => 
              o.side === 'BUY' && 
              o.status === 'FILLED' && 
              o.hasCorrespondingSell && 
              Math.abs(o.price * (1 + profitMargin) - filledOrder.price) < filledOrder.price * 0.02
            );
            
            if (correspondingBuyOrder) {
              // Use actual executed prices for accurate profit calculation
              const buyPrice = correspondingBuyOrder.executedPrice || correspondingBuyOrder.price;
              const sellPrice = filledOrder.executedPrice || filledOrder.price;
              const profit = (sellPrice - buyPrice) * filledOrder.quantity;
              bot.statistics.totalProfit += profit;
              console.log(`💰 Profit calculated: (${sellPrice} - ${buyPrice}) * ${filledOrder.quantity} = ${profit}`);
            } else {
              console.warn(`⚠️ Could not find corresponding buy order for sell order ${filledOrder.orderId}`);
            }
          }

          console.log(`Placed opposite ${oppositeSide} order for bot ${bot._id} at price ${oppositePrice}`);
        } catch (error) {
          console.error(`❌ Failed to place opposite order for bot ${bot._id}:`, error.message);
          // Don't set hasCorrespondingSell flag if order placement failed
        }
      } else {
        console.log(`⚠️  Opposite order price ${oppositePrice} is outside grid range (${bot.config.lowerPrice} - ${bot.config.upperPrice})`);
      }
    } catch (error) {
      console.error(`Error handling filled order:`, error.message);
    }
  }

  // Start a grid bot
  async startBot(botId) {
    try {
      console.log(`Starting bot ${botId}...`);
      const bot = await GridBot.findOne({ _id: botId, deleted: false });
      if (!bot) throw new Error('Bot not found');

      if (bot.status === 'active') {
        throw new Error('Bot is already active');
      }

      // Get user-specific Binance service
      const userBinance = await this.getUserBinanceService(bot.userId);

      // **STEP 1: Validate bot configuration and balance**
      console.log('Step 1: Validating bot configuration...');
      await this.validateBotConfig(bot, userBinance);
      console.log('Configuration validation passed');

      // **STEP 2: Real-time balance check before order placement**
      console.log('Step 2: Final balance verification before order placement...');
      const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);
      const quoteBalance = await userBinance.getAssetBalance(symbolInfo.quoteAsset);
      
      if (quoteBalance.free < bot.config.investmentAmount) {
        throw new Error(`Insufficient ${symbolInfo.quoteAsset} balance at order placement time. Required: ${bot.config.investmentAmount}, Available: ${quoteBalance.free}`);
      }
      console.log(`Balance verified: ${quoteBalance.free} ${symbolInfo.quoteAsset} available`);

      // **STEP 3: Create initial grid orders with enhanced error handling**
      console.log('Step 3: Creating initial grid orders...');
      let ordersCreated;
      try {
        ordersCreated = await this.createInitialGridOrders(botId);
        console.log(`Successfully created ${ordersCreated.length} initial orders`);
      } catch (orderError) {
        console.error('Failed to create initial orders:', orderError.message);
        
        // If order creation fails, ensure bot status remains unchanged
        throw new Error(`Order placement failed: ${orderError.message}. Please check your balance and try again.`);
      }

      if (!ordersCreated || ordersCreated.length === 0) {
        throw new Error('No orders were created. Please check your configuration and balance.');
      }

      // **STEP 4: Update bot status only after successful order placement**
      console.log('Step 4: Updating bot status to active...');
      bot.status = 'active';
      bot.statistics.startTime = new Date();
      await bot.save();

      // **STEP 5: Start monitoring**
      console.log('Step 5: Starting order monitoring...');
      const monitorInterval = setInterval(() => {
        this.monitorGridOrders(botId).catch(error => {
          console.error(`Monitoring error for bot ${botId}:`, error.message);
        });
      }, 30000); // Check every 30 seconds to avoid rate limits

      this.intervals.set(botId, monitorInterval);
      this.activeBots.set(botId, bot);

      console.log(`✅ Grid bot ${botId} started successfully with ${ordersCreated.length} orders`);
      return { 
        success: true, 
        message: 'Bot started successfully',
        ordersPlaced: ordersCreated.length,
        investmentAllocated: bot.config.investmentAmount,
        balanceRemaining: quoteBalance.free - bot.config.investmentAmount
      };
    } catch (error) {
      console.error(`❌ Failed to start bot ${botId}:`, error.message);
      
      // Cleanup: Ensure bot status is not left in inconsistent state
      try {
        const bot = await GridBot.findOne({ _id: botId, deleted: false });
        if (bot && bot.status !== 'paused') {
          bot.status = 'paused';
          await bot.save();
          console.log(`Reset bot ${botId} status to paused after startup failure`);
        }
      } catch (cleanupError) {
        console.error('Failed to cleanup bot status:', cleanupError.message);
      }
      
      throw new Error(`Failed to start bot: ${error.message}`);
    }
  }

  // Stop a grid bot
  async stopBot(botId) {
    try {
      const bot = await GridBot.findOne({ _id: botId, deleted: false });
      if (!bot) throw new Error('Bot not found');

      // Cancel all open orders
      console.log(`Stopping bot ${botId} - fetching open orders for ${bot.symbol}`);
      const userBinance = await this.getUserBinanceService(bot.userId);
      const openOrders = await userBinance.getOpenOrders(bot.symbol);
      const botOrderIds = bot.orders.map(o => o.orderId.toString()); // Ensure string comparison
      
      console.log(`Found ${openOrders.length} open orders on Binance`);
      console.log(`Bot has ${botOrderIds.length} tracked orders:`, botOrderIds);
      
      let canceledCount = 0;
      for (const order of openOrders) {
        const orderIdStr = order.orderId.toString(); // Convert to string for comparison
        console.log(`Checking order ${orderIdStr} - is bot order: ${botOrderIds.includes(orderIdStr)}`);
        if (botOrderIds.includes(orderIdStr)) {
          try {
            console.log(`Canceling order ${order.orderId}`);
            await userBinance.cancelOrder(bot.symbol, order.orderId);
            canceledCount++;
            console.log(`Successfully canceled order ${order.orderId}`);
            
            // Update order status in bot records
             const botOrder = bot.orders.find(o => o.orderId.toString() === orderIdStr);
             if (botOrder) {
               botOrder.status = 'CANCELED';
             }
          } catch (error) {
            console.error(`Failed to cancel order ${order.orderId}:`, error.message);
          }
        }
      }
      
      console.log(`Canceled ${canceledCount} orders for bot ${botId}`);

      // Calculate total purchased quantity to liquidate
      let totalPurchasedQuantity = 0;
      const filledBuyOrders = bot.orders.filter(order => 
        order.side === 'BUY' && order.status === 'FILLED'
      );
      
      for (const buyOrder of filledBuyOrders) {
        totalPurchasedQuantity += parseFloat(buyOrder.quantity);
      }

      // Liquidate all purchased assets if any
      if (totalPurchasedQuantity > 0) {
        try {
          const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);
          
          // Round quantity to symbol precision
          const roundedQuantity = this.roundQuantity(totalPurchasedQuantity, symbolInfo);
          
          if (roundedQuantity >= symbolInfo.minQty) {
            console.log(`Liquidating ${roundedQuantity} ${symbolInfo.baseAsset} for bot ${botId}`);
            
            const marketSellOrder = await userBinance.placeMarketOrder(
              bot.symbol,
              'SELL',
              roundedQuantity
            );
            
            // Add liquidation order to bot records
            bot.orders.push({
              orderId: marketSellOrder.orderId,
              side: 'SELL',
              price: 0, // Market order, price determined by market
              quantity: roundedQuantity,
              status: 'FILLED',
              gridLevel: -1, // Special indicator for liquidation order
              isLiquidation: true
            });
            
            console.log(`Successfully liquidated ${roundedQuantity} ${symbolInfo.baseAsset}`);
          } else {
            console.log(`Quantity ${roundedQuantity} below minimum, skipping liquidation`);
          }
        } catch (error) {
          console.error(`Failed to liquidate assets:`, error.message);
          // Don't throw error here, still want to stop the bot even if liquidation fails
        }
      }

      // Update bot status
      bot.status = 'stopped';
      await bot.save();

      // Clear monitoring
      if (this.intervals.has(botId)) {
        clearInterval(this.intervals.get(botId));
        this.intervals.delete(botId);
      }
      this.activeBots.delete(botId);

      console.log(`Grid bot ${botId} stopped successfully`);
      return { 
        success: true, 
        message: 'Bot stopped successfully', 
        liquidated: totalPurchasedQuantity > 0 ? totalPurchasedQuantity : 0
      };
    } catch (error) {
      throw new Error(`Failed to stop bot: ${error.message}`);
    }
  }

  // Validate bot configuration
  async validateBotConfig(bot, userBinance) {
    try {
      console.log(`Validating bot configuration for ${bot.symbol}`);
      
      // Check symbol exists
      const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);
      console.log(`Symbol ${bot.symbol} found with minNotional: ${symbolInfo.minNotional}`);
      
      // Check price range
      if (bot.config.upperPrice <= bot.config.lowerPrice) {
        throw new Error('Upper price must be greater than lower price');
      }

      // Check current price is within range
      const currentPrice = await userBinance.getSymbolPrice(bot.symbol);
      console.log(`Current price: ${currentPrice}, Range: ${bot.config.lowerPrice} - ${bot.config.upperPrice}`);
      
      if (currentPrice < bot.config.lowerPrice || currentPrice > bot.config.upperPrice) {
        throw new Error(`Current price (${currentPrice}) is outside the configured grid range (${bot.config.lowerPrice} - ${bot.config.upperPrice})`);
      }

      // Check minimum investment per grid
      const minNotional = symbolInfo.minNotional;
      const buyOrderCount = this.calculateBuyOrderCount(bot.config, currentPrice);
      const amountPerBuyOrder = bot.config.investmentAmount / buyOrderCount;
      
      console.log(`Buy orders: ${buyOrderCount}, Amount per buy order: ${amountPerBuyOrder}, Min notional: ${minNotional}`);
      
      if (amountPerBuyOrder < minNotional) {
        throw new Error(`Investment amount per buy order (${amountPerBuyOrder.toFixed(2)}) is below minimum notional (${minNotional}). Increase investment amount or reduce grid levels.`);
      }

      // **CRITICAL: Check user balance before creating orders**
      await this.validateUserBalance(bot, symbolInfo, userBinance);

      console.log('Bot configuration validation passed');
      return true;
    } catch (error) {
      console.error('Bot validation failed:', error.message);
      throw error;
    }
  }

  // Calculate number of buy orders based on current price
  calculateBuyOrderCount(config, currentPrice) {
    const priceStep = (config.upperPrice - config.lowerPrice) / config.gridLevels;
    let buyOrderCount = 0;
    
    for (let i = 0; i < config.gridLevels; i++) {
      const gridPrice = config.lowerPrice + (i * priceStep);
      if (gridPrice < currentPrice) {
        buyOrderCount++;
      }
    }
    
    return Math.max(buyOrderCount, 1); // At least 1 buy order
  }

  // Validate user has sufficient balance
  async validateUserBalance(bot, symbolInfo, userBinance) {
    try {
      console.log('🔍 Performing comprehensive balance validation...');
      
      // Get quote asset (USDT for BTCUSDT)
      const quoteAsset = symbolInfo.quoteAsset;
      const baseAsset = symbolInfo.baseAsset;
      
      // Get user's quote asset balance (for buying)
      const quoteBalance = await userBinance.getAssetBalance(quoteAsset);
      const baseBalance = await userBinance.getAssetBalance(baseAsset);
      
      console.log(`💰 Account Balance Summary:`);
      console.log(`  ${quoteAsset} - Free: ${quoteBalance.free}, Locked: ${quoteBalance.locked}, Total: ${parseFloat(quoteBalance.free) + parseFloat(quoteBalance.locked)}`);
      console.log(`  ${baseAsset} - Free: ${baseBalance.free}, Locked: ${baseBalance.locked}, Total: ${parseFloat(baseBalance.free) + parseFloat(baseBalance.locked)}`);
      
      // **CRITICAL: Check if user has enough quote asset for investment**
      if (quoteBalance.free < bot.config.investmentAmount) {
        const shortfall = bot.config.investmentAmount - quoteBalance.free;
        throw new Error(`Insufficient ${quoteAsset} balance. Required: ${bot.config.investmentAmount}, Available: ${quoteBalance.free}, Shortfall: ${shortfall}. Please deposit at least ${shortfall} ${quoteAsset} to proceed.`);
      }
      
      // **ENHANCED: Multiple safety checks**
      const requiredWithBuffer = bot.config.investmentAmount * 1.05; // 5% buffer for fees
      const requiredWithHighBuffer = bot.config.investmentAmount * 1.10; // 10% buffer for safety
      
      if (quoteBalance.free < requiredWithBuffer) {
        console.warn(`⚠️  LOW BALANCE WARNING: Your balance is very close to the investment amount. Consider keeping 5% buffer for trading fees.`);
        console.warn(`   Current: ${quoteBalance.free} ${quoteAsset}, Recommended minimum: ${requiredWithBuffer} ${quoteAsset}`);
      }
      
      if (quoteBalance.free < requiredWithHighBuffer) {
        console.warn(`⚠️  SAFETY WARNING: Consider keeping 10% buffer for optimal trading experience.`);
      }
      
      // **NEW: Check if investment amount is reasonable relative to total balance**
      const totalQuoteBalance = parseFloat(quoteBalance.free) + parseFloat(quoteBalance.locked);
      const investmentPercentage = (bot.config.investmentAmount / totalQuoteBalance) * 100;
      
      if (investmentPercentage > 90) {
        console.warn(`⚠️  HIGH RISK WARNING: You're investing ${investmentPercentage.toFixed(1)}% of your total ${quoteAsset} balance. Consider reducing investment amount for risk management.`);
      }
      
      // **NEW: Validate minimum order requirements**
      const currentPrice = await this.binance.getSymbolPrice(bot.symbol);
      const buyOrderCount = this.calculateBuyOrderCount(bot.config, currentPrice);
      const amountPerOrder = bot.config.investmentAmount / buyOrderCount;
      const minOrderValue = symbolInfo.minNotional;
      
      if (amountPerOrder < minOrderValue * 1.1) { // 10% buffer above minimum
        console.warn(`⚠️  ORDER SIZE WARNING: Each order value (${amountPerOrder.toFixed(2)} ${quoteAsset}) is close to minimum (${minOrderValue} ${quoteAsset}). Consider increasing investment amount.`);
      }
      
      console.log(`✅ Balance validation passed:`);
      console.log(`  - Investment amount: ${bot.config.investmentAmount} ${quoteAsset}`);
      console.log(`  - Available balance: ${quoteBalance.free} ${quoteAsset}`);
      console.log(`  - Remaining after investment: ${(quoteBalance.free - bot.config.investmentAmount).toFixed(4)} ${quoteAsset}`);
      console.log(`  - Investment percentage: ${investmentPercentage.toFixed(1)}% of total balance`);
      
      return {
        success: true,
        balanceInfo: {
          quoteAsset,
          baseAsset,
          quoteBalance: quoteBalance.free,
          baseBalance: baseBalance.free,
          investmentAmount: bot.config.investmentAmount,
          remainingBalance: quoteBalance.free - bot.config.investmentAmount,
          investmentPercentage: investmentPercentage.toFixed(1)
        }
      };
    } catch (error) {
      console.error('❌ Balance validation failed:', error.message);
      throw new Error(`Balance validation failed: ${error.message}`);
    }
  }

  // Get bot performance
  async getBotPerformance(botId) {
    try {
      const bot = await GridBot.findOne({ _id: botId, deleted: false });
      if (!bot) throw new Error('Bot not found');

       const userBinance = await this.getUserBinanceService(bot.userId);
      
      const currentPrice = await userBinance.getSymbolPrice(bot.symbol);
      const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);
      
      // Calculate unrealized PnL
      let unrealizedPnL = 0;
      const openOrders = bot.orders.filter(o => o.status === 'NEW');
      
      for (const order of openOrders) {
        if (order.side === 'BUY' && currentPrice < order.price) {
          // Potential profit if price goes up
          unrealizedPnL += (currentPrice - order.price) * order.quantity;
        } else if (order.side === 'SELL' && currentPrice > order.price) {
          // Potential profit if price goes down
          unrealizedPnL += (order.price - currentPrice) * order.quantity;
        }
      }

      return {
        botId: bot._id,
        symbol: bot.symbol,
        status: bot.status,
        currentPrice,
        gridRange: {
          upper: bot.config.upperPrice,
          lower: bot.config.lowerPrice,
          levels: bot.config.gridLevels
        },
        statistics: {
          ...bot.statistics,
          unrealizedPnL,
          totalPnL: bot.statistics.totalProfit + unrealizedPnL
        },
        activeOrders: openOrders.length,
        totalOrders: bot.orders.length
      };
    } catch (error) {
      throw new Error(`Failed to get bot performance: ${error.message}`);
    }
  }

  // Get detailed bot analysis with complete trade history and PnL breakdown
  async getDetailedBotAnalysis(botId) {
    try {
      const bot = await GridBot.findOne({ _id: botId, deleted: false });
      if (!bot) throw new Error('Bot not found');

      const userBinance = await this.getUserBinanceService(bot.userId);
      
      // Get current price with enhanced error handling
      let currentPrice;
      try {
        currentPrice = await userBinance.getSymbolPrice(bot.symbol);
      } catch (priceError) {
        console.error(`Price fetch failed for ${bot.symbol} in analysis:`, priceError.message);
        // Try to use the last known price if available
        if (bot.aiAnalysis && bot.aiAnalysis.marketData && bot.aiAnalysis.marketData.currentPrice) {
          console.warn(`Using AI analysis cached price for ${bot.symbol}: ${bot.aiAnalysis.marketData.currentPrice}`);
          currentPrice = bot.aiAnalysis.marketData.currentPrice;
        } else {
          // If no fallback price available, throw with user-friendly message
          throw new Error(`Cannot retrieve current price for ${bot.symbol}. This may be due to Binance rate limiting. Please try again in a few minutes.`);
        }
      }
      
      const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);
      
      // **FIX: Sync order status with Binance before analysis**
      console.log(`Syncing order status with Binance for bot ${botId}...`);
      await this.syncOrderStatusWithBinance(bot, userBinance);
      
      // Reload bot after sync to get updated order statuses
      const updatedBot = await GridBot.findOne({ _id: botId, deleted: false });
      
      // Separate orders by status and type
      const filledOrders = updatedBot.orders.filter(o => o.status === 'FILLED');
      const openOrders = updatedBot.orders.filter(o => o.status === 'NEW');
      const canceledOrders = updatedBot.orders.filter(o => o.status === 'CANCELED');
      
      // Calculate trade pairs (buy-sell cycles)
      const tradePairs = this.calculateTradePairs(filledOrders);
      
      // Calculate realized PnL from completed trades
      let realizedPnL = 0;
      const completedTrades = [];
      
      for (const pair of tradePairs) {
        if (pair.buyOrder && pair.sellOrder) {
          // Use executed prices for accurate profit calculation
          const buyPrice = pair.buyOrder.executedPrice || pair.buyOrder.price;
          const sellPrice = pair.sellOrder.executedPrice || pair.sellOrder.price;
          const buyQty = pair.buyOrder.executedQty || pair.buyOrder.quantity;
          const sellQty = pair.sellOrder.executedQty || pair.sellOrder.quantity;
          
          // Use the smaller quantity to calculate profit (in case of partial fills)
          const tradeQty = Math.min(buyQty, sellQty);
          const profit = (sellPrice - buyPrice) * tradeQty;
          realizedPnL += profit;
          
          completedTrades.push({
            tradeId: `${pair.buyOrder.orderId}-${pair.sellOrder.orderId}`,
            buyOrder: {
              orderId: pair.buyOrder.orderId,
              price: buyPrice,
              quantity: tradeQty,
              timestamp: pair.buyOrder.timestamp || 'N/A',
              gridLevel: pair.buyOrder.gridLevel
            },
            sellOrder: {
              orderId: pair.sellOrder.orderId,
              price: sellPrice,
              quantity: tradeQty,
              timestamp: pair.sellOrder.timestamp || 'N/A',
              gridLevel: pair.sellOrder.gridLevel
            },
            profit: profit,
            profitPercentage: buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice * 100).toFixed(4) : '0.0000',
            duration: pair.sellOrder.timestamp && pair.buyOrder.timestamp ? 
              new Date(pair.sellOrder.timestamp) - new Date(pair.buyOrder.timestamp) : 'N/A'
          });
        }
      }
      
      // Calculate current holdings (filled buy orders without corresponding sell orders)
      const currentHoldings = this.calculateCurrentHoldings(filledOrders);
      let holdingsValue = 0;
      let unrealizedPnL = 0;
      
      for (const holding of currentHoldings) {
        const currentValue = holding.quantity * currentPrice;
        const costBasis = holding.quantity * holding.avgPrice;
        holdingsValue += currentValue;
        unrealizedPnL += (currentValue - costBasis);
      }
      
      // Calculate potential profit from open orders
      let potentialProfit = 0;
      const openOrdersAnalysis = [];
      
      for (const order of openOrders) {
        let potential = 0;
        let status = 'waiting';
        
        if (order.side === 'BUY') {
          if (currentPrice <= order.price) {
            status = 'likely_to_fill';
          }
          potential = (updatedBot.config.profitPerGrid / 100) * order.price * order.quantity;
        } else {
          if (currentPrice >= order.price) {
            status = 'likely_to_fill';
          }
          // For sell orders, profit is already calculated when buy order was filled
          potential = (order.price - (order.price / (1 + updatedBot.config.profitPerGrid / 100))) * order.quantity;
        }
        
        potentialProfit += potential;
        
        openOrdersAnalysis.push({
          orderId: order.orderId,
          side: order.side,
          price: order.price,
          quantity: order.quantity,
          gridLevel: order.gridLevel,
          distanceFromCurrent: ((order.price - currentPrice) / currentPrice * 100).toFixed(4),
          potentialProfit: potential,
          status: status
        });
      }
      
      // Calculate total investment and returns
      const totalInvestment = updatedBot.statistics.totalInvestment || updatedBot.config.investmentAmount;
      const totalValue = holdingsValue + (updatedBot.statistics.totalProfit || 0);
      const totalReturn = totalValue - totalInvestment;
      const totalReturnPercentage = (totalReturn / totalInvestment * 100).toFixed(4);
      
      // Calculate trading fees (approximate)
      const totalTrades = filledOrders.length;
      const estimatedFees = totalTrades * 0.001 * (totalInvestment / updatedBot.config.gridLevels); // 0.1% fee estimate
      
      return {
        botInfo: {
          botId: updatedBot._id,
          symbol: updatedBot.symbol,
          status: updatedBot.status,
          createdAt: updatedBot.createdAt,
          startTime: updatedBot.statistics.startTime,
          runtime: updatedBot.statistics.startTime ? 
            Math.floor((new Date() - new Date(updatedBot.statistics.startTime)) / (1000 * 60 * 60)) + ' hours' : 'N/A'
        },
        marketData: {
          currentPrice: currentPrice,
          gridRange: {
            upper: updatedBot.config.upperPrice,
            lower: updatedBot.config.lowerPrice,
            levels: updatedBot.config.gridLevels,
            profitPerGrid: updatedBot.config.profitPerGrid
          },
          pricePosition: {
            percentage: ((currentPrice - updatedBot.config.lowerPrice) / (updatedBot.config.upperPrice - updatedBot.config.lowerPrice) * 100).toFixed(2),
            trend: currentPrice > (updatedBot.config.upperPrice + updatedBot.config.lowerPrice) / 2 ? 'upper_half' : 'lower_half'
          }
        },
        profitLossAnalysis: {
          realizedPnL: realizedPnL,
          unrealizedPnL: unrealizedPnL,
          totalPnL: realizedPnL + unrealizedPnL,
          potentialProfit: potentialProfit,
          totalInvestment: totalInvestment,
          currentValue: totalValue,
          totalReturn: totalReturn,
          totalReturnPercentage: totalReturnPercentage,
          estimatedFees: estimatedFees,
          netProfit: (realizedPnL + unrealizedPnL - estimatedFees)
        },
        tradingActivity: {
          completedTrades: completedTrades.length,
          totalTrades: totalTrades,
          successfulTrades: updatedBot.statistics.successfulTrades || completedTrades.length,
          averageTradeProfit: completedTrades.length > 0 ? 
            (realizedPnL / completedTrades.length).toFixed(6) : 0,
          bestTrade: completedTrades.length > 0 ? 
            completedTrades.reduce((best, trade) => trade.profit > best.profit ? trade : best) : null,
          worstTrade: completedTrades.length > 0 ? 
            completedTrades.reduce((worst, trade) => trade.profit < worst.profit ? trade : worst) : null
        },
        currentPositions: {
          holdings: currentHoldings,
          holdingsValue: holdingsValue,
          openOrders: openOrdersAnalysis,
          totalOpenOrders: openOrders.length,
          buyOrders: openOrders.filter(o => o.side === 'BUY').length,
          sellOrders: openOrders.filter(o => o.side === 'SELL').length
        },
        tradeHistory: {
          completedTrades: completedTrades,
          allOrders: bot.orders.map(order => ({
            orderId: order.orderId,
            side: order.side,
            price: order.price,
            quantity: order.quantity,
            status: order.status,
            gridLevel: order.gridLevel,
            timestamp: order.timestamp || 'N/A',
            isLiquidation: order.isLiquidation || false
          })),
          canceledOrders: canceledOrders.length
        },
        performance: {
          gridEfficiency: (completedTrades.length / bot.config.gridLevels * 100).toFixed(2),
          averageHoldTime: this.calculateAverageHoldTime(completedTrades),
          profitConsistency: this.calculateProfitConsistency(completedTrades),
          riskMetrics: {
            maxDrawdown: this.calculateMaxDrawdown(completedTrades),
            sharpeRatio: this.calculateSharpeRatio(completedTrades),
            winRate: completedTrades.length > 0 ? 
              (completedTrades.filter(t => t.profit > 0).length / completedTrades.length * 100).toFixed(2) : 0
          }
        }
      };
    } catch (error) {
      throw new Error(`Failed to get detailed bot analysis: ${error.message}`);
    }
  }
  
  // Helper function to calculate trade pairs
  calculateTradePairs(filledOrders) {
    const buyOrders = filledOrders.filter(o => o.side === 'BUY' && !o.isLiquidation);
    const sellOrders = filledOrders.filter(o => o.side === 'SELL' && !o.isLiquidation);
    const pairs = [];
    
    // Simple pairing logic - can be enhanced for more complex scenarios
    const usedSellOrders = new Set();
    
    for (const buyOrder of buyOrders) {
      const matchingSellOrder = sellOrders.find(sellOrder => 
        !usedSellOrders.has(sellOrder.orderId) && 
        sellOrder.quantity === buyOrder.quantity &&
        sellOrder.gridLevel === buyOrder.gridLevel
      );
      
      if (matchingSellOrder) {
        pairs.push({ buyOrder, sellOrder: matchingSellOrder });
        usedSellOrders.add(matchingSellOrder.orderId);
      } else {
        pairs.push({ buyOrder, sellOrder: null });
      }
    }
    
    return pairs;
  }
  
  // Helper function to calculate current holdings
  calculateCurrentHoldings(filledOrders) {
    const buyOrders = filledOrders.filter(o => o.side === 'BUY' && !o.isLiquidation);
    const sellOrders = filledOrders.filter(o => o.side === 'SELL' && !o.isLiquidation);
    
    let totalBought = 0;
    let totalCost = 0;
    let totalSold = 0;
    
    for (const order of buyOrders) {
      // Use executed quantity and price for accurate calculations
      const executedQty = order.executedQty || order.quantity;
      const executedPrice = order.executedPrice || order.price;
      
      totalBought += executedQty;
      totalCost += executedQty * executedPrice;
    }
    
    for (const order of sellOrders) {
      // Use executed quantity for accurate calculations
      const executedQty = order.executedQty || order.quantity;
      totalSold += executedQty;
    }
    
    const currentQuantity = totalBought - totalSold;
    const avgPrice = currentQuantity > 0 ? totalCost / totalBought : 0;
    
    return currentQuantity > 0 ? [{
      quantity: currentQuantity,
      avgPrice: avgPrice,
      totalCost: currentQuantity * avgPrice
    }] : [];
  }
  
  // Helper functions for performance metrics
  calculateAverageHoldTime(completedTrades) {
    if (completedTrades.length === 0) return 'N/A';
    
    const validTrades = completedTrades.filter(t => t.duration !== 'N/A');
    if (validTrades.length === 0) return 'N/A';
    
    const avgMs = validTrades.reduce((sum, trade) => sum + trade.duration, 0) / validTrades.length;
    const avgHours = Math.floor(avgMs / (1000 * 60 * 60));
    const avgMinutes = Math.floor((avgMs % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${avgHours}h ${avgMinutes}m`;
  }
  
  calculateProfitConsistency(completedTrades) {
    if (completedTrades.length < 2) return 'N/A';
    
    const profits = completedTrades.map(t => t.profit);
    const mean = profits.reduce((sum, p) => sum + p, 0) / profits.length;
    const variance = profits.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / profits.length;
    const stdDev = Math.sqrt(variance);
    
    return mean !== 0 ? (stdDev / Math.abs(mean)).toFixed(4) : 'N/A';
  }
  
  calculateMaxDrawdown(completedTrades) {
    if (completedTrades.length === 0) return 0;
    
    let peak = 0;
    let maxDrawdown = 0;
    let runningProfit = 0;
    
    for (const trade of completedTrades) {
      runningProfit += trade.profit;
      if (runningProfit > peak) {
        peak = runningProfit;
      }
      const drawdown = peak - runningProfit;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown.toFixed(6);
  }
  
  calculateSharpeRatio(completedTrades) {
    if (completedTrades.length < 2) return 'N/A';
    
    const profits = completedTrades.map(t => t.profit);
    const mean = profits.reduce((sum, p) => sum + p, 0) / profits.length;
    const variance = profits.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / profits.length;
    const stdDev = Math.sqrt(variance);
    
    return stdDev !== 0 ? (mean / stdDev).toFixed(4) : 'N/A';
  }

  // Sync order status with Binance
  async syncOrderStatusWithBinance(bot, userBinance) {
    try {
      let hasUpdates = false;

      // Get all orders that might need status updates (NEW, PARTIALLY_FILLED)
      const ordersToCheck = bot.orders.filter(order => 
        ['NEW', 'PARTIALLY_FILLED'].includes(order.status)
      );

      for (const order of ordersToCheck) {
        try {
          // Query order status from Binance
          const binanceOrder = await userBinance.getOrderStatus(bot.symbol, order.orderId);

          // Update order if status has changed
          if (binanceOrder.status !== order.status) {
            order.status = binanceOrder.status;
            order.executedQty = binanceOrder.executedQty;
            order.cummulativeQuoteQty = binanceOrder.cummulativeQuoteQty;
            order.updatedAt = new Date();
            hasUpdates = true;

            console.log(`Updated order ${order.orderId} status from ${order.status} to ${binanceOrder.status}`);
          }
        } catch (orderError) {
          console.error(`Error checking order ${order.orderId}:`, orderError.message);
          // Continue with other orders even if one fails
        }
      }

      // Save updates if any
      if (hasUpdates) {
        await bot.save();
        console.log(`Synced order statuses for bot ${bot._id}`);
      }

      return hasUpdates;
    } catch (error) {
      console.error('Error syncing order status with Binance:', error);
      return false;
    }
  }

  // **NEW: WebSocket handler for filled orders**
  async handleWebSocketFilledOrder(userId, symbol, orderId, side, executedQty, price, executedPrice, commission, commissionAsset) {
    try {
      console.log(`🔔 WebSocket FILLED order detected: ${side} ${executedQty} ${symbol} @ ${price} (ID: ${orderId})`);
      
      // Find the bot that owns this order
      const bot = await this.findBotByOrder(userId, orderId, symbol);
      if (!bot) {
        console.warn(`⚠️ No bot found for filled order ${orderId} (user: ${userId}, symbol: ${symbol})`);
        return;
      }

      console.log(`✅ Found bot ${bot._id} for filled order ${orderId}`);

      // Find the specific order in the bot
      const orderIndex = bot.orders.findIndex(o => o.orderId.toString() === orderId.toString());
      if (orderIndex === -1) {
        console.warn(`⚠️ Order ${orderId} not found in bot ${bot._id} orders`);
        return;
      }

      const order = bot.orders[orderIndex];
      
      // Update order status with WebSocket data
      order.status = 'FILLED';
      order.isFilled = true;
      order.filledAt = new Date();
      order.executedQty = parseFloat(executedQty);
      order.executedPrice = parseFloat(executedPrice || price);
      
      if (commission && commission > 0) {
        order.commission = parseFloat(commission);
        order.commissionAsset = commissionAsset;
      }

      console.log(`📊 Updated order ${orderId} status to FILLED with executed price: ${order.executedPrice}`);

      // Get user-specific Binance service and symbol info
      const userBinance = await this.getUserBinanceService(userId);
      const symbolInfo = await userBinance.getSymbolInfo(symbol);

      // Handle the filled order (place opposite order)
      await this.handleFilledOrder(bot, order, symbolInfo, userBinance);

      // Save the bot with updated order status
      await bot.save();
      
      console.log(`✅ Successfully processed WebSocket filled order ${orderId} for bot ${bot._id}`);

    } catch (error) {
      console.error(`❌ Error handling WebSocket filled order ${orderId}:`, error.message);
    }
  }
}

module.exports = GridBotService;
