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
    const filledBuyOrders = bot.orders.filter(order => 
      order.side === 'BUY' && 
      order.status === 'FILLED' && 
      !order.isLiquidation &&
      !order.hasCorrespondingSell
    );

    const missingSellOrders = [];

    for (const buyOrder of filledBuyOrders) {
      // Check if there's a corresponding sell order for this buy
      const correspondingSell = bot.orders.find(order => 
        order.side === 'SELL' &&
        order.gridLevel === buyOrder.gridLevel &&
        order.quantity === buyOrder.quantity &&
        !order.isLiquidation
      );

      if (!correspondingSell) {
        missingSellOrders.push({
          buyOrder,
          expectedSellPrice: this.calculateSellPrice(bot, buyOrder.gridLevel)
        });
      } else {
        // Mark the buy order as having corresponding sell
        buyOrder.hasCorrespondingSell = true;
      }
    }

    return {
      needsRecovery: missingSellOrders.length > 0,
      missingSellOrders,
      filledBuyOrders: filledBuyOrders.length
    };
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
        // Check if we have the base asset available
        const accountInfo = await userBinance.getAccountInfo();
        const baseAsset = bot.symbol.replace('USDT', '');
        const availableBalance = parseFloat(accountInfo.balances.find(b => b.asset === baseAsset)?.free || 0);

        if (availableBalance < buyOrder.quantity) {
          console.warn(`Insufficient ${baseAsset} balance for sell order. Required: ${buyOrder.quantity}, Available: ${availableBalance}`);
          continue;
        }

        // Place the sell order
        const sellOrder = await userBinance.placeOrder({
          symbol: bot.symbol,
          side: 'SELL',
          type: 'LIMIT',
          quantity: buyOrder.quantity,
          price: expectedSellPrice,
          timeInForce: 'GTC'
        });

        if (sellOrder && sellOrder.orderId) {
          const newSellOrder = {
            orderId: sellOrder.orderId,
            clientOrderId: sellOrder.clientOrderId,
            side: 'SELL',
            type: 'LIMIT',
            quantity: buyOrder.quantity,
            price: expectedSellPrice,
            gridLevel: buyOrder.gridLevel,
            status: 'NEW',
            timestamp: new Date(),
            isRecoveryOrder: true
          };

          bot.orders.push(newSellOrder);
          buyOrder.hasCorrespondingSell = true;
          placedOrders.push(newSellOrder);

          console.log(`Placed recovery sell order: ${sellOrder.orderId} at price ${expectedSellPrice}`);
        }
      } catch (error) {
        console.error(`Failed to place sell order for grid level ${buyOrder.gridLevel}:`, error.message);
      }
    }

    if (placedOrders.length > 0) {
      bot.recoveryHistory = bot.recoveryHistory || [];
      bot.recoveryHistory.push({
        timestamp: new Date(),
        type: 'sell_order_recovery',
        ordersPlaced: placedOrders.length,
        orderIds: placedOrders.map(o => o.orderId)
      });

      await bot.save();
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