const GridBot = require('../models/GridBot');
const GridBotService = require('../services/gridBotService');
const BinanceService = require('../services/binanceService');
const KimiAIService = require('../services/kimiAIService');

const gridBotService = new GridBotService();
const binanceService = new BinanceService();
const kimiAIService = new KimiAIService();

// Create a new grid bot
const createGridBot = async (req, res) => {
  try {
    const { name, symbol, investmentAmount, upperPrice, lowerPrice, gridLevels, profitPerGrid, useAI = true } = req.body;
    const userId = req.user._id;

    console.log(`Creating grid bot for user ${userId}:`, { name, symbol, investmentAmount, useAI });

    // Check if user has configured Binance credentials
    const User = require('../models/User');
    const user = await User.findById(userId);
    
    if (!user.hasBinanceCredentials()) {
      return res.status(400).json({
        success: false,
        message: 'Binance API credentials are required to create a grid bot. Please configure your Binance API keys first.',
        requiresCredentials: true
      });
    }

    // Basic input validation
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Bot name is required and cannot be empty'
      });
    }

    if (!symbol || symbol.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Trading symbol is required'
      });
    }

    if (!investmentAmount || investmentAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Investment amount is required and must be greater than 0'
      });
    }

    let gridConfig;
    
    // Use AI to generate parameters or validate manual input
    if (useAI && (!upperPrice || !lowerPrice || !gridLevels || !profitPerGrid)) {
      console.log('Using AI to generate grid bot parameters...');
      try {
        gridConfig = await kimiAIService.analyzeGridBotParameters(symbol.toUpperCase(), investmentAmount);
        console.log('AI generated parameters:', gridConfig);
      } catch (aiError) {
        console.error('AI parameter generation failed:', aiError.message);
        return res.status(500).json({
          success: false,
          message: 'Failed to generate optimal parameters. Please provide manual parameters or try again later.',
          error: aiError.message
        });
      }
    } else {
      // Manual parameter validation
      if (!upperPrice || !lowerPrice || !gridLevels || !profitPerGrid) {
        return res.status(400).json({
          success: false,
          message: 'All configuration parameters are required (upperPrice, lowerPrice, gridLevels, profitPerGrid) when not using AI'
        });
      }

      if (upperPrice <= lowerPrice) {
        return res.status(400).json({
          success: false,
          message: 'Upper price must be greater than lower price'
        });
      }

      if (gridLevels < 2 || gridLevels > 100) {
        return res.status(400).json({
          success: false,
          message: 'Grid levels must be between 2 and 100'
        });
      }

      if (profitPerGrid <= 0 || profitPerGrid > 50) {
        return res.status(400).json({
          success: false,
          message: 'Profit per grid must be between 0.1% and 50%'
        });
      }

      gridConfig = {
        upperPrice: parseFloat(upperPrice),
        lowerPrice: parseFloat(lowerPrice),
        gridLevels: parseInt(gridLevels),
        profitPerGrid: parseFloat(profitPerGrid),
        reasoning: 'Manual configuration',
        aiGenerated: false
      };
    }

    // Check if symbol exists and get symbol info
    let symbolInfo;
    try {
      symbolInfo = await binanceService.getSymbolInfo(symbol.toUpperCase());
      console.log(`Symbol validation passed for ${symbol.toUpperCase()}`);
    } catch (error) {
      console.error(`Symbol validation failed for ${symbol}:`, error.message);
      return res.status(400).json({
        success: false,
        message: `Invalid or unsupported symbol: ${symbol}. Please check if the symbol exists on Binance.`
      });
    }

    // Check for duplicate bot names for this user
    const existingBot = await GridBot.findOne({ userId, name: name.trim() });
    if (existingBot) {
      return res.status(400).json({
        success: false,
        message: 'A bot with this name already exists. Please choose a different name.'
      });
    }

    // Create temporary bot object for validation using AI-generated or manual config
    const tempBot = {
      symbol: symbol.toUpperCase(),
      config: {
        upperPrice: gridConfig.upperPrice,
        lowerPrice: gridConfig.lowerPrice,
        gridLevels: gridConfig.gridLevels,
        investmentAmount: parseFloat(investmentAmount),
        profitPerGrid: gridConfig.profitPerGrid
      }
    };

    // **CRITICAL: Validate bot configuration and user balance BEFORE creating**
    try {
      console.log('Pre-creation validation starting...');
      const userBinance = await gridBotService.getUserBinanceService(userId);
      await gridBotService.validateBotConfig(tempBot, userBinance);
      console.log('Pre-creation validation passed');
    } catch (validationError) {
      console.error('Pre-creation validation failed:', validationError.message);
      return res.status(400).json({
        success: false,
        message: `Bot creation failed: ${validationError.message}`,
        error: 'VALIDATION_FAILED',
        details: {
          type: validationError.message.includes('balance') ? 'INSUFFICIENT_BALANCE' : 
                 validationError.message.includes('notional') ? 'MINIMUM_AMOUNT_ERROR' : 
                 validationError.message.includes('price') ? 'PRICE_RANGE_ERROR' : 'CONFIGURATION_ERROR',
          suggestion: validationError.message.includes('balance') ? 'Please deposit more funds to your account' :
                     validationError.message.includes('notional') ? 'Increase investment amount or reduce grid levels' :
                     validationError.message.includes('price') ? 'Adjust price range to include current market price' :
                     'Please check your bot configuration'
        }
      });
    }

    // Create grid bot only after validation passes
    let gridBot;
    try {
      console.log('Creating bot in database...');
      gridBot = await GridBot.create({
        userId,
        name: name.trim(),
        symbol: symbol.toUpperCase(),
        config: {
          upperPrice: gridConfig.upperPrice,
          lowerPrice: gridConfig.lowerPrice,
          gridLevels: gridConfig.gridLevels,
          investmentAmount: parseFloat(investmentAmount),
          profitPerGrid: gridConfig.profitPerGrid
        },
        // Add AI analysis metadata
        aiAnalysis: gridConfig.aiGenerated ? {
          reasoning: gridConfig.reasoning,
          generatedAt: new Date(),
          parameters: {
            upperPrice: gridConfig.upperPrice,
            lowerPrice: gridConfig.lowerPrice,
            gridLevels: gridConfig.gridLevels,
            profitPerGrid: gridConfig.profitPerGrid
          }
        } : null
      });
      console.log(`Bot created successfully with ID: ${gridBot._id}`);
    } catch (dbError) {
      console.error('Database error during bot creation:', dbError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to create bot in database',
        error: 'DATABASE_ERROR'
      });
    }

    // Automatically start the bot after creation
    try {
      console.log(`Auto-starting bot ${gridBot._id}...`);
      const startResult = await gridBotService.startBot(gridBot._id);
      
      // Fetch updated bot with active status
      const updatedBot = await GridBot.findById(gridBot._id);
      
      console.log(`Bot ${gridBot._id} created and started successfully`);
      res.status(201).json({
        success: true,
        message: 'Grid bot created and started successfully! 🚀',
        data: {
          bot: updatedBot,
          startResult
        },
        info: {
          ordersPlaced: updatedBot.orders.length,
          investmentAllocated: investmentAmount,
          gridRange: `${gridConfig.lowerPrice} - ${gridConfig.upperPrice}`,
          profitTarget: `${gridConfig.profitPerGrid}% per grid`,
          aiGenerated: gridConfig.aiGenerated || false,
          reasoning: gridConfig.reasoning || null
        }
      });
    } catch (startError) {
      console.error('Failed to auto-start bot:', startError.message);
      
      // If auto-start fails, delete the created bot to maintain consistency
      try {
        await GridBot.findByIdAndDelete(gridBot._id);
        console.log(`Cleaned up failed bot ${gridBot._id}`);
      } catch (cleanupError) {
        console.error('Failed to cleanup bot after start failure:', cleanupError.message);
      }
      
      return res.status(400).json({
        success: false,
        message: `Bot creation failed during startup: ${startError.message}`,
        error: 'STARTUP_FAILED',
        details: {
          type: startError.message.includes('balance') ? 'INSUFFICIENT_BALANCE' : 
                 startError.message.includes('order') ? 'ORDER_PLACEMENT_ERROR' : 'STARTUP_ERROR',
          suggestion: 'Please check your account balance and try again'
        }
      });
    }
  } catch (error) {
    console.error('Create grid bot error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during grid bot creation'
    });
  }
};

