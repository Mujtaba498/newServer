const GridBot = require('../models/GridBot');
const BinanceService = require('./binanceService');
const WebSocketManager = require('./webSocketManager');

class RecoveryService {
  constructor() {
    this.isRecoveryInProgress = false;
  }

  /**
   * Main recovery method - checks all active bots and recovers from crashes
   */
  async performRecovery() {
    if (this.isRecoveryInProgress) {
      console.log('Recovery already in progress, skipping...');
      return;
    }

    this.isRecoveryInProgress = true;
    console.log('Starting bot recovery process...');

    try {
      // Find all bots that should be running
      const activeBots = await GridBot.find({ 
        status: { $in: ['active', 'recovering'] },
        isDeleted: { $ne: true }
      });

      console.log(`Found ${activeBots.length} bots to check for recovery`);

      for (const bot of activeBots) {
        try {
          await this.recoverBot(bot);
        } catch (error) {
          console.error(`Error recovering bot ${bot._id}:`, error.message);
          // Continue with other bots
        }
      }

      console.log('Recovery process completed');
    } catch (error) {
      console.error('Recovery process failed:', error.message);
    } finally {
      this.isRecoveryInProgress = false;
    }
  }

  /**
   * Recover a single bot
   */
  async recoverBot(bot) {
    console.log(`Starting recovery for bot ${bot._id} (${bot.symbol})`);
    
    // Update bot status to recovering
    bot.status = 'recovering';
    await bot.save();

    try {
      // Initialize Binance service for this user with proper credentials
      const User = require('../models/User');
      const user = await User.findById(bot.userId).select('+binanceCredentials.apiKey +binanceCredentials.secretKey');
      
      if (!user || !user.hasBinanceCredentials()) {
        throw new Error('User does not have configured Binance credentials');
      }

      const credentials = user.decryptApiCredentials();
      if (!credentials) {
        throw new Error('Failed to decrypt user Binance credentials');
      }

      const userBinance = new BinanceService(credentials.apiKey, credentials.secretKey, bot.userId);
      
      // **CRITICAL: Ensure WebSocket connection is active for this user**
      const webSocketManager = require('./webSocketManager');
      try {
        await webSocketManager.createUserConnection(bot.userId, credentials.apiKey, credentials.secretKey);
        console.log(`🔌 WebSocket connection ensured for user ${bot.userId} during recovery`);
      } catch (wsError) {
        console.warn(`⚠️ WebSocket connection failed for user ${bot.userId}: ${wsError.message}`);
      }
      
      // Sync order status with Binance to get latest state
      await this.syncOrderStatus(bot, userBinance);
      
      // Check for filled buy orders that need sell orders
      const recoveryActions = await this.analyzeRecoveryNeeds(bot, userBinance);
      
      if (recoveryActions.needsRecovery) {
        const missingSellCount = recoveryActions.missingSellOrders.length;
        const missingBuyCount = recoveryActions.missingBuyOrders.length;
        
        console.log(`Bot ${bot._id} needs recovery: ${missingSellCount} missing sell orders, ${missingBuyCount} missing buy orders`);
        
        // Place missing sell orders
        if (missingSellCount > 0) {
          await this.placeMissingSellOrders(bot, userBinance, recoveryActions);
        }
        
        // Place missing buy orders
        if (missingBuyCount > 0) {
          await this.placeMissingBuyOrders(bot, userBinance, recoveryActions);
        }
        
        // Update bot statistics
        await this.updateBotStatistics(bot);
        
        console.log(`Recovery completed for bot ${bot._id}: placed ${missingSellCount} sell orders and ${missingBuyCount} buy orders`);
      } else {
        console.log(`Bot ${bot._id} is in sync, no recovery needed`);
      }

      // Resume bot operation
      bot.status = 'active';
      await bot.save();

      // **CRITICAL FIX: Ensure bot is added to active monitoring after recovery**
      const GridBotService = require('./gridBotService');
      const gridBotService = new GridBotService();
      
      // Add bot to active monitoring if not already there
      if (!gridBotService.activeBots.has(bot._id.toString())) {
        gridBotService.activeBots.set(bot._id.toString(), bot);
        
        // Start monitoring interval for this bot
        const monitorInterval = setInterval(() => {
          gridBotService.monitorGridOrders(bot._id.toString()).catch(error => {
            console.error(`Monitoring error for recovered bot ${bot._id}:`, error.message);
          });
        }, 30000); // Check every 30 seconds to avoid rate limits
        
        gridBotService.intervals.set(bot._id.toString(), monitorInterval);
        
        console.log(`🔄 Added recovered bot ${bot._id} to active monitoring`);
      }

    } catch (error) {
      console.error(`Failed to recover bot ${bot._id}:`, error.message);
      bot.status = 'error';
      bot.lastError = error.message;
      await bot.save();
      throw error;
    }
  }

