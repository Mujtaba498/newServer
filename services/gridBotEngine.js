import cron from 'node-cron';
import AIGridBot from '../models/AIGridBot.js';
import GridOrder from '../models/GridOrder.js';
import BotPerformance from '../models/BotPerformance.js';
import binanceService from './binanceService.js';
import aiGridService from './aiGridService.js';

class GridBotEngine {
  constructor() {
    this.activeBots = new Map();
    this.priceStreams = new Map();
    this.userDataStreams = new Map();
    this.isRunning = false;
    this.monitoringInterval = null;
    this.performanceUpdateInterval = null;
  }

  // Start the grid bot engine
  async start() {
    if (this.isRunning) {
      return;
    }

    try {
      // Load existing active bots
      await this.loadActiveBots();
      
      // Start monitoring intervals
      this.startMonitoring();
      
      // Start performance updates
      this.startPerformanceUpdates();
      
      this.isRunning = true;
      
    } catch (error) {
      throw error;
    }
  }

  // Stop the grid bot engine
  async stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      // Stop all monitoring
      this.stopMonitoring();
      
      // Stop all price streams
      this.stopAllPriceStreams();
      
      // Clear active bots
      this.activeBots.clear();
      
      this.isRunning = false;
      
    } catch (error) {
      // Error stopping Grid Bot Engine
    }
  }

  // Check user balance with user-specific client
  async checkUserBalance(client, symbol, investmentAmount) {
    try {
      const account = await client.accountInfo();
      
      // Check if user has sufficient USDT balance
      const usdtBalance = account.balances.find(b => b.asset === 'USDT');
      const availableUSDT = usdtBalance ? parseFloat(usdtBalance.free) : 0;
      
      // Check base asset balance (e.g., AAVE from AAVEUSDT)
      const baseAsset = symbol.replace('USDT', '');
      const baseBalance = account.balances.find(b => b.asset === baseAsset);
      const availableBase = baseBalance ? parseFloat(baseBalance.free) : 0;
      
      if (availableUSDT < investmentAmount) {
        return {
          success: false,
          error: `Insufficient USDT balance. Available: ${availableUSDT} USDT, Required: ${investmentAmount} USDT`
        };
      }
      
      
      return {
        success: true,
        availableUSDT,
        availableBase,
        baseAsset
      };
      
    } catch (error) {
      return {
        success: false,
        error: `Failed to check account balance: ${error.message}`
      };
    }
  }

  // Create and start a new grid bot
  async createBot(userId, symbol, investmentAmount, isTestMode = true) {
    try {
      
      // Check if user has their own keys
      const hasOwnKeys = await binanceService.hasUserKeys(userId, isTestMode);
      
      if (!hasOwnKeys) {
        // For live mode, we might want to require user keys
        if (!isTestMode) {
          return {
            success: false,
            error: 'Live trading requires your own Binance API keys. Please add them in Settings.'
          };
        }
      }

      // Get user-specific client
      const userClient = await binanceService.getUserClient(userId, isTestMode);
      
      // Check account balance with user's client
      const balanceResult = await this.checkUserBalance(userClient, symbol, investmentAmount);
      if (!balanceResult.success) {
        return {
          success: false,
          error: balanceResult.error
        };
      }
      
      // Balance check was already done in checkUserBalance method

      // Generate AI parameters
      const aiParams = await aiGridService.generateAIParameters(symbol, investmentAmount, isTestMode);
      if (!aiParams.success) {
        return {
          success: false,
          error: `AI parameter generation failed: ${aiParams.error}`
        };
      }

      // Create bot in database
      const botData = {
        user_id: userId,
        symbol: symbol.toUpperCase(),
        investment_amount: investmentAmount,
        status: 'initializing',
        test_mode: isTestMode, // Store test mode setting
        grid_params: aiParams.parameters.grid_params,
        risk_params: {
          stop_loss_price: aiParams.parameters.grid_params.stop_loss_price,
          take_profit_percentage: 20,
          max_drawdown_percentage: 25
        }
      };

      const bot = new AIGridBot(botData);
      await bot.save();

      // Create performance record
      await BotPerformance.createOrUpdate(bot._id, symbol.toUpperCase(), {
        total_profit: 0,
        total_trades: 0,
        win_rate: 0,
        pnl_percentage: 0
      });

      // Initialize grid orders with user client
      await this.initializeGridOrders(bot, aiParams.parameters, userId, isTestMode);

      // Start bot monitoring
      await this.startBotMonitoring(bot);

      // Update bot status to active
      bot.status = 'active';
      await bot.save();

      // Add to active bots with user client info
      this.activeBots.set(bot._id.toString(), {
        bot,
        client: userClient,
        userId,
        isTestMode,
        hasOwnKeys
      });

      
      return {
        success: true,
        bot: bot,
        parameters: aiParams.parameters,
        using_own_keys: hasOwnKeys
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Stop a specific bot
  async stopBot(botId, userId) {
    try {
      // Find bot in database
      const bot = await AIGridBot.findOne({ _id: botId, user_id: userId });
      if (!bot) {
        throw new Error('Bot not found');
      }

      // Cancel all open orders
      await this.cancelAllBotOrders(bot);

      // Stop price stream
      this.stopPriceStream(bot.symbol, bot.user_id);

      // Stop user data stream if no other bots for this user
      const userHasOtherBots = Array.from(this.activeBots.values()).some(
        ({ bot: otherBot }) => otherBot.user_id.toString() === bot.user_id.toString() && otherBot._id.toString() !== botId.toString()
      );
      
      if (!userHasOtherBots) {
        this.stopUserDataStream(bot.user_id);
      }

      // Remove from active bots
      this.activeBots.delete(botId.toString());

      // Update bot status
      await bot.stopBot();

      
      return {
        success: true,
        message: 'Bot stopped successfully'
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Initialize grid orders for a bot
  async initializeGridOrders(bot, aiParameters, userId, isTestMode) {
    try {
      const { grid_params } = aiParameters;
      const orders = [];

      // Calculate all grid levels across the entire range
      const gridLevels = this.calculateGridLevels(grid_params);


      // For proper grid trading, we need to:
      // 1. Place BUY orders below current price
      // 2. Place SELL orders above current price (for now, skip these until we have base asset)
      // 3. Use the entire grid range
      
      // First, let's place only BUY orders to use the full investment amount
      const buyLevels = gridLevels.filter(level => level.price < grid_params.current_price);
      
      // Filter out levels too close to current price, but always keep the closest one
      // This ensures immediate trading opportunity
      if (buyLevels.length === 0) {
        throw new Error('No buy levels found below current price');
      }
      
      // Sort buy levels by distance from current price (closest first)
      const sortedBuyLevels = buyLevels.sort((a, b) => 
        Math.abs(b.price - grid_params.current_price) - Math.abs(a.price - grid_params.current_price)
      );
      
      // Always include the closest buy level for immediate trading
      const closestLevel = sortedBuyLevels[0];
      const filteredBuyLevels = [closestLevel];
      
      // Add other levels that pass the normal filter
      for (let i = 1; i < sortedBuyLevels.length; i++) {
        const level = sortedBuyLevels[i];
        if (Math.abs(level.price - grid_params.current_price) >= grid_params.grid_spacing * 0.5) {
          filteredBuyLevels.push(level);
        }
      }
      
      // Sort back to original order (lowest price first)
      filteredBuyLevels.sort((a, b) => a.price - b.price);
      
      // Check if we have any orders to place
      if (filteredBuyLevels.length === 0) {
        throw new Error('No valid buy levels found after filtering. Grid may be too narrow or current price too close to boundaries.');
      }
      
      // Recalculate order size based on actual orders to be placed
      // Using 95% instead of 90% for higher capital efficiency
      const usableAmount = bot.investment_amount * 0.95;
      const actualOrderSize = usableAmount / filteredBuyLevels.length;
      const orderSizeInBase = actualOrderSize / grid_params.current_price;
      
      console.log(`Debug: Placing ${filteredBuyLevels.length} BUY orders, ${orderSizeInBase} XRP each, ${actualOrderSize} USDT each`);
      
      for (let i = 0; i < filteredBuyLevels.length; i++) {
        const level = filteredBuyLevels[i];
        
        // Only place BUY orders for now
        const side = 'BUY';

        try {
          // For proper grid trading, we need both BUY and SELL orders
          // BUY orders: use USDT to buy the base asset when price drops
          // SELL orders: we'll place them anyway - user should have some base asset or we'll buy at market
          
          // Note: For now, we'll place both BUY and SELL orders
          // In a complete implementation, we'd first buy 50% of base asset at market price for SELL orders

          // Generate client order ID
          const shortId = bot._id.toString().slice(-8);
          const timestamp = Date.now().toString().slice(-6);
          const clientOrderId = `g_${shortId}_${i}_${timestamp}`;
          
          // Get symbol info for price formatting
          const symbolInfo = await binanceService.getSymbolInfo(bot.symbol);
          
          // Format price and quantity according to symbol precision
          const formattedPrice = symbolInfo.success ? 
            binanceService.formatPrice(level.price, symbolInfo.tickSize) : 
            parseFloat(level.price.toFixed(2));
          
          const formattedQuantity = symbolInfo.success ? 
            binanceService.formatQuantity(orderSizeInBase, symbolInfo.stepSize) : 
            parseFloat(orderSizeInBase.toFixed(6));
          
          // Place order on Binance
          const orderResult = await binanceService.placeLimitOrder(
            userId,
            bot.symbol,
            side,
            formattedQuantity,
            formattedPrice,
            isTestMode,
            { newClientOrderId: clientOrderId }
          );

          if (orderResult.success) {
            // Save order to database
            const gridOrder = new GridOrder({
              bot_id: bot._id,
              binance_order_id: orderResult.order.orderId,
              client_order_id: orderResult.order.clientOrderId,
              symbol: bot.symbol,
              price: level.price,
              quantity: orderSizeInBase,
              side: side,
              status: 'NEW',
              grid_level: i,
              created_at: new Date()
            });

            await gridOrder.save();
            orders.push(gridOrder);
          }
        } catch (orderError) {
          // Log the error but continue with other orders
          console.error(`Failed to place order for level ${level.level}:`, orderError.message);
          // Re-throw if it's a critical error that prevents all orders
          if (orderError.message.includes('insufficient') || orderError.message.includes('balance')) {
            throw orderError;
          }
        }
      }

      return orders;

    } catch (error) {
      throw error;
    }
  }

  // Calculate grid levels based on parameters
  calculateGridLevels(gridParams) {
    const levels = [];
    const { upper_price, lower_price, grid_count, grid_spacing } = gridParams;

    for (let i = 0; i < grid_count; i++) {
      const price = lower_price + (i * grid_spacing);
      if (price <= upper_price) {
        levels.push({
          level: i,
          price: price
        });
      }
    }

    return levels;
  }

  // Start monitoring for a specific bot
  async startBotMonitoring(bot) {
    try {
      // Set binance service test mode for this bot
      binanceService.setTestMode(bot.test_mode);
      
      // Add to active bots
      this.activeBots.set(bot._id.toString(), { bot: bot });

      // Start price stream for this symbol with user-specific connection
      this.startPriceStream(bot.symbol, bot.user_id, bot.test_mode);

      // Start user data stream for real-time order and balance updates
      this.startUserDataStream(bot.user_id, bot.test_mode);

    } catch (error) {
      // Error starting bot monitoring
    }
  }

  // Start price stream for a symbol with user-specific connection
  async startPriceStream(symbol, userId, isTestMode = true) {
    // Create user-specific stream key
    const streamKey = `${symbol}_${userId}`;
    
    // Check if stream already exists
    if (this.priceStreams.has(streamKey)) {
      return;
    }

    const streamResult = await binanceService.startPriceStream(symbol, (priceData) => {
      this.handlePriceUpdate(symbol, priceData);
    }, userId, isTestMode);

    if (streamResult.success) {
      this.priceStreams.set(streamKey, streamResult.cleanup);
    }
  }

  // Stop price stream for a symbol
  stopPriceStream(symbol, userId) {
    const streamKey = `${symbol}_${userId}`;
    if (this.priceStreams.has(streamKey)) {
      const cleanup = this.priceStreams.get(streamKey);
      cleanup();
      this.priceStreams.delete(streamKey);
      
      // Also stop the WebSocket connection in binanceService
      binanceService.stopPriceStream(symbol, userId);
    }
  }

  // Start user data stream for real-time order and balance updates
  async startUserDataStream(userId, isTestMode = true) {
    try {
      // Check if stream already exists
      if (this.userDataStreams.has(userId)) {
        console.log(`[UserDataStream] Already active for user: ${userId}, testMode: ${isTestMode}`);
        return;
      }

      const streamResult = await binanceService.startUserDataStream(userId, (userData) => {
        this.handleUserDataUpdate(userId, userData);
      }, isTestMode);

      if (streamResult.success) {
        this.userDataStreams.set(userId, streamResult.cleanup);
        console.log(`[UserDataStream] Started for user: ${userId}, testMode: ${isTestMode}`);
        console.log('[UserDataStream] Active streams:', Array.from(this.userDataStreams.keys()));
      } else {
        console.error(`[UserDataStream] Failed to start for user: ${userId}, testMode: ${isTestMode}`);
      }
    } catch (error) {
      console.error(`[UserDataStream] Error starting for user: ${userId}, testMode: ${isTestMode}:`, error.message);
    }
  }

  // Stop user data stream
  stopUserDataStream(userId) {
    if (this.userDataStreams.has(userId)) {
      const cleanup = this.userDataStreams.get(userId);
      cleanup();
      this.userDataStreams.delete(userId);
      
      // Also stop the WebSocket connection in binanceService
      binanceService.stopUserDataStream(userId);
    }
  }

  // Handle user data updates (orders, balance, etc.)
  async handleUserDataUpdate(userId, userData) {
    try {
      console.log(`[UserDataStream] Update received for user: ${userId}:`, JSON.stringify(userData));
      if (userData.eventType === 'executionReport') {
        // Handle order updates
        await this.handleOrderUpdate(userId, userData);
      } else if (userData.eventType === 'outboundAccountPosition') {
        // Handle balance updates
        await this.handleBalanceUpdate(userId, userData);
      }
    } catch (error) {
      console.error(`[UserDataStream] Error handling update for user: ${userId}:`, error.message);
    }
  }

  // Handle order execution reports
  async handleOrderUpdate(userId, orderData) {
    try {
      // Find bots for this user and symbol
      const userBots = Array.from(this.activeBots.values()).filter(
        ({ bot }) => bot.user_id.toString() === userId.toString() && bot.symbol === orderData.symbol
      );

      for (const { bot } of userBots) {
        // Update bot's grid orders based on execution
        if (orderData.orderStatus === 'FILLED') {
          // This will trigger the existing grid replacement logic
          await this.handleFilledOrder(bot, orderData);
        }
      }
    } catch (error) {
      // Error handling order update
    }
  }

  // Handle balance updates
  async handleBalanceUpdate(userId, balanceData) {
    try {
      // Update any cached balance information
      // This ensures real-time balance updates for the user
    } catch (error) {
      // Error handling balance update
    }
  }

  // Handle price updates
  async handlePriceUpdate(symbol, priceData) {
    try {
      // Find all active bots for this symbol
      const symbolBots = Array.from(this.activeBots.values())
        .filter(botData => botData.bot.symbol === symbol);

      for (const botData of symbolBots) {
        await this.processOrderFills(botData.bot, priceData.price);
        await this.checkRiskManagement(botData.bot, priceData.price);
      }
    } catch (error) {
      // Error handling price update
    }
  }

  // Process order fills and create new orders
  async processOrderFills(bot, currentPrice) {
    try {
      // Set test mode for this bot
      binanceService.setTestMode(bot.test_mode);
      
      // Get all orders for this bot
      const orders = await GridOrder.findActiveByBot(bot._id);

      for (const order of orders) {
        // Check order status on Binance
        const statusResult = await binanceService.getOrderStatus(bot.user_id, bot.symbol, order.binance_order_id, bot.test_mode);
        
        if (!statusResult.success) {
          continue;
        }
        
        if (statusResult.success && statusResult.order.status === 'FILLED') {
          // Mark order as filled
          await order.markFilled({
            quantity: statusResult.order.executedQty,
            price: statusResult.order.price,
            commission: 0, // Will be updated from trade data
            commissionAsset: bot.symbol.replace('USDT', '')
          });

          // Create opposite order
          await this.createOppositeOrder(bot, order, currentPrice);

          // Update bot performance
          await this.updateBotPerformance(bot, order);
        }
      }
    } catch (error) {
      // Error processing order fills
    }
  }

  // Create replacement order after a fill (proper grid trading)
  async createOppositeOrder(bot, filledOrder, currentPrice) {
    try {
      // Get symbol info first for proper price precision
      const symbolInfo = await binanceService.getSymbolInfo(bot.symbol);
      if (!symbolInfo.success) {
        return;
      }

      const gridSpacing = parseFloat(bot.grid_params.grid_spacing);
      const filledPrice = parseFloat(filledOrder.price);
      let newSide, newPrice, newGridLevel;
      
      if (filledOrder.side === 'BUY') {
        // BUY order filled → Create SELL order one level UP
        newSide = 'SELL';
        // Calculate new price and format it immediately to avoid precision issues
        const rawPrice = filledPrice + gridSpacing;
        newPrice = binanceService.formatPrice(rawPrice, symbolInfo.tickSize);
        newGridLevel = filledOrder.grid_level + 1;
      } else {
        // SELL order filled → Create BUY order one level DOWN  
        newSide = 'BUY';
        // Calculate new price and format it immediately to avoid precision issues
        const rawPrice = filledPrice - gridSpacing;
        newPrice = binanceService.formatPrice(rawPrice, symbolInfo.tickSize);
        newGridLevel = filledOrder.grid_level - 1;
      }

      // Check if new price is within grid range
      if (newPrice > bot.grid_params.upper_price || newPrice < bot.grid_params.lower_price) {
        return;
      }

      // Check if there's already an order at this grid level
      const existingOrder = await GridOrder.findOne({
        bot_id: bot._id,
        grid_level: newGridLevel,
        status: { $in: ['NEW', 'PARTIALLY_FILLED'] }
      });

      if (existingOrder) {
        return;
      }

      // Format price and quantity according to symbol precision (symbolInfo already obtained above)
      const formattedPrice = newPrice; // Already formatted above
      const formattedQuantity = binanceService.formatQuantity(filledOrder.quantity, symbolInfo.stepSize);

      // Generate client order ID
      const shortId = bot._id.toString().slice(-8);
      const timestamp = Date.now().toString().slice(-6);
      const clientOrderId = `r_${shortId}_${timestamp}`; // r = replacement
      
      // Get user ID from bot data
      const userId = bot.user_id;
      
      // Place new order with formatted values
      const orderResult = await binanceService.placeLimitOrder(
        userId,
        bot.symbol,
        newSide,
        formattedQuantity,
        formattedPrice,
        bot.test_mode,
        { newClientOrderId: clientOrderId }
      );

      if (orderResult.success) {
        // Save new order to database
        const newOrder = new GridOrder({
          bot_id: bot._id,
          binance_order_id: orderResult.order.orderId,
          client_order_id: orderResult.order.clientOrderId,
          symbol: bot.symbol,
          price: formattedPrice,
          quantity: formattedQuantity,
          side: newSide,
          status: 'NEW',
          grid_level: newGridLevel,
          created_at: new Date()
        });

        await newOrder.save();
      }
    } catch (error) {
      // Error creating replacement order
    }
  }

  // Check risk management rules
  async checkRiskManagement(bot, currentPrice) {
    try {
      // Check stop loss
      if (currentPrice <= bot.risk_params.stop_loss_price) {
        await this.stopBot(bot._id, bot.user_id);
        return;
      }

      // Check maximum drawdown
      const performance = await BotPerformance.getByBot(bot._id);
      if (performance && performance.pnl_percentage <= -bot.risk_params.max_drawdown_percentage) {
        await this.stopBot(bot._id, bot.user_id);
        return;
      }

      // Check take profit
      if (performance && performance.pnl_percentage >= bot.risk_params.take_profit_percentage) {
        await this.stopBot(bot._id, bot.user_id);
        return;
      }
    } catch (error) {
      // Error checking risk management
    }
  }

  // Update bot performance
  async updateBotPerformance(bot, order) {
    try {
      const performance = await BotPerformance.getByBot(bot._id);
      if (!performance) return;

      // Calculate trade profit (simplified)
      const tradeProfit = order.side === 'SELL' ? 
        (order.price - bot.grid_params.current_price) * order.quantity :
        (bot.grid_params.current_price - order.price) * order.quantity;

      // Update performance metrics
      await performance.updateMetrics({
        profit: tradeProfit,
        volume: order.price * order.quantity,
        commission: 0
      });

      // Update grid performance
      performance.updateGridPerformance(order.grid_level, order.side, tradeProfit);
      
      // Calculate PnL percentage
      performance.calculatePnLPercentage(bot.investment_amount);
      
      await performance.save();

    } catch (error) {
      // Error updating bot performance
    }
  }

  // Cancel all orders for a bot
  async cancelAllBotOrders(bot) {
    try {
      const orders = await GridOrder.findActiveByBot(bot._id);
      
      for (const order of orders) {
        try {
          const result = await binanceService.cancelOrder(bot.user_id, {
            symbol: order.symbol,
            orderId: order.binance_order_id
          }, bot.test_mode);

          if (result.success) {
            // Update order status in database
            await GridOrder.findByIdAndUpdate(order._id, {
              status: 'CANCELLED',
              updated_at: new Date()
            });
          }
        } catch (error) {
          // Error cancelling order - continue with others
        }
      }
      
    } catch (error) {
      // Error cancelling bot orders
    }
  }

  // Load existing active bots
  async loadActiveBots() {
    try {
      const activeBots = await AIGridBot.find({ status: 'active' });
      
      for (const bot of activeBots) {
        await this.startBotMonitoring(bot);
      }
    } catch (error) {
      // Error loading active bots
    }
  }

  // Start monitoring intervals
  startMonitoring() {
    // Monitor orders every 10 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        for (const [botId, botData] of this.activeBots) {
          const currentPrice = binanceService.getCachedPrice(botData.bot.symbol);
          
          if (currentPrice) {
            await this.processOrderFills(botData.bot, currentPrice);
            await this.checkRiskManagement(botData.bot, currentPrice);
          } else {
            // Try to get price via REST API as fallback
            const restPrice = await binanceService.getCurrentPriceREST(botData.bot.symbol);
            
            if (restPrice) {
              await this.processOrderFills(botData.bot, restPrice);
              await this.checkRiskManagement(botData.bot, restPrice);
            }
          }
        }
      } catch (error) {
        // Error in monitoring interval
      }
    }, 10000); // 10 seconds
  }

  // Start performance update intervals
  startPerformanceUpdates() {
    // Update performance every 30 seconds
    this.performanceUpdateInterval = setInterval(async () => {
      try {
        for (const [botId, botData] of this.activeBots) {
          // Update bot's updated_at timestamp
          botData.bot.updated_at = new Date();
          await botData.bot.save();
        }
      } catch (error) {
        // Error in performance update interval
      }
    }, 30000); // 30 seconds
  }

  // Stop monitoring
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    if (this.performanceUpdateInterval) {
      clearInterval(this.performanceUpdateInterval);
      this.performanceUpdateInterval = null;
    }
  }

  // Stop all price streams
  stopAllPriceStreams() {
    for (const [symbol, cleanup] of this.priceStreams) {
      cleanup();
    }
    this.priceStreams.clear();
  }

  // Get bot status
  async getBotStatus(botId, userId) {
    try {
      const bot = await AIGridBot.findOne({ _id: botId, user_id: userId });
      if (!bot) {
        return { success: false, error: 'Bot not found' };
      }

      const orders = await GridOrder.findByBot(botId);
      const performance = await BotPerformance.getByBot(botId);
      
      return {
        success: true,
        bot: bot,
        orders: orders,
        performance: performance,
        isActive: this.activeBots.has(botId.toString())
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Get engine status
  getEngineStatus() {
    return {
      isRunning: this.isRunning,
      activeBots: this.activeBots.size,
      priceStreams: this.priceStreams.size,
      uptime: this.isRunning ? Date.now() - this.startTime : 0
    };
  }

  // Stop all user bots and cancel all open orders
  async stopAllUserBots(userId) {
    try {
      // Get all active bots for the user
      const activeBots = await AIGridBot.find({
        user_id: userId,
        status: 'active'
      });

      if (activeBots.length === 0) {
        return {
          success: true,
          stopped_bots: 0,
          cancelled_orders: 0,
          bot_details: []
        };
      }

      let totalCancelledOrders = 0;
      const botDetails = [];

      // Stop each bot and cancel its orders
      for (const bot of activeBots) {
        try {
          // Get all active orders for this bot
          const activeOrders = await GridOrder.find({
            bot_id: bot._id,
            status: { $in: ['NEW', 'PARTIALLY_FILLED'] }
          });

          // Cancel all open orders on Binance
          let cancelledOrders = 0;
          for (const order of activeOrders) {
            try {
              const result = await binanceService.cancelOrder(userId, {
                symbol: order.symbol,
                orderId: order.binance_order_id
              }, bot.test_mode);

              if (result.success) {
                // Update order status in database
                await GridOrder.findByIdAndUpdate(order._id, {
                  status: 'CANCELLED',
                  updated_at: new Date()
                });
                cancelledOrders++;
              }
            } catch (orderError) {
              // Continue with other orders if one fails
            }
          }

          // Stop the bot
          await bot.stopBot();

          // Remove bot from active monitoring
          this.activeBots.delete(bot._id.toString());

          // Close WebSocket streams for this bot
          const streamKey = `${bot.symbol.toLowerCase()}@ticker`;
          if (this.priceStreams.has(streamKey)) {
            const stream = this.priceStreams.get(streamKey);
            if (stream.close) {
              stream.close();
            }
            this.priceStreams.delete(streamKey);
          }

          totalCancelledOrders += cancelledOrders;
          botDetails.push({
            bot_id: bot._id,
            symbol: bot.symbol,
            cancelled_orders: cancelledOrders,
            investment_amount: bot.investment_amount,
            test_mode: bot.test_mode
          });

        } catch (botError) {
          // Continue with other bots if one fails
          botDetails.push({
            bot_id: bot._id,
            symbol: bot.symbol,
            cancelled_orders: 0,
            investment_amount: bot.investment_amount,
            test_mode: bot.test_mode,
            error: 'Failed to stop bot completely'
          });
        }
      }

      return {
        success: true,
        stopped_bots: activeBots.length,
        cancelled_orders: totalCancelledOrders,
        bot_details: botDetails
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        stopped_bots: 0,
        cancelled_orders: 0
      };
    }
  }
}

export default new GridBotEngine();