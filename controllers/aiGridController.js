import { validationResult } from 'express-validator';
import AIGridBot from '../models/AIGridBot.js';
import GridOrder from '../models/GridOrder.js';
import BotPerformance from '../models/BotPerformance.js';
import gridBotEngine from '../services/gridBotEngine.js';
import aiGridService from '../services/aiGridService.js';
import binanceService from '../services/binanceService.js';

class AIGridController {
  // Create a new AI Grid Bot
  async createBot(req, res) {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { symbol, investment_amount, test = true } = req.body;
      const userId = req.user.userId;

      // Check if user already has an active bot for this symbol
      const existingBot = await AIGridBot.findOne({
        user_id: userId,
        symbol: symbol.toUpperCase(),
        status: 'active'
      });

      if (existingBot) {
        return res.status(400).json({
          success: false,
          message: `You already have an active bot for ${symbol.toUpperCase()}`
        });
      }

      // Create bot using grid engine
      const result = await gridBotEngine.createBot(userId, symbol, investment_amount, test);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error
        });
      }

      res.status(201).json({
        success: true,
        message: `AI Grid Bot created successfully in ${test ? 'TEST' : 'LIVE'} mode`,
        data: {
          bot: result.bot.summary,
          test_mode: test,
          parameters: result.parameters.grid_params,
          market_analysis: result.parameters.market_analysis,
          risk_assessment: result.parameters.risk_assessment,
          expected_performance: result.parameters.expected_performance
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to create AI Grid Bot'
      });
    }
  }

  // Get all bots for authenticated user
  async getBots(req, res) {
    try {
      const userId = req.user.userId;
      const { status, symbol, limit = 10, offset = 0 } = req.query;

      // Build query
      const query = { user_id: userId };
      if (status) query.status = status;
      if (symbol) query.symbol = symbol.toUpperCase();

      // Get bots with pagination
      const bots = await AIGridBot.find(query)
        .sort({ created_at: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(offset));

      // Get performance data for each bot and calculate correct profit metrics
      const botsWithPerformance = await Promise.all(
        bots.map(async (bot) => {
          const performance = await BotPerformance.getByBot(bot._id);
          
          // If we have performance data, use it for the main bot fields
          // Otherwise, calculate real-time performance using the same logic as realtime-stats
          let calculatedPerformance = null;
          
          if (performance) {
            calculatedPerformance = performance.summary;
          } else {
            // Fallback: Calculate basic performance from orders
            try {
              const filledOrders = await GridOrder.find({
                bot_id: bot._id,
                status: 'FILLED'
              });
              
              if (filledOrders.length > 0) {
                // Use simplified profit calculation for bot list
                const buyOrders = filledOrders.filter(order => order.side === 'BUY');
                const sellOrders = filledOrders.filter(order => order.side === 'SELL');
                
                let totalProfit = 0;
                let totalTrades = 0;
                let winningTrades = 0;
                
                // Simple FIFO pairing for performance overview
                const pairedOrderIds = new Set();
                
                for (const sellOrder of sellOrders) {
                  if (pairedOrderIds.has(sellOrder._id.toString())) continue;
                  
                  // Find best matching buy order
                  const matchingBuyOrder = buyOrders.find(buyOrder => 
                    !pairedOrderIds.has(buyOrder._id.toString()) &&
                    buyOrder.filled_price < sellOrder.filled_price
                  );
                  
                  if (matchingBuyOrder) {
                    const profit = (sellOrder.filled_price - matchingBuyOrder.filled_price) * 
                                 Math.min(matchingBuyOrder.filled_quantity, sellOrder.filled_quantity) -
                                 (matchingBuyOrder.commission || 0) - (sellOrder.commission || 0);
                    
                    totalProfit += profit;
                    totalTrades++;
                    
                    if (profit > 0) winningTrades++;
                    
                    pairedOrderIds.add(matchingBuyOrder._id.toString());
                    pairedOrderIds.add(sellOrder._id.toString());
                  }
                }
                
                const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
                const pnlPercentage = (totalProfit / bot.investment_amount) * 100;
                
                calculatedPerformance = {
                  bot_id: bot._id,
                  symbol: bot.symbol,
                  total_profit: totalProfit,
                  total_trades: totalTrades,
                  win_rate: winRate,
                  pnl_percentage: pnlPercentage,
                  max_drawdown: 0,
                  profit_factor: 0,
                  avg_trade_profit: totalTrades > 0 ? totalProfit / totalTrades : 0,
                  best_trade: 0,
                  worst_trade: 0,
                  last_updated: new Date()
                };
              }
            } catch (error) {
              // If calculation fails, use zeros
              calculatedPerformance = {
                bot_id: bot._id,
                symbol: bot.symbol,
                total_profit: 0,
                total_trades: 0,
                win_rate: 0,
                pnl_percentage: 0,
                max_drawdown: 0,
                profit_factor: 0,
                avg_trade_profit: 0,
                best_trade: 0,
                worst_trade: 0,
                last_updated: new Date()
              };
            }
          }
          
          // Return bot summary with corrected performance data in main fields
          return {
            id: bot._id,
            symbol: bot.symbol,
            investment_amount: bot.investment_amount,
            status: bot.status,
            stop_reason: bot.stop_reason,
            // Use calculated performance data for main fields instead of bot.performance
            total_profit: calculatedPerformance ? calculatedPerformance.total_profit : 0,
            pnl_percentage: calculatedPerformance ? calculatedPerformance.pnl_percentage : 0,
            total_trades: calculatedPerformance ? calculatedPerformance.total_trades : 0,
            stop_loss_price: bot.risk_params.stop_loss_price,
            created_at: bot.created_at,
            updated_at: bot.updated_at,
            stopped_at: bot.stopped_at,
            // Keep the detailed performance object as well
            performance: calculatedPerformance
          };
        })
      );

      res.status(200).json({
        success: true,
        data: {
          bots: botsWithPerformance,
          total: await AIGridBot.countDocuments(query),
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve bots'
      });
    }
  }

  // Get specific bot details
  async getBotDetails(req, res) {
    try {
      const { botId } = req.params;
      const userId = req.user.userId;

      const result = await gridBotEngine.getBotStatus(botId, userId);
      
      if (!result.success) {
        return res.status(404).json({
          success: false,
          message: result.error
        });
      }

      res.status(200).json({
        success: true,
        data: {
          bot: result.bot,
          orders: result.orders.map(order => order.summary),
          performance: result.performance ? result.performance.summary : null,
          isActive: result.isActive
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve bot details'
      });
    }
  }

  // Stop a bot
  async stopBot(req, res) {
    try {
      const { botId } = req.params;
      const userId = req.user.userId;

      const result = await gridBotEngine.stopBot(botId, userId);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error
        });
      }

      res.status(200).json({
        success: true,
        message: 'Bot stopped successfully'
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to stop bot'
      });
    }
  }

  // Get bot performance
  async getBotPerformance(req, res) {
    try {
      const { botId } = req.params;
      const userId = req.user.userId;

      // Verify bot ownership
      const bot = await AIGridBot.findOne({ _id: botId, user_id: userId });
      if (!bot) {
        return res.status(404).json({
          success: false,
          message: 'Bot not found'
        });
      }

      const performance = await BotPerformance.getByBot(botId);
      const orders = await GridOrder.findByBot(botId);
      const filledOrders = await GridOrder.findFilledByBot(botId);

      res.status(200).json({
        success: true,
        data: {
          performance: performance || null,
          orders: {
            total: orders.length,
            filled: filledOrders.length,
            active: orders.filter(o => ['NEW', 'PARTIALLY_FILLED'].includes(o.status)).length
          },
          recent_trades: filledOrders.slice(0, 10).map(order => order.summary)
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve bot performance'
      });
    }
  }

  // Get available symbols
  async getSymbols(req, res) {
    try {
      const result = await aiGridService.getAvailableSymbols();
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error
        });
      }

      res.status(200).json({
        success: true,
        data: {
          symbols: result.symbols
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve symbols'
      });
    }
  }

  // Get account balance
  async getBalance(req, res) {
    try {
      const result = await binanceService.getAccountBalance();
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error
        });
      }

      // Filter and format important balances
      const importantBalances = result.balances
        .filter(balance => parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0)
        .map(balance => ({
          asset: balance.asset,
          free: parseFloat(balance.free),
          locked: parseFloat(balance.locked),
          total: parseFloat(balance.free) + parseFloat(balance.locked)
        }))
        .sort((a, b) => b.total - a.total);

      res.status(200).json({
        success: true,
        data: {
          balances: importantBalances,
          total_assets: importantBalances.length
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve account balance'
      });
    }
  }

  // Generate AI parameters preview (without creating bot)
  async previewParameters(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { symbol, investment_amount, test = true } = req.body;

      const result = await aiGridService.generateAIParameters(symbol, investment_amount, test);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error
        });
      }

      res.status(200).json({
        success: true,
        data: {
          symbol: result.parameters.symbol,
          investment_amount: result.parameters.investment_amount,
          grid_params: result.parameters.grid_params,
          market_analysis: result.parameters.market_analysis,
          risk_assessment: result.parameters.risk_assessment,
          expected_performance: result.parameters.expected_performance
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to generate parameter preview'
      });
    }
  }

  // Get trading statistics
  async getTradingStats(req, res) {
    try {
      const userId = req.user.userId;

      // Get user's bot statistics
      const totalBots = await AIGridBot.countDocuments({ user_id: userId });
      const activeBots = await AIGridBot.countDocuments({ user_id: userId, status: 'active' });
      const stoppedBots = await AIGridBot.countDocuments({ user_id: userId, status: 'stopped' });

      // Get total performance across all bots
      const performanceStats = await BotPerformance.aggregate([
        {
          $lookup: {
            from: 'aigridbots',
            localField: 'bot_id',
            foreignField: '_id',
            as: 'bot'
          }
        },
        {
          $match: {
            'bot.user_id': userId
          }
        },
        {
          $group: {
            _id: null,
            total_profit: { $sum: '$total_profit' },
            total_trades: { $sum: '$total_trades' },
            total_volume: { $sum: '$total_volume' },
            avg_win_rate: { $avg: '$win_rate' }
          }
        }
      ]);

      const stats = performanceStats.length > 0 ? performanceStats[0] : {
        total_profit: 0,
        total_trades: 0,
        total_volume: 0,
        avg_win_rate: 0
      };

      res.status(200).json({
        success: true,
        data: {
          bots: {
            total: totalBots,
            active: activeBots,
            stopped: stoppedBots
          },
          performance: {
            total_profit: stats.total_profit,
            total_trades: stats.total_trades,
            total_volume: stats.total_volume,
            avg_win_rate: stats.avg_win_rate
          }
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve trading statistics'
      });
    }
  }

  // Get overall trading statistics for user
  async getOverallStats(req, res) {
    try {
      const userId = req.user.userId;

      // Get all user's bots
      const bots = await AIGridBot.find({ user_id: userId });
      const botIds = bots.map(bot => bot._id);

      // Get all filled orders across all bots
      const allFilledOrders = await GridOrder.find({ 
        bot_id: { $in: botIds }, 
        status: 'FILLED' 
      }).sort({ filled_at: 1 });

      // Calculate overall statistics
      let totalProfit = 0;
      let totalTrades = 0;
      let winningTrades = 0;
      let totalVolume = 0;
      const symbolStats = {};

      // Group by bot and calculate profits
      for (const bot of bots) {
        const botOrders = allFilledOrders.filter(order => order.bot_id.toString() === bot._id.toString());
        const buyOrders = [];
        let botProfit = 0;
        let botTrades = 0;

        for (const order of botOrders) {
          totalVolume += order.filled_price * order.filled_quantity;
          
          if (order.side === 'BUY') {
            buyOrders.push(order);
          } else if (order.side === 'SELL') {
            const buyOrder = buyOrders.shift();
            if (buyOrder) {
              const profit = (order.filled_price - buyOrder.filled_price) * order.filled_quantity;
              botProfit += profit;
              totalProfit += profit;
              totalTrades++;
              botTrades++;
              
              if (profit > 0) {
                winningTrades++;
              }
            }
          }
        }

        // Symbol statistics
        if (!symbolStats[bot.symbol]) {
          symbolStats[bot.symbol] = {
            symbol: bot.symbol,
            total_profit: 0,
            total_trades: 0,
            active_bots: 0,
            total_investment: 0
          };
        }
        
        symbolStats[bot.symbol].total_profit += botProfit;
        symbolStats[bot.symbol].total_trades += botTrades;
        symbolStats[bot.symbol].total_investment += bot.investment_amount;
        if (bot.status === 'active') {
          symbolStats[bot.symbol].active_bots++;
        }
      }

      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
      const avgProfitPerTrade = totalTrades > 0 ? totalProfit / totalTrades : 0;
      const totalInvestment = bots.reduce((sum, bot) => sum + bot.investment_amount, 0);
      const profitPercentage = totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0;

      res.status(200).json({
        success: true,
        data: {
          overall_stats: {
            total_bots: bots.length,
            active_bots: bots.filter(bot => bot.status === 'active').length,
            total_investment: totalInvestment,
            total_profit: totalProfit,
            profit_percentage: profitPercentage,
            total_trades: totalTrades,
            winning_trades: winningTrades,
            losing_trades: totalTrades - winningTrades,
            win_rate: winRate,
            avg_profit_per_trade: avgProfitPerTrade,
            total_volume: totalVolume
          },
          symbol_breakdown: Object.values(symbolStats),
          recent_activity: allFilledOrders.slice(-10).map(order => ({
            symbol: order.symbol,
            side: order.side,
            price: order.filled_price,
            quantity: order.filled_quantity,
            timestamp: order.filled_at
          }))
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve overall statistics'
      });
    }
  }

  // Get engine status (admin endpoint)
  async getEngineStatus(req, res) {
    try {
      const status = gridBotEngine.getEngineStatus();
      
      res.status(200).json({
        success: true,
        data: status
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve engine status'
      });
    }
  }

  // Get market data for a symbol
  async getMarketData(req, res) {
    try {
      const { symbol } = req.params;
      const { interval = '1h', limit = 100 } = req.query;

      // Get current price
      const priceResult = await binanceService.getCurrentPrice(symbol);
      if (!priceResult.success) {
        return res.status(400).json({
          success: false,
          message: `Failed to get price for ${symbol}`
        });
      }

      // Get historical data
      const klinesResult = await binanceService.getKlines(symbol, interval, parseInt(limit));
      if (!klinesResult.success) {
        return res.status(400).json({
          success: false,
          message: `Failed to get historical data for ${symbol}`
        });
      }

      res.status(200).json({
        success: true,
        data: {
          symbol: symbol.toUpperCase(),
          current_price: priceResult.price,
          klines: klinesResult.data,
          timestamp: Date.now()
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve market data'
      });
    }
  }

  // Get detailed trading history with profit/loss analysis
  async getTradingHistory(req, res) {
    try {
      const { botId } = req.params;
      const userId = req.user.userId;
      const { limit = 50, offset = 0, side } = req.query;

      // Verify bot ownership
      const bot = await AIGridBot.findOne({ _id: botId, user_id: userId });
      if (!bot) {
        return res.status(404).json({
          success: false,
          message: 'Bot not found'
        });
      }

      // Build query for filtering
      const query = { bot_id: botId, status: 'FILLED' };
      if (side && ['BUY', 'SELL'].includes(side.toUpperCase())) {
        query.side = side.toUpperCase();
      }

      // Get filled orders with pagination
      const filledOrders = await GridOrder.find(query)
        .sort({ filled_at: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(offset));

      // Get all filled orders for analysis
      const allFilledOrders = await GridOrder.find({ bot_id: botId, status: 'FILLED' })
        .sort({ filled_at: 1 });

      // Analyze trading pairs and calculate profits using proper grid logic
      const tradingPairs = [];
      let totalProfit = 0;
      let totalTrades = 0;
      let winningTrades = 0;
      let losingTrades = 0;

      // Group orders by grid level for proper pairing
      const buyOrdersByLevel = {};
      const sellOrdersByLevel = {};

      // Separate and group orders by grid level
      for (const order of allFilledOrders) {
        if (order.side === 'BUY') {
          if (!buyOrdersByLevel[order.grid_level]) {
            buyOrdersByLevel[order.grid_level] = [];
          }
          buyOrdersByLevel[order.grid_level].push(order);
        } else if (order.side === 'SELL') {
          if (!sellOrdersByLevel[order.grid_level]) {
            sellOrdersByLevel[order.grid_level] = [];
          }
          sellOrdersByLevel[order.grid_level].push(order);
        }
      }

      // Calculate grid spacing from bot parameters
      const gridSpacing = bot.grid_params ? bot.grid_params.grid_spacing : 1.15;

      // Process each grid level to find proper pairs
      for (const level in buyOrdersByLevel) {
        const buyOrders = buyOrdersByLevel[level];
        
        for (const buyOrder of buyOrders) {
          // For each buy order, look for corresponding sell order
          // In grid trading, a buy at level X should create a sell at level X+1 (or same level in some cases)
          
          // Look for sell orders at higher levels first (proper grid behavior)
          let matchedSellOrder = null;
          
          // Check levels above this buy order
          for (let sellLevel = parseInt(level); sellLevel <= parseInt(level) + 5; sellLevel++) {
            if (sellOrdersByLevel[sellLevel] && sellOrdersByLevel[sellLevel].length > 0) {
              // Find the closest sell order in time after this buy order
              const availableSells = sellOrdersByLevel[sellLevel].filter(sell => 
                sell.filled_at > buyOrder.filled_at && !sell.paired
              );
              
              if (availableSells.length > 0) {
                // Take the earliest sell order
                matchedSellOrder = availableSells.sort((a, b) => a.filled_at - b.filled_at)[0];
                break;
              }
            }
          }
          
          // If no sell found at higher levels, check same level
          if (!matchedSellOrder && sellOrdersByLevel[level]) {
            const availableSells = sellOrdersByLevel[level].filter(sell => 
              sell.filled_at > buyOrder.filled_at && !sell.paired
            );
            
            if (availableSells.length > 0) {
              matchedSellOrder = availableSells.sort((a, b) => a.filled_at - b.filled_at)[0];
            }
          }
          
          if (matchedSellOrder) {
            // Mark as paired to avoid double counting
            matchedSellOrder.paired = true;
            
            const profit = (matchedSellOrder.filled_price - buyOrder.filled_price) * buyOrder.filled_quantity;
            const profitPercentage = ((matchedSellOrder.filled_price - buyOrder.filled_price) / buyOrder.filled_price) * 100;
            
            totalProfit += profit;
            totalTrades++;
            
            if (profit > 0) {
              winningTrades++;
            } else {
              losingTrades++;
            }

            tradingPairs.push({
              id: `${buyOrder._id}_${matchedSellOrder._id}`,
              buy_order: {
                id: buyOrder._id,
                price: buyOrder.filled_price,
                quantity: buyOrder.filled_quantity,
                timestamp: buyOrder.filled_at,
                grid_level: buyOrder.grid_level
              },
              sell_order: {
                id: matchedSellOrder._id,
                price: matchedSellOrder.filled_price,
                quantity: matchedSellOrder.filled_quantity,
                timestamp: matchedSellOrder.filled_at,
                grid_level: matchedSellOrder.grid_level
              },
              profit: {
                amount: profit,
                percentage: profitPercentage,
                currency: 'USDT'
              },
              duration: matchedSellOrder.filled_at - buyOrder.filled_at,
              is_profitable: profit > 0,
              grid_spacing_used: matchedSellOrder.filled_price - buyOrder.filled_price
            });
          }
        }
      }

      // Calculate statistics
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
      const avgProfit = totalTrades > 0 ? totalProfit / totalTrades : 0;
      const bestTrade = tradingPairs.length > 0 ? Math.max(...tradingPairs.map(p => p.profit.amount)) : 0;
      const worstTrade = tradingPairs.length > 0 ? Math.min(...tradingPairs.map(p => p.profit.amount)) : 0;

      // Find unpaired orders (orders that haven't been matched)
      const unpairedOrders = allFilledOrders.filter(order => !order.paired);

      res.status(200).json({
        success: true,
        data: {
          bot_info: {
            id: bot._id,
            symbol: bot.symbol,
            status: bot.status,
            investment_amount: bot.investment_amount,
            created_at: bot.created_at,
            grid_spacing: gridSpacing
          },
          trading_summary: {
            total_trades: totalTrades,
            total_profit: totalProfit,
            win_rate: winRate,
            winning_trades: winningTrades,
            losing_trades: losingTrades,
            avg_profit_per_trade: avgProfit,
            best_trade: bestTrade,
            worst_trade: worstTrade,
            total_filled_orders: allFilledOrders.length,
            paired_orders: totalTrades * 2, // Each trade involves 2 orders
            unpaired_orders: unpairedOrders.length
          },
          trading_pairs: tradingPairs.slice(parseInt(offset), parseInt(offset) + parseInt(limit)),
          unpaired_orders: unpairedOrders.map(order => ({
            id: order._id,
            side: order.side,
            price: order.filled_price,
            quantity: order.filled_quantity,
            timestamp: order.filled_at,
            grid_level: order.grid_level,
            reason: order.side === 'BUY' ? 'Waiting for corresponding SELL' : 'No matching BUY found'
          })),
          individual_orders: filledOrders.map(order => ({
            id: order._id,
            side: order.side,
            symbol: order.symbol,
            price: order.filled_price,
            quantity: order.filled_quantity,
            timestamp: order.filled_at,
            grid_level: order.grid_level,
            binance_order_id: order.binance_order_id,
            is_paired: !!order.paired
          })),
          pagination: {
            total_orders: filledOrders.length,
            total_pairs: tradingPairs.length,
            limit: parseInt(limit),
            offset: parseInt(offset)
          }
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve trading history'
      });
    }
  }

  // Diagnostic endpoint to analyze bot order placement
  async getBotDiagnostics(req, res) {
    try {
      const { botId } = req.params;
      const userId = req.user.userId;

      // Verify bot ownership
      const bot = await AIGridBot.findOne({ _id: botId, user_id: userId });
      if (!bot) {
        return res.status(404).json({
          success: false,
          message: 'Bot not found'
        });
      }

      // Get all orders for this bot
      const allOrders = await GridOrder.find({ bot_id: botId }).sort({ created_at: 1 });
      const filledOrders = allOrders.filter(order => order.status === 'FILLED');
      const activeOrders = allOrders.filter(order => ['NEW', 'PARTIALLY_FILLED'].includes(order.status));

      // Analyze grid levels
      const gridLevels = [];
      for (let i = 0; i < bot.grid_params.grid_count; i++) {
        const price = bot.grid_params.lower_price + (i * bot.grid_params.grid_spacing);
        gridLevels.push({
          level: i,
          price: price,
          expected_side: price < bot.grid_params.current_price ? 'BUY' : 'SELL'
        });
      }

      // Analyze order placement
      const orderAnalysis = {
        total_orders: allOrders.length,
        buy_orders: allOrders.filter(o => o.side === 'BUY').length,
        sell_orders: allOrders.filter(o => o.side === 'SELL').length,
        filled_orders: filledOrders.length,
        active_orders: activeOrders.length,
        by_grid_level: {}
      };

      // Group orders by grid level
      for (const order of allOrders) {
        const level = order.grid_level;
        if (!orderAnalysis.by_grid_level[level]) {
          orderAnalysis.by_grid_level[level] = {
            level: level,
            expected_price: bot.grid_params.lower_price + (level * bot.grid_params.grid_spacing),
            orders: []
          };
        }
        orderAnalysis.by_grid_level[level].orders.push({
          id: order._id,
          side: order.side,
          price: order.price,
          status: order.status,
          created_at: order.created_at,
          filled_at: order.filled_at
        });
      }

      // Check for issues
      const issues = [];
      
      // Check if SELL orders exist without corresponding filled BUY orders
      const sellOrders = allOrders.filter(o => o.side === 'SELL');
      if (sellOrders.length > 0) {
        const filledBuyOrders = filledOrders.filter(o => o.side === 'BUY');
        if (filledBuyOrders.length < sellOrders.length) {
          issues.push({
            type: 'SELL_WITHOUT_BUY',
            message: `${sellOrders.length} SELL orders exist but only ${filledBuyOrders.length} BUY orders have been filled`,
            severity: 'HIGH'
          });
        }
      }

      // Check if orders are at correct prices
      for (const order of allOrders) {
        const expectedPrice = bot.grid_params.lower_price + (order.grid_level * bot.grid_params.grid_spacing);
        if (Math.abs(order.price - expectedPrice) > 0.01) {
          issues.push({
            type: 'PRICE_MISMATCH',
            message: `Order ${order._id} at level ${order.grid_level} has price ${order.price} but expected ${expectedPrice}`,
            severity: 'MEDIUM'
          });
        }
      }

      res.status(200).json({
        success: true,
        data: {
          bot_info: {
            id: bot._id,
            symbol: bot.symbol,
            status: bot.status,
            current_price: bot.grid_params.current_price,
            grid_range: `${bot.grid_params.lower_price} - ${bot.grid_params.upper_price}`,
            grid_spacing: bot.grid_params.grid_spacing,
            grid_count: bot.grid_params.grid_count
          },
          grid_levels: gridLevels,
          order_analysis: orderAnalysis,
          issues: issues,
          timeline: allOrders.map(order => ({
            timestamp: order.created_at,
            action: `${order.side} order created`,
            price: order.price,
            level: order.grid_level,
            status: order.status,
            filled_at: order.filled_at
          })).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve bot diagnostics'
      });
    }
  }

  // Reset bot by cancelling all orders and reinitializing
  async resetBot(req, res) {
    try {
      const { botId } = req.params;
      const userId = req.user.userId;

      // Verify bot ownership
      const bot = await AIGridBot.findOne({ _id: botId, user_id: userId });
      if (!bot) {
        return res.status(404).json({
          success: false,
          message: 'Bot not found'
        });
      }

      // Stop the bot first
      const stopResult = await gridBotEngine.stopBot(botId, userId);
      if (!stopResult.success) {
        return res.status(400).json({
          success: false,
          message: `Failed to stop bot: ${stopResult.error}`
        });
      }

      // Cancel all active orders
      const activeOrders = await GridOrder.find({ 
        bot_id: botId, 
        status: { $in: ['NEW', 'PARTIALLY_FILLED'] } 
      });

      let cancelledOrders = 0;
      for (const order of activeOrders) {
        try {
          await binanceService.cancelOrder(bot.symbol, order.binance_order_id);
          order.status = 'CANCELLED';
          await order.save();
          cancelledOrders++;
        } catch (error) {
          // Error cancelling order - continue with others
        }
      }

      // Reset bot status
      bot.status = 'stopped';
      await bot.save();

      res.status(200).json({
        success: true,
        message: `Bot reset successfully. Cancelled ${cancelledOrders} orders.`,
        data: {
          bot_id: botId,
          cancelled_orders: cancelledOrders,
          status: 'stopped'
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to reset bot'
      });
    }
  }

  // Get real-time bot statistics (optimized for frequent polling)
  async getBotRealTimeStats(req, res) {
    try {
      const { botId } = req.params;
      const userId = req.user.userId;

      // Find bot and verify ownership
      const bot = await AIGridBot.findOne({
        _id: botId,
        user_id: userId
      });

      if (!bot) {
        return res.status(404).json({
          success: false,
          message: 'Bot not found'
        });
      }

      // Set test mode for binance service
      binanceService.setTestMode(bot.test_mode);

      // Get current price (try cached first, then REST API)
      let currentPrice;
      try {
        currentPrice = binanceService.getCachedPrice(bot.symbol);
        if (!currentPrice) {
          currentPrice = await binanceService.getCurrentPriceREST(bot.symbol);
        }
      } catch (error) {
        // Error getting current price - use fallback
        currentPrice = bot.grid_params.current_price; // Fallback to last known price
      }

      // Get all orders for this bot
      const [pendingOrders, filledOrders] = await Promise.all([
        GridOrder.find({
          bot_id: botId,
          status: { $in: ['NEW', 'PARTIALLY_FILLED'] }
        }).sort({ grid_level: 1 }),
        GridOrder.find({
          bot_id: botId,
          status: 'FILLED'
        }).sort({ filled_at: -1 })
      ]);

      // Calculate order statistics
      const buyOrders = {
        pending: pendingOrders.filter(order => order.side === 'BUY'),
        filled: filledOrders.filter(order => order.side === 'BUY')
      };

      const sellOrders = {
        pending: pendingOrders.filter(order => order.side === 'SELL'),
        filled: filledOrders.filter(order => order.side === 'SELL')
      };

      // Calculate profit/loss using proper order pairing
      let totalProfit = 0;
      let totalTrades = 0;
      let winningTrades = 0;
      const tradingPairs = [];
      const pairedOrderIds = new Set(); // Track paired orders to avoid double counting

      // Create arrays of buy and sell orders sorted by fill time
      const sortedBuyOrders = [...buyOrders.filled].sort((a, b) => new Date(a.filled_at) - new Date(b.filled_at));
      const sortedSellOrders = [...sellOrders.filled].sort((a, b) => new Date(a.filled_at) - new Date(b.filled_at));

      // Method 1: Try to pair orders by parent_order_id first (for proper grid relationships)
      sellOrders.filled.forEach(sellOrder => {
        if (sellOrder.parent_order_id && !pairedOrderIds.has(sellOrder._id.toString())) {
          const parentBuyOrder = buyOrders.filled.find(buyOrder => 
            buyOrder._id.toString() === sellOrder.parent_order_id.toString() && 
            !pairedOrderIds.has(buyOrder._id.toString())
          );
          
          if (parentBuyOrder) {
            const profit = (sellOrder.filled_price - parentBuyOrder.filled_price) * Math.min(parentBuyOrder.filled_quantity, sellOrder.filled_quantity) 
                         - (parentBuyOrder.commission || 0) - (sellOrder.commission || 0);
            
            totalProfit += profit;
            totalTrades++;
            
            if (profit > 0) {
              winningTrades++;
            }
            
            tradingPairs.push({
              buy_order: {
                id: parentBuyOrder._id,
                price: parentBuyOrder.filled_price,
                quantity: parentBuyOrder.filled_quantity,
                grid_level: parentBuyOrder.grid_level,
                filled_at: parentBuyOrder.filled_at
              },
              sell_order: {
                id: sellOrder._id,
                price: sellOrder.filled_price,
                quantity: sellOrder.filled_quantity,
                grid_level: sellOrder.grid_level,
                filled_at: sellOrder.filled_at
              },
              profit: profit,
              profit_percentage: ((profit / (parentBuyOrder.filled_price * Math.min(parentBuyOrder.filled_quantity, sellOrder.filled_quantity))) * 100),
              pairing_method: 'parent_order'
            });
            
            // Mark both orders as paired
            pairedOrderIds.add(parentBuyOrder._id.toString());
            pairedOrderIds.add(sellOrder._id.toString());
          }
        }
      });

      // Method 2: Pair remaining orders using FIFO (First In, First Out) method
      // This simulates realistic trading where sells are matched with earliest buys
      const unpairedBuyOrders = sortedBuyOrders.filter(order => !pairedOrderIds.has(order._id.toString()));
      const unpairedSellOrders = sortedSellOrders.filter(order => !pairedOrderIds.has(order._id.toString()));

      let buyIndex = 0;
      let sellIndex = 0;

      while (buyIndex < unpairedBuyOrders.length && sellIndex < unpairedSellOrders.length) {
        const buyOrder = unpairedBuyOrders[buyIndex];
        const sellOrder = unpairedSellOrders[sellIndex];
        
        // Only pair if sell price is higher than buy price (profitable)
        if (sellOrder.filled_price > buyOrder.filled_price) {
          const quantity = Math.min(buyOrder.filled_quantity, sellOrder.filled_quantity);
          const profit = (sellOrder.filled_price - buyOrder.filled_price) * quantity 
                       - (buyOrder.commission || 0) - (sellOrder.commission || 0);
          
          totalProfit += profit;
          totalTrades++;
          
          if (profit > 0) {
            winningTrades++;
          }
          
          tradingPairs.push({
            buy_order: {
              id: buyOrder._id,
              price: buyOrder.filled_price,
              quantity: buyOrder.filled_quantity,
              grid_level: buyOrder.grid_level,
              filled_at: buyOrder.filled_at
            },
            sell_order: {
              id: sellOrder._id,
              price: sellOrder.filled_price,
              quantity: sellOrder.filled_quantity,
              grid_level: sellOrder.grid_level,
              filled_at: sellOrder.filled_at
            },
            profit: profit,
            profit_percentage: ((profit / (buyOrder.filled_price * quantity)) * 100),
            pairing_method: 'fifo'
          });
          
          // Mark both orders as paired
          pairedOrderIds.add(buyOrder._id.toString());
          pairedOrderIds.add(sellOrder._id.toString());
        }
        
        // Move to next orders
        buyIndex++;
        sellIndex++;
      }

      // Calculate unrealized P&L for truly unpaired orders only
      let unrealizedPnL = 0;
      const unpairedOrders = [];

      // Check unpaired buy orders (holding positions)
      const trulyUnpairedBuyOrders = buyOrders.filled.filter(order => !pairedOrderIds.has(order._id.toString()));
      trulyUnpairedBuyOrders.forEach(order => {
        const unrealizedProfit = (currentPrice - order.filled_price) * order.filled_quantity - (order.commission || 0);
        unrealizedPnL += unrealizedProfit;
        unpairedOrders.push({
          ...order.toJSON(),
          unrealized_pnl: unrealizedProfit,
          unrealized_pnl_percentage: ((unrealizedProfit / (order.filled_price * order.filled_quantity)) * 100),
          pairing_status: 'unpaired_buy'
        });
      });

      // Check unpaired sell orders (short positions - rare in grid trading)
      const trulyUnpairedSellOrders = sellOrders.filled.filter(order => !pairedOrderIds.has(order._id.toString()));
      trulyUnpairedSellOrders.forEach(order => {
        const unrealizedProfit = (order.filled_price - currentPrice) * order.filled_quantity - (order.commission || 0);
        unrealizedPnL += unrealizedProfit;
        unpairedOrders.push({
          ...order.toJSON(),
          unrealized_pnl: unrealizedProfit,
          unrealized_pnl_percentage: ((unrealizedProfit / (order.filled_price * order.filled_quantity)) * 100),
          pairing_status: 'unpaired_sell'
        });
      });

      // Calculate win rate
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      // Calculate total P&L percentage
      const totalPnLPercentage = ((totalProfit + unrealizedPnL) / bot.investment_amount) * 100;

      // Calculate grid utilization
      const totalGridLevels = bot.grid_params.grid_count;
      const activeGridLevels = new Set([...pendingOrders.map(o => o.grid_level)]).size;
      const gridUtilization = (activeGridLevels / totalGridLevels) * 100;

      // Create price level analysis
      const priceLevels = [];
      const allOrders = [...pendingOrders, ...filledOrders];
      
      // Group orders by price level
      const ordersByPrice = {};
      allOrders.forEach(order => {
        const priceKey = order.price.toString();
        if (!ordersByPrice[priceKey]) {
          ordersByPrice[priceKey] = {
            price: order.price,
            grid_level: order.grid_level,
            buy_orders: { pending: 0, filled: 0, total_quantity: 0 },
            sell_orders: { pending: 0, filled: 0, total_quantity: 0 }
          };
        }
        
        const orderType = order.side.toLowerCase() + '_orders';
        const orderStatus = order.status === 'FILLED' ? 'filled' : 'pending';
        
        ordersByPrice[priceKey][orderType][orderStatus]++;
        ordersByPrice[priceKey][orderType].total_quantity += order.status === 'FILLED' ? 
          order.filled_quantity : order.quantity;
      });

      // Convert to array and sort by price
      Object.values(ordersByPrice).forEach(level => {
        const distance = Math.abs(level.price - currentPrice);
        const distancePercent = (distance / currentPrice) * 100;
        
        priceLevels.push({
          price: level.price,
          grid_level: level.grid_level,
          distance_from_current: distance,
          distance_percent: distancePercent,
          buy_orders: {
            pending: level.buy_orders.pending,
            filled: level.buy_orders.filled,
            total: level.buy_orders.pending + level.buy_orders.filled,
            total_quantity: level.buy_orders.total_quantity
          },
          sell_orders: {
            pending: level.sell_orders.pending,
            filled: level.sell_orders.filled,
            total: level.sell_orders.pending + level.sell_orders.filled,
            total_quantity: level.sell_orders.total_quantity
          },
          total_orders: level.buy_orders.pending + level.buy_orders.filled + 
                       level.sell_orders.pending + level.sell_orders.filled,
          is_above_current: level.price > currentPrice,
          is_below_current: level.price < currentPrice
        });
      });

      // Sort price levels by price (ascending)
      priceLevels.sort((a, b) => a.price - b.price);

      // Create order book style view
      const orderBook = {
        current_price: currentPrice,
        levels_above: priceLevels.filter(level => level.price > currentPrice)
          .sort((a, b) => a.price - b.price) // Closest to current price first
          .slice(0, 10), // Show top 10 levels above
        levels_below: priceLevels.filter(level => level.price < currentPrice)
          .sort((a, b) => b.price - a.price) // Closest to current price first
          .slice(0, 10), // Show top 10 levels below
        nearest_support: priceLevels.filter(level => level.price < currentPrice && level.buy_orders.pending > 0)
          .sort((a, b) => b.price - a.price)[0] || null,
        nearest_resistance: priceLevels.filter(level => level.price > currentPrice && level.sell_orders.pending > 0)
          .sort((a, b) => a.price - b.price)[0] || null
      };

      // Prepare response
      const response = {
        success: true,
        data: {
          bot_info: {
            id: bot._id,
            symbol: bot.symbol,
            status: bot.status,
            test_mode: bot.test_mode,
            investment_amount: bot.investment_amount,
            created_at: bot.created_at,
            updated_at: bot.updated_at
          },
          market_data: {
            current_price: currentPrice,
            price_change_24h: null, // Will be populated if available from WebSocket
            grid_range: {
              upper_price: bot.grid_params.upper_price,
              lower_price: bot.grid_params.lower_price,
              grid_spacing: bot.grid_params.grid_spacing,
              total_levels: bot.grid_params.grid_count
            }
          },
          performance: {
            total_profit: totalProfit,
            unrealized_pnl: unrealizedPnL,
            total_pnl: totalProfit + unrealizedPnL,
            pnl_percentage: totalPnLPercentage,
            total_trades: totalTrades,
            winning_trades: winningTrades,
            losing_trades: totalTrades - winningTrades,
            win_rate: winRate,
            grid_utilization: gridUtilization,
            // Additional debugging info
            pairing_stats: {
              total_buy_orders: buyOrders.filled.length,
              total_sell_orders: sellOrders.filled.length,
              paired_orders: pairedOrderIds.size,
              unpaired_buy_orders: trulyUnpairedBuyOrders.length,
              unpaired_sell_orders: trulyUnpairedSellOrders.length,
              parent_order_pairs: tradingPairs.filter(p => p.pairing_method === 'parent_order').length,
              fifo_pairs: tradingPairs.filter(p => p.pairing_method === 'fifo').length
            }
          },
          orders: {
            pending: {
              total: pendingOrders.length,
              buy_orders: buyOrders.pending.length,
              sell_orders: sellOrders.pending.length,
              details: pendingOrders.map(order => ({
                id: order._id,
                binance_order_id: order.binance_order_id,
                side: order.side,
                price: order.price,
                quantity: order.quantity,
                grid_level: order.grid_level,
                status: order.status,
                created_at: order.created_at
              }))
            },
            filled: {
              total: filledOrders.length,
              buy_orders: buyOrders.filled.length,
              sell_orders: sellOrders.filled.length,
              details: filledOrders.slice(0, 10).map(order => ({ // Limit to last 10 for performance
                id: order._id,
                binance_order_id: order.binance_order_id,
                side: order.side,
                price: order.price,
                filled_price: order.filled_price,
                quantity: order.quantity,
                filled_quantity: order.filled_quantity,
                grid_level: order.grid_level,
                commission: order.commission,
                filled_at: order.filled_at
              }))
            }
          },
          trading_pairs: tradingPairs.slice(0, 10), // Limit to last 10 for performance
          unpaired_orders: unpairedOrders,
          price_levels: priceLevels,
          order_book: orderBook,
          timestamp: new Date().toISOString()
        }
      };

      res.status(200).json(response);

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch bot statistics'
      });
    }
  }

  // Stop all user bots and cancel all open orders
  async stopAllBots(req, res) {
    try {
      const userId = req.user.userId;

      // Get all active bots for the user
      const activeBots = await AIGridBot.find({
        user_id: userId,
        status: 'active'
      });

      if (activeBots.length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No active bots found to stop',
          data: {
            stopped_bots: 0,
            cancelled_orders: 0
          }
        });
      }

      // Stop all bots using grid engine
      const result = await gridBotEngine.stopAllUserBots(userId);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error || 'Failed to stop all bots'
        });
      }

      res.status(200).json({
        success: true,
        message: `Successfully stopped ${result.stopped_bots} bots and cancelled ${result.cancelled_orders} orders`,
        data: {
          stopped_bots: result.stopped_bots,
          cancelled_orders: result.cancelled_orders,
          bot_details: result.bot_details
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to stop all bots'
      });
    }
  }
}

export default new AIGridController();