// Get all user's grid bots
const getUserGridBots = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, symbol } = req.query;

    const filter = { userId };
    if (status) filter.status = status;
    if (symbol) filter.symbol = symbol.toUpperCase();

    const gridBots = await GridBot.find(filter).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        bots: gridBots,
        count: gridBots.length
      }
    });
  } catch (error) {
    console.error('Get grid bots error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching grid bots'
    });
  }
};

// Get specific grid bot
const getGridBot = async (req, res) => {
  try {
    const { botId } = req.params;
    const userId = req.user._id;

    const gridBot = await GridBot.findOne({ _id: botId, userId });
    
    if (!gridBot) {
      return res.status(404).json({
        success: false,
        message: 'Grid bot not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        bot: gridBot
      }
    });
  } catch (error) {
    console.error('Get grid bot error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching grid bot'
    });
  }
};

// Start a grid bot
const startGridBot = async (req, res) => {
  try {
    const { botId } = req.params;
    const userId = req.user._id;

    const gridBot = await GridBot.findOne({ _id: botId, userId });
    
    if (!gridBot) {
      return res.status(404).json({
        success: false,
        message: 'Grid bot not found'
      });
    }

    if (gridBot.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Grid bot is already active'
      });
    }

    const result = await gridBotService.startBot(botId);

    res.status(200).json({
      success: true,
      message: 'Grid bot started successfully',
      data: result
    });
  } catch (error) {
    console.error('Start grid bot error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while starting grid bot'
    });
  }
};