  /**
   * Sync order status with Binance to ensure we have the latest state
   */
  async syncOrderStatus(bot, userBinance) {
    console.log(`Syncing order status for bot ${bot._id}`);
    
    const ordersToCheck = bot.orders.filter(order => 
      ['NEW', 'PARTIALLY_FILLED', 'PENDING'].includes(order.status)
    );

    for (const order of ordersToCheck) {
      try {
        const binanceOrder = await userBinance.getOrderStatus(bot.symbol, order.orderId);
        
        if (binanceOrder) {
          order.status = binanceOrder.status;
          order.executedQty = parseFloat(binanceOrder.executedQty);
          order.cummulativeQuoteQty = parseFloat(binanceOrder.cummulativeQuoteQty);
          order.updatedAt = new Date();
          
          // **CRITICAL: Capture actual executed price for accurate recovery calculations**
          if (binanceOrder.fills && binanceOrder.fills.length > 0) {
            // Calculate weighted average executed price from fills
            let totalQuantity = 0;
            let totalValue = 0;
            let totalCommission = 0;
            let commissionAsset = null;
            
            for (const fill of binanceOrder.fills) {
              const fillQty = parseFloat(fill.qty);
              const fillPrice = parseFloat(fill.price);
              totalQuantity += fillQty;
              totalValue += fillQty * fillPrice;
              totalCommission += parseFloat(fill.commission || 0);
              commissionAsset = fill.commissionAsset;
            }
            
            // Calculate weighted average executed price
            if (totalQuantity > 0) {
              order.executedPrice = totalValue / totalQuantity;
              console.log(`📊 Order ${order.orderId} executed at average price: ${order.executedPrice}`);
            }
            
            order.commission = totalCommission;
            order.commissionAsset = commissionAsset;
            
            console.log(`📊 Order ${order.orderId} commission: ${totalCommission} ${commissionAsset}`);
          } else if (binanceOrder.status === 'FILLED') {
            // Fallback: use order price if no fills data available
            order.executedPrice = parseFloat(binanceOrder.price);
            console.log(`📊 Order ${order.orderId} using order price as executed price: ${order.executedPrice}`);
          }
          
          // Mark as filled if completely filled
          if (binanceOrder.status === 'FILLED' && !order.isFilled) {
            order.isFilled = true;
            order.filledAt = new Date();
          }
        }
      } catch (error) {
        console.warn(`Could not sync order ${order.orderId}: ${error.message}`);
      }
    }

    await bot.save();
  }

