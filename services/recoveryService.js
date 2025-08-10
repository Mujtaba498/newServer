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
      
      // Sync order status with Binance to get latest state
      await this.syncOrderStatus(bot, userBinance);
      
      // Check for filled buy orders that need sell orders
      const recoveryActions = await this.analyzeRecoveryNeeds(bot, userBinance);
      
      if (recoveryActions.needsRecovery) {
        console.log(`Bot ${bot._id} needs recovery: ${recoveryActions.missingSellOrders.length} missing sell orders`);
        
        // Place missing sell orders
        await this.placeMissingSellOrders(bot, userBinance, recoveryActions);
        
        // Update bot statistics
        await this.updateBotStatistics(bot);
        
        console.log(`Recovery completed for bot ${bot._id}`);
      } else {
        console.log(`Bot ${bot._id} is in sync, no recovery needed`);
      }

      // Resume bot operation
      bot.status = 'active';
      await bot.save();

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

    console.log(`📊 Found ${filledBuyOrders.length} filled buy orders to analyze`);

    const missingSellOrders = [];

    for (const buyOrder of filledBuyOrders) {
      console.log(`🔍 Checking buy order ${buyOrder.orderId} at grid level ${buyOrder.gridLevel}`);
      
      // **FIX: Actually look for sell orders in the database, don't trust the flag**
      const correspondingSell = bot.orders.find(order => 
        order.side === 'SELL' &&
        order.gridLevel === buyOrder.gridLevel &&
        Math.abs(order.quantity - buyOrder.executedQty) < 0.0001 && // Use executedQty for comparison
        !order.isLiquidation
      );

      if (!correspondingSell) {
        console.log(`❌ No corresponding sell order found for buy order ${buyOrder.orderId} (grid level ${buyOrder.gridLevel})`);
        console.log(`   Buy order details: quantity=${buyOrder.quantity}, executedQty=${buyOrder.executedQty}, price=${buyOrder.price}`);
        
        missingSellOrders.push({
          buyOrder,
          expectedSellPrice: this.calculateSellPrice(bot, buyOrder.gridLevel)
        });
        
        // Reset the flag to reflect reality
        buyOrder.hasCorrespondingSell = false;
      } else {
        console.log(`✅ Found corresponding sell order ${correspondingSell.orderId} for buy order ${buyOrder.orderId}`);
        console.log(`   Sell order details: quantity=${correspondingSell.quantity}, price=${correspondingSell.price}, status=${correspondingSell.status}`);
        
        // Only mark as true if we actually found a sell order
        buyOrder.hasCorrespondingSell = true;
      }
    }

    const result = {
      needsRecovery: missingSellOrders.length > 0,
      missingSellOrders,
      filledBuyOrders: filledBuyOrders.length
    };

    console.log(`📋 Recovery analysis result:`, {
      needsRecovery: result.needsRecovery,
      missingSellOrdersCount: missingSellOrders.length,
      filledBuyOrdersCount: filledBuyOrders.length
    });

    return result;
  }

  /**
   * Calculate expected sell price for a grid level
   */
  calculateSellPrice(bot, gridLevel) {
    const config = bot.config;
    const priceRange = config.upperPrice - config.lowerPrice;
    const stepSize = priceRange / config.gridLevels;
    
    return config.lowerPrice + (gridLevel * stepSize) * (1 + config.profitPerGrid / 100);
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

        // Use the original filled quantity from the BUY for recovery, as requested
        // Prefer executedQty (actual fill), fallback to requested quantity
        let sellQty = (typeof buyOrder.executedQty === 'number' && buyOrder.executedQty > 0)
          ? buyOrder.executedQty
          : buyOrder.quantity;

        console.log(`Using buy order quantity for recovery sell. Raw: ${sellQty} (executedQty=${buyOrder.executedQty}, requested=${buyOrder.quantity})`);

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