// Stop a grid bot
const stopGridBot = async (req, res) => {
  try {
    const { botId } = req.params;
    const userId = req.user._id;

    const gridBot = await GridBot.findOne({ _id: botId, userId });
    
    if (!gridBot) {
      return res.status(404).json({
        success: false,
        message: 'Grid bot not found'
      });
    }

    if (gridBot.status === 'stopped') {
      return res.status(400).json({
        success: false,
        message: 'Grid bot is already stopped'
      });
    }

    const result = await gridBotService.stopBot(botId);

    res.status(200).json({
      success: true,
      message: 'Grid bot stopped successfully',
      data: result
    });
  } catch (error) {
    console.error('Stop grid bot error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while stopping grid bot'
    });
  }
};

// Pause a grid bot
const pauseGridBot = async (req, res) => {
  try {
    const { botId } = req.params;
    const userId = req.user._id;

    const gridBot = await GridBot.findOne({ _id: botId, userId });
    
    if (!gridBot) {
      return res.status(404).json({
        success: false,
        message: 'Grid bot not found'
      });
    }

    if (gridBot.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Only active bots can be paused'
      });
    }

    // Stop monitoring but don't cancel orders
    gridBot.status = 'paused';
    await gridBot.save();

    // Clear monitoring interval
    if (gridBotService.intervals.has(botId)) {
      clearInterval(gridBotService.intervals.get(botId));
      gridBotService.intervals.delete(botId);
    }
    gridBotService.activeBots.delete(botId);

    res.status(200).json({
      success: true,
      message: 'Grid bot paused successfully'
    });
  } catch (error) {
    console.error('Pause grid bot error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while pausing grid bot'
    });
  }
};

// Delete a grid bot
const deleteGridBot = async (req, res) => {
  try {
    const { botId } = req.params;
    const userId = req.user._id;

    const gridBot = await GridBot.findOne({ _id: botId, userId });
    
    if (!gridBot) {
      return res.status(404).json({
        success: false,
        message: 'Grid bot not found'
      });
    }

    // Stop bot if active
    if (gridBot.status === 'active') {
      await gridBotService.stopBot(botId);
    }

    // Delete bot
    await GridBot.findByIdAndDelete(botId);

    res.status(200).json({
      success: true,
      message: 'Grid bot deleted successfully'
    });
  } catch (error) {
    console.error('Delete grid bot error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting grid bot'
    });
  }
};

// Get grid bot performance
const getGridBotPerformance = async (req, res) => {
  try {
    const { botId } = req.params;
    const userId = req.user._id;

    const gridBot = await GridBot.findOne({ _id: botId, userId });
    
    if (!gridBot) {
      return res.status(404).json({
        success: false,
        message: 'Grid bot not found'
      });
    }

    const performance = await gridBotService.getBotPerformance(botId);

    res.status(200).json({
      success: true,
      data: {
        performance
      }
    });
  } catch (error) {
    console.error('Get grid bot performance error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while fetching performance'
    });
  }
};