  /**
   * Analyze what recovery actions are needed
   */
  async analyzeRecoveryNeeds(bot, userBinance) {
    console.log(`🔍 Analyzing recovery needs for bot ${bot._id}`);
    
    // Find all FILLED buy orders (ignore hasCorrespondingSell flag as it may be incorrect)
    const filledBuyOrders = bot.orders.filter(order => 
      order.side === 'BUY' && 
      order.status === 'FILLED' && 
      !order.isLiquidation
    );

    // Find all FILLED sell orders that might need corresponding buy orders
    const filledSellOrders = bot.orders.filter(order => 
      order.side === 'SELL' && 
      order.status === 'FILLED' && 
      !order.isLiquidation
    );

    console.log(`📊 Found ${filledBuyOrders.length} filled buy orders and ${filledSellOrders.length} filled sell orders to analyze`);

    const missingSellOrders = [];
    const missingBuyOrders = [];

    // Check for missing sell orders (existing logic)
    for (const buyOrder of filledBuyOrders) {
      console.log(`🔍 Checking buy order ${buyOrder.orderId} at grid level ${buyOrder.gridLevel}`);
      
      // **ENHANCED FIX: Check for existing sell orders with flexible quantity matching**
      const correspondingSell = bot.orders.find(order => {
        if (order.side !== 'SELL' || order.gridLevel !== buyOrder.gridLevel || order.isLiquidation) {
          return false;
        }
        
        // More flexible quantity matching that accounts for trading fees
        const expectedSellQty = buyOrder.executedQty || buyOrder.quantity;
        const actualSellQty = order.quantity;
        const qtyDifference = Math.abs(actualSellQty - expectedSellQty);
        
        // Allow for larger tolerance to account for trading fees (up to 0.2% + minimum threshold)
        const maxAllowedDifference = Math.max(0.001, expectedSellQty * 0.002);
        
        console.log(`   Comparing sell order ${order.orderId}: expected=${expectedSellQty}, actual=${actualSellQty}, diff=${qtyDifference}, maxAllowed=${maxAllowedDifference}`);
        
        return qtyDifference <= maxAllowedDifference;
      });
      
      // **ADDITIONAL CHECK: Look for existing recovery orders for this grid level**
      const hasRecoveryOrder = bot.orders.some(order => 
        order.side === 'SELL' &&
        order.gridLevel === buyOrder.gridLevel &&
        order.isRecoveryOrder === true &&
        order.status !== 'CANCELED' &&
        order.status !== 'REJECTED' &&
        order.status !== 'EXPIRED'
      );

      if (!correspondingSell && !hasRecoveryOrder) {
        console.log(`❌ No corresponding sell order found for buy order ${buyOrder.orderId} (grid level ${buyOrder.gridLevel})`);
        console.log(`   Buy order details: quantity=${buyOrder.quantity}, executedQty=${buyOrder.executedQty}, price=${buyOrder.price}`);
        
        missingSellOrders.push({
          buyOrder,
          expectedSellPrice: this.calculateSellPrice(bot, buyOrder)
        });
        
        // Reset the flag to reflect reality
        buyOrder.hasCorrespondingSell = false;
      } else if (correspondingSell) {
        console.log(`✅ Found corresponding sell order ${correspondingSell.orderId} for buy order ${buyOrder.orderId}`);
        console.log(`   Sell order details: quantity=${correspondingSell.quantity}, price=${correspondingSell.price}, status=${correspondingSell.status}`);
        
        // Mark as true since we found a sell order
        buyOrder.hasCorrespondingSell = true;
      } else if (hasRecoveryOrder) {
        console.log(`✅ Found existing recovery order for buy order ${buyOrder.orderId} (grid level ${buyOrder.gridLevel})`);
        
        // Mark as true since we found a recovery order
        buyOrder.hasCorrespondingSell = true;
      }
    }

    // **NEW: Check for missing buy orders for filled sell orders**
    for (const sellOrder of filledSellOrders) {
      console.log(`🔍 Checking sell order ${sellOrder.orderId} at grid level ${sellOrder.gridLevel}`);
      
      // Look for corresponding buy order at the same grid level
      const correspondingBuy = bot.orders.find(order => {
        if (order.side !== 'BUY' || order.gridLevel !== sellOrder.gridLevel || order.isLiquidation) {
          return false;
        }
        
        // For buy orders, we're less concerned about exact quantity matching
        // since the buy order should be placed to continue the grid strategy
        return true;
      });
      
      // Check for existing recovery buy orders for this grid level
      const hasRecoveryBuyOrder = bot.orders.some(order => 
        order.side === 'BUY' &&
        order.gridLevel === sellOrder.gridLevel &&
        order.isRecoveryOrder === true &&
        order.status !== 'CANCELED' &&
        order.status !== 'REJECTED' &&
        order.status !== 'EXPIRED'
      );

      if (!correspondingBuy && !hasRecoveryBuyOrder) {
        console.log(`❌ No corresponding buy order found for sell order ${sellOrder.orderId} (grid level ${sellOrder.gridLevel})`);
        console.log(`   Sell order details: quantity=${sellOrder.quantity}, executedQty=${sellOrder.executedQty}, price=${sellOrder.price}`);
        
        missingBuyOrders.push({
          sellOrder,
          expectedBuyPrice: this.calculateBuyPrice(bot, sellOrder)
        });
      } else if (correspondingBuy) {
        console.log(`✅ Found corresponding buy order ${correspondingBuy.orderId} for sell order ${sellOrder.orderId}`);
      } else if (hasRecoveryBuyOrder) {
        console.log(`✅ Found existing recovery buy order for sell order ${sellOrder.orderId} (grid level ${sellOrder.gridLevel})`);
      }
    }

    const result = {
      needsRecovery: missingSellOrders.length > 0 || missingBuyOrders.length > 0,
      missingSellOrders,
      missingBuyOrders,
      filledBuyOrders: filledBuyOrders.length,
      filledSellOrders: filledSellOrders.length
    };

    console.log(`📋 Recovery analysis result:`, {
      needsRecovery: result.needsRecovery,
      missingSellOrdersCount: missingSellOrders.length,
      missingBuyOrdersCount: missingBuyOrders.length,
      filledBuyOrdersCount: filledBuyOrders.length,
      filledSellOrdersCount: filledSellOrders.length
    });

    return result;
  }