// Get detailed grid bot analysis with complete trade history and PnL breakdown
const getDetailedGridBotAnalysis = async (req, res) => {
  try {
    const { botId } = req.params;
    const userId = req.user._id;

    // Verify bot ownership
    const gridBot = await GridBot.findOne({ _id: botId, userId });
    
    if (!gridBot) {
      return res.status(404).json({
        success: false,
        message: 'Grid bot not found or you do not have permission to access this bot'
      });
    }

    // Get detailed analysis
    const analysis = await gridBotService.getDetailedBotAnalysis(botId);

    res.status(200).json({
      success: true,
      message: 'Detailed bot analysis retrieved successfully',
      data: {
        analysis
      }
    });
  } catch (error) {
    console.error('Get detailed grid bot analysis error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while fetching detailed analysis'
    });
  }
};

// Get market data for symbol
const getMarketData = async (req, res) => {
  try {
    const { symbol } = req.params;

    const [price, symbolInfo] = await Promise.all([
      binanceService.getSymbolPrice(symbol.toUpperCase()),
      binanceService.getSymbolInfo(symbol.toUpperCase())
    ]);

    res.status(200).json({
      success: true,
      data: {
        symbol: symbol.toUpperCase(),
        currentPrice: price,
        symbolInfo: {
          baseAsset: symbolInfo.baseAsset,
          quoteAsset: symbolInfo.quoteAsset,
          pricePrecision: symbolInfo.pricePrecision,
          quantityPrecision: symbolInfo.quantityPrecision,
          minQty: symbolInfo.minQty,
          minNotional: symbolInfo.minNotional,
          tickSize: symbolInfo.tickSize
        }
      }
    });
  } catch (error) {
    console.error('Get market data error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while fetching market data'
    });
  }
};

// Get account balance
const getAccountBalance = async (req, res) => {
  try {
    const userId = req.user._id;
    const userBinance = await gridBotService.getUserBinanceService(userId);
    const accountInfo = await userBinance.getAccountInfo();
    
    // Filter out zero balances
    const balances = accountInfo.balances
      .filter(balance => parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0)
      .map(balance => ({
        asset: balance.asset,
        free: parseFloat(balance.free),
        locked: parseFloat(balance.locked),
        total: parseFloat(balance.free) + parseFloat(balance.locked)
      }));

    res.status(200).json({
      success: true,
      data: {
        balances,
        canTrade: accountInfo.canTrade,
        canWithdraw: accountInfo.canWithdraw,
        canDeposit: accountInfo.canDeposit
      }
    });
  } catch (error) {
    console.error('Get account balance error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while fetching account balance'
    });
  }
};

// Get all available trading symbols from Binance
const getAllSymbols = async (req, res) => {
  try {
    const { search, quoteAsset, limit } = req.query;
    
    // Get all symbols from Binance
    const allSymbols = await binanceService.getAllSymbols();
    
    let filteredSymbols = allSymbols;
    
    // Filter by quote asset if specified (e.g., USDT, BTC, ETH)
    if (quoteAsset) {
      filteredSymbols = filteredSymbols.filter(symbol => 
        symbol.quoteAsset.toUpperCase() === quoteAsset.toUpperCase()
      );
    }
    
    // Filter by search term if specified
    if (search) {
      const searchTerm = search.toUpperCase();
      filteredSymbols = filteredSymbols.filter(symbol => 
        symbol.symbol.includes(searchTerm) || 
        symbol.baseAsset.includes(searchTerm)
      );
    }
    
    // Apply limit only if specified, otherwise return all symbols
    const finalSymbols = limit ? filteredSymbols.slice(0, parseInt(limit)) : filteredSymbols;
    
    res.status(200).json({
      success: true,
      data: {
        symbols: finalSymbols,
        total: filteredSymbols.length,
        returned: finalSymbols.length,
        filters: {
          search: search || null,
          quoteAsset: quoteAsset || null,
          limit: limit ? parseInt(limit) : null
        }
      }
    });
  } catch (error) {
    console.error('Get all symbols error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while fetching symbols'
    });
  }
};

module.exports = {
  createGridBot,
  getUserGridBots,
  getGridBot,
  startGridBot,
  stopGridBot,
  pauseGridBot,
  deleteGridBot,
  getGridBotPerformance,
  getDetailedGridBotAnalysis,
  getMarketData,
  getAccountBalance,
  getAllSymbols
};