  /**
   * Calculate expected sell price based on actual buy price + profit margin
   */
  calculateSellPrice(bot, buyOrder) {
    const config = bot.config;
    const profitMargin = config.profitPerGrid / 100;
    
    // **CRITICAL FIX: Use actual buy price, not grid level calculation**
    // Get the actual executed price from the buy order
    const actualBuyPrice = buyOrder.executedPrice || buyOrder.price;
    
    // Calculate sell price with profit margin
    const sellPrice = actualBuyPrice * (1 + profitMargin);
    
    console.log(`💰 Recovery sell price calculation:`);
    console.log(`   Buy Price: ${actualBuyPrice}`);
    console.log(`   Profit Margin: ${profitMargin * 100}%`);
    console.log(`   Sell Price: ${sellPrice}`);
    
    // Ensure sell price is within grid range (safety check)
    if (sellPrice > config.upperPrice) {
      console.warn(`⚠️ Calculated sell price ${sellPrice} exceeds upper grid limit ${config.upperPrice}, using upper limit`);
      return config.upperPrice;
    }
    
    if (sellPrice < config.lowerPrice) {
      console.warn(`⚠️ Calculated sell price ${sellPrice} below lower grid limit ${config.lowerPrice}, using lower limit + margin`);
      return config.lowerPrice * (1 + profitMargin);
    }
    
    return sellPrice;
  }

  /**
   * Calculate expected buy price based on actual sell price - profit margin
   */
  calculateBuyPrice(bot, sellOrder) {
    // Use actual executed price if available, otherwise use order price
    const actualSellPrice = sellOrder.executedPrice || sellOrder.price;
    const profitMargin = bot.config.profitPerGrid / 100;
    
    const buyPrice = actualSellPrice * (1 - profitMargin);
    
    console.log(`💰 Calculated buy price for sell order ${sellOrder.orderId}:`, {
      actualSellPrice,
      profitMargin: `${bot.config.profitPerGrid}%`,
      buyPrice
    });
    
    return buyPrice;
  }

  /**
   * Place missing buy orders
   */
  async placeMissingBuyOrders(bot, userBinance, recoveryActions) {
    console.log(`Placing ${recoveryActions.missingBuyOrders.length} missing buy orders`);

    const placedOrders = [];

    for (const { sellOrder, expectedBuyPrice } of recoveryActions.missingBuyOrders) {
      try {
        // Get symbol filters for proper rounding and validations
        const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);

        // Calculate buy quantity based on grid configuration
        const investmentPerGrid = bot.config.investmentAmount / bot.config.gridLevels;
        const buyQty = investmentPerGrid / expectedBuyPrice;

        // Round DOWN to step size (LOT_SIZE) and to quantity precision
        let roundedQty = buyQty;
        if (symbolInfo.stepSize > 0) {
          roundedQty = Math.floor(roundedQty / symbolInfo.stepSize) * symbolInfo.stepSize;
        }
        if (symbolInfo.quantityPrecision >= 0) {
          const p = Math.pow(10, symbolInfo.quantityPrecision);
          roundedQty = Math.floor(roundedQty * p) / p;
        }

        // Round price to valid tick size and precision
        let roundedPrice = expectedBuyPrice;
        if (symbolInfo.tickSize > 0) {
          roundedPrice = Math.round(roundedPrice / symbolInfo.tickSize) * symbolInfo.tickSize;
        }
        if (symbolInfo.pricePrecision >= 0) {
          const pp = Math.pow(10, symbolInfo.pricePrecision);
          roundedPrice = Math.round(roundedPrice * pp) / pp;
        }

        // Validate against minimum quantity and notional requirements
        if (roundedQty < symbolInfo.minQty) {
          console.warn(`Skipping recovery buy: quantity below minQty. Computed: ${roundedQty}, minQty: ${symbolInfo.minQty}`);
          continue;
        }

        const notional = roundedQty * roundedPrice;
        if (notional < symbolInfo.minNotional) {
          console.warn(`Skipping recovery buy: notional below minNotional. Computed: ${notional}, minNotional: ${symbolInfo.minNotional}`);
          continue;
        }

        if (roundedQty <= 0) {
          console.warn(`Skipping recovery buy: non-positive quantity after rounding.`);
          continue;
        }

        // Place the buy order
        console.log(`🔄 Attempting to place recovery buy order:`, {
          symbol: bot.symbol,
          side: 'BUY',
          quantity: roundedQty,
          price: roundedPrice,
          gridLevel: sellOrder.gridLevel,
          userId: bot.userId
        });
        
        const buyOrder = await userBinance.placeLimitOrder(
          bot.symbol,
          'BUY',
          roundedQty,
          roundedPrice
        );

        console.log(`📈 Binance API response for buy order:`, buyOrder);

        if (buyOrder && buyOrder.orderId) {
          const newBuyOrder = {
            orderId: buyOrder.orderId.toString(),
            clientOrderId: buyOrder.clientOrderId,
            side: 'BUY',
            type: 'LIMIT',
            quantity: roundedQty,
            price: roundedPrice,
            gridLevel: sellOrder.gridLevel,
            status: 'NEW',
            timestamp: new Date(),
            isRecoveryOrder: true
          };

          bot.orders.push(newBuyOrder);
          placedOrders.push(newBuyOrder);

          // Persist immediately
          try {
            await bot.save();
            console.log(`💾 Bot updated in DB with recovery buy order ${newBuyOrder.orderId}`);
          } catch (immediateSaveErr) {
            console.warn(`⚠️ Immediate save after placing recovery buy order failed: ${immediateSaveErr.message}`);
          }

          console.log(`✅ Recovery buy order placed successfully:`, {
            orderId: buyOrder.orderId,
            clientOrderId: buyOrder.clientOrderId,
            price: roundedPrice,
            quantity: roundedQty,
            gridLevel: sellOrder.gridLevel
          });

          // Verify order was actually placed on Binance
          try {
            console.log(`🔍 Verifying buy order placement on Binance...`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
            
            const verifyOrder = await userBinance.getOrderStatus(bot.symbol, buyOrder.orderId);
            console.log(`🔍 Binance buy order verification:`, verifyOrder);
            
            if (!verifyOrder || verifyOrder.status === 'REJECTED' || verifyOrder.status === 'EXPIRED') {
              console.error(`❌ Buy order verification failed - Order not found or rejected on Binance:`, verifyOrder);
              // Remove the order from local database if it wasn't actually placed
              const orderIndex = bot.orders.findIndex(o => o.orderId === buyOrder.orderId);
              if (orderIndex !== -1) {
                bot.orders.splice(orderIndex, 1);
                const placedIndex = placedOrders.findIndex(o => o.orderId === buyOrder.orderId);
                if (placedIndex !== -1) {
                  placedOrders.splice(placedIndex, 1);
                }
              }
            }
          } catch (verifyError) {
            console.warn(`⚠️ Could not verify buy order placement:`, verifyError.message);
          }
        } else {
          console.error(`❌ Invalid response from Binance placeLimitOrder:`, buyOrder);
          throw new Error(`Invalid response from Binance: ${JSON.stringify(buyOrder)}`);
        }
      } catch (error) {
        console.error(`❌ Failed to place recovery buy order for sell order ${sellOrder.orderId}:`, error.message);
      }
    }

    // Save updates
    try {
      await bot.save();
    } catch (saveError) {
      console.error(`❌ Failed to save bot after placing recovery buy orders:`, saveError.message);
    }

    return placedOrders;
  }

  /**
   * Place missing sell orders
   */
  async placeMissingSellOrders(bot, userBinance, recoveryActions) {
    console.log(`Placing ${recoveryActions.missingSellOrders.length} missing sell orders`);

    const placedOrders = [];

    for (const { buyOrder, expectedSellPrice } of recoveryActions.missingSellOrders) {
      try {
        // Get symbol filters for proper rounding and validations
        const symbolInfo = await userBinance.getSymbolInfo(bot.symbol);

        // **FIX: Account for trading fees deducted from purchased asset**
        // When BNB is insufficient, Binance deducts fees from the bought asset
        // Standard Binance trading fee is 0.1% (0.001)
        const BINANCE_TRADING_FEE = 0.001; // 0.1%
        
        // Use the original filled quantity from the BUY for recovery
        // Prefer executedQty (actual fill), fallback to requested quantity
        let rawSellQty = (typeof buyOrder.executedQty === 'number' && buyOrder.executedQty > 0)
          ? buyOrder.executedQty
          : buyOrder.quantity;

        console.log(`Raw buy order quantity: ${rawSellQty} (executedQty=${buyOrder.executedQty}, requested=${buyOrder.quantity})`);

        // **CRITICAL FIX: Deduct trading fee from the quantity**
        // If fee was paid in the purchased asset (no BNB), we received less than ordered
        let sellQty = rawSellQty;
        
        // Check if we have commission data from the order
        if (buyOrder.commission && buyOrder.commission > 0) {
          // Use actual commission if available
          sellQty = rawSellQty - buyOrder.commission;
          console.log(`📊 Using actual commission data: ${buyOrder.commission}, Net quantity: ${sellQty}`);
        } else {
          // Estimate fee deduction (assume fee was paid in purchased asset)
          const estimatedFee = rawSellQty * BINANCE_TRADING_FEE;
          sellQty = rawSellQty - estimatedFee;
          console.log(`📊 Estimated trading fee: ${estimatedFee} (${BINANCE_TRADING_FEE * 100}%), Net quantity: ${sellQty}`);
        }

        console.log(`🔧 Fee-adjusted sell quantity: ${sellQty} (original: ${rawSellQty})`);

        // Round DOWN to step size (LOT_SIZE) and to quantity precision to avoid invalid quantities
        if (symbolInfo.stepSize > 0) {
          sellQty = Math.floor(sellQty / symbolInfo.stepSize) * symbolInfo.stepSize;
        }
        if (symbolInfo.quantityPrecision >= 0) {
          const p = Math.pow(10, symbolInfo.quantityPrecision);
          sellQty = Math.floor(sellQty * p) / p;
        }

        // Validate against minimum quantity and notional requirements
        if (sellQty < symbolInfo.minQty) {
          console.warn(`Skipping recovery sell: quantity below minQty. Computed: ${sellQty}, minQty: ${symbolInfo.minQty}`);
          continue;
        }

        // Round price to valid tick size and precision
        let roundedPrice = expectedSellPrice;
        if (symbolInfo.tickSize > 0) {
          roundedPrice = Math.round(roundedPrice / symbolInfo.tickSize) * symbolInfo.tickSize;
        }
        if (symbolInfo.pricePrecision >= 0) {
          const pp = Math.pow(10, symbolInfo.pricePrecision);
          roundedPrice = Math.round(roundedPrice * pp) / pp;
        }

        const notional = sellQty * roundedPrice;
        if (notional < symbolInfo.minNotional) {
          console.warn(`Skipping recovery sell: notional below minNotional. Computed: ${notional}, minNotional: ${symbolInfo.minNotional}`);
          continue;
        }

        if (sellQty <= 0) {
          console.warn(`Skipping recovery sell: non-positive quantity after rounding. From buy quantity=${buyOrder.quantity}, executedQty=${buyOrder.executedQty}`);
          continue;
        }

        // Place the sell order using the computed quantity
        console.log(`🔄 Attempting to place recovery sell order:`, {
          symbol: bot.symbol,
          side: 'SELL',
          quantity: sellQty,
          price: roundedPrice,
          gridLevel: buyOrder.gridLevel,
          userId: bot.userId
        });
        
        const sellOrder = await userBinance.placeLimitOrder(
          bot.symbol,
          'SELL',
          sellQty,
          roundedPrice
        );

        console.log(`📈 Binance API response for sell order:`, sellOrder);

        if (sellOrder && sellOrder.orderId) {
          const newSellOrder = {
            orderId: sellOrder.orderId.toString(),
            clientOrderId: sellOrder.clientOrderId,
            side: 'SELL',
            type: 'LIMIT',
            quantity: sellQty,
            price: roundedPrice,
            gridLevel: buyOrder.gridLevel,
            status: 'NEW',
            timestamp: new Date(),
            isRecoveryOrder: true
          };

          bot.orders.push(newSellOrder);
          buyOrder.hasCorrespondingSell = true;
          placedOrders.push(newSellOrder);

          // Persist immediately so WS handler can find this order by ID
          try {
            await bot.save();
            console.log(`💾 Bot updated in DB with recovery order ${newSellOrder.orderId}`);
          } catch (immediateSaveErr) {
            console.warn(`⚠️ Immediate save after placing recovery order failed: ${immediateSaveErr.message}`);
          }

          console.log(`✅ Recovery sell order placed successfully:`, {
            orderId: sellOrder.orderId,
            clientOrderId: sellOrder.clientOrderId,
            price: roundedPrice,
            quantity: sellQty,
            gridLevel: buyOrder.gridLevel
          });

          // **FIX: Verify order was actually placed on Binance**
          try {
            console.log(`🔍 Verifying order placement on Binance...`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
            
            const verifyOrder = await userBinance.getOrderStatus(bot.symbol, sellOrder.orderId);
            console.log(`🔍 Binance order verification:`, verifyOrder);
            
            if (!verifyOrder || verifyOrder.status === 'REJECTED' || verifyOrder.status === 'EXPIRED') {
              console.error(`❌ Order verification failed - Order not found or rejected on Binance:`, verifyOrder);
              // Remove the order from local database if it wasn't actually placed
              const orderIndex = bot.orders.findIndex(o => o.orderId === sellOrder.orderId);
              if (orderIndex !== -1) {
                bot.orders.splice(orderIndex, 1);
                buyOrder.hasCorrespondingSell = false;
                const placedIndex = placedOrders.findIndex(o => o.orderId === sellOrder.orderId);
                if (placedIndex !== -1) {
                  placedOrders.splice(placedIndex, 1);
                }
              }
            }
          } catch (verifyError) {
            console.warn(`⚠️ Could not verify order placement:`, verifyError.message);
          }
        } else {
          console.error(`❌ Invalid response from Binance placeLimitOrder:`, sellOrder);
          throw new Error(`Invalid response from Binance: ${JSON.stringify(sellOrder)}`);
        }
      } catch (error) {
        console.error(`❌ Failed to place recovery sell order for buy order ${buyOrder.orderId}:`, error.message);
      }
    }

    // Save updates
    try {
      await bot.save();
    } catch (saveError) {
      console.error(`❌ Failed to save bot after placing recovery orders:`, saveError.message);
    }

    return placedOrders;
  }

  /**
   * Update bot statistics after recovery
   */
  async updateBotStatistics(bot) {
    const filledOrders = bot.orders.filter(order => order.status === 'FILLED');
    const buyOrders = filledOrders.filter(order => order.side === 'BUY' && !order.isLiquidation);
    const sellOrders = filledOrders.filter(order => order.side === 'SELL' && !order.isLiquidation);

    bot.statistics = bot.statistics || {};
    bot.statistics.totalBuyOrders = buyOrders.length;
    bot.statistics.totalSellOrders = sellOrders.length;
    bot.statistics.lastRecoveryAt = new Date();

    await bot.save();
  }

  /**
   * Get recovery status for a specific bot
   */
  async getRecoveryStatus(botId) {
    try {
      const bot = await GridBot.findById(botId);
      if (!bot) {
        return { error: 'Bot not found' };
      }

      const filledBuyOrders = bot.orders.filter(order => 
        order.side === 'BUY' && 
        order.status === 'FILLED' && 
        !order.isLiquidation &&
        !order.hasCorrespondingSell
      );

      return {
        botId: bot._id,
        status: bot.status,
        totalOrders: bot.orders.length,
        filledBuyOrders: filledBuyOrders.length,
        lastRecoveryAt: bot.recoveryHistory?.[bot.recoveryHistory.length - 1]?.timestamp,
        recoveryHistory: bot.recoveryHistory || []
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}

// Export singleton instance
module.exports = new RecoveryService();