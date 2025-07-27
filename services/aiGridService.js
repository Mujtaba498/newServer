import binanceService from './binanceService.js';
import technicalAnalysis from './technicalAnalysis.js';

class AIGridService {
  constructor() {
    this.minGridCount = 10;
    this.maxGridCount = 50;
    this.minInvestment = 10;
    this.maxInvestment = 100000;
    this.riskMultiplier = 2; // ATR multiplier for price range
    this.stopLossMultiplier = 1.5; // ATR multiplier for stop loss
  }

  // Generate AI parameters for grid trading
  async generateAIParameters(symbol, investmentAmount, isTestMode = true) {
    try {
      // Validate inputs
      if (!symbol || !investmentAmount) {
        throw new Error('Symbol and investment amount are required');
      }

      if (investmentAmount < this.minInvestment || investmentAmount > this.maxInvestment) {
        throw new Error(`Investment amount must be between ${this.minInvestment} and ${this.maxInvestment}`);
      }

      // Set test mode for AI parameter generation
      binanceService.setTestMode(isTestMode);

      // Get symbol information
      const symbolInfo = await binanceService.getSymbolInfo(symbol);
      if (!symbolInfo.success) {
        throw new Error(`Invalid symbol: ${symbol}`);
      }

      // Get current price
      const currentPriceData = await binanceService.getCurrentPrice(symbol);
      if (!currentPriceData.success) {
        throw new Error('Failed to get current price');
      }

      const currentPrice = currentPriceData.price;

      // Get historical data for technical analysis
      const klinesData = await binanceService.getKlines(symbol, '1h', 200);
      if (!klinesData.success) {
        throw new Error('Failed to get historical data');
      }

      // Generate market analysis
      const marketAnalysis = technicalAnalysis.generateMarketAnalysis(klinesData.data);

      // Generate grid parameters using AI logic
      const gridParams = this.calculateGridParameters(
        marketAnalysis,
        currentPrice,
        investmentAmount,
        symbolInfo
      );

      // Validate generated parameters
      const validation = this.validateGridParameters(gridParams, symbolInfo);
      if (!validation.isValid) {
        throw new Error(`Invalid grid parameters: ${validation.errors.join(', ')}`);
      }

      return {
        success: true,
        parameters: {
          symbol: symbol.toUpperCase(),
          investment_amount: investmentAmount,
          current_price: currentPrice,
          grid_params: gridParams,
          market_analysis: marketAnalysis,
          symbol_info: symbolInfo,
          risk_assessment: this.calculateRiskAssessment(marketAnalysis, gridParams),
          expected_performance: this.calculateExpectedPerformance(marketAnalysis, gridParams)
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Calculate grid parameters based on technical analysis
  calculateGridParameters(marketAnalysis, currentPrice, investmentAmount, symbolInfo) {
    const { atr, bollingerBands, trend, volatility, marketRegime } = marketAnalysis;

    // Calculate price range based on ATR and market conditions
    let priceRange = this.calculatePriceRange(currentPrice, atr, trend, marketRegime);

    // Adjust range based on Bollinger Bands
    if (bollingerBands) {
      const bbRange = bollingerBands.upper - bollingerBands.lower;
      priceRange = Math.max(priceRange, bbRange);
    }

    // Calculate upper and lower bounds
    const upperPrice = currentPrice + (priceRange / 2);
    const lowerPrice = currentPrice - (priceRange / 2);

    // Calculate optimal grid count based on volatility and ATR
    const gridCount = this.calculateOptimalGridCount(atr, priceRange, volatility);

    // Calculate grid spacing
    const gridSpacing = priceRange / gridCount;

    // Calculate order size based on investment amount and grid count
    const orderSize = this.calculateOrderSize(investmentAmount, gridCount, currentPrice);

    // Calculate stop loss price
    const stopLossPrice = lowerPrice - (atr * this.stopLossMultiplier);

    // Format prices according to symbol precision
    return {
      upper_price: binanceService.formatPrice(upperPrice, symbolInfo.tickSize),
      lower_price: binanceService.formatPrice(lowerPrice, symbolInfo.tickSize),
      grid_count: gridCount,
      grid_spacing: binanceService.formatPrice(gridSpacing, symbolInfo.tickSize),
      order_size: binanceService.formatQuantity(orderSize, symbolInfo.stepSize),
      current_price: binanceService.formatPrice(currentPrice, symbolInfo.tickSize),
      atr_value: binanceService.formatPrice(atr, symbolInfo.tickSize),
      stop_loss_price: binanceService.formatPrice(stopLossPrice, symbolInfo.tickSize),
      price_range: binanceService.formatPrice(priceRange, symbolInfo.tickSize)
    };
  }

  // Calculate price range based on market conditions
  calculatePriceRange(currentPrice, atr, trend, marketRegime) {
    let baseRange = atr * this.riskMultiplier;

    // Adjust based on trend strength
    if (trend && trend.strength > 20) {
      baseRange *= 1.5; // Increase range for strong trends
    }

    // Adjust based on market regime
    if (marketRegime && marketRegime.regime === 'ranging') {
      baseRange *= 0.8; // Decrease range for ranging markets
    } else if (marketRegime && marketRegime.regime === 'trending') {
      baseRange *= 1.2; // Increase range for trending markets
    }

    // Ensure minimum range (2% of current price)
    const minRange = currentPrice * 0.02;
    baseRange = Math.max(baseRange, minRange);

    // Ensure maximum range (15% of current price)
    const maxRange = currentPrice * 0.15;
    baseRange = Math.min(baseRange, maxRange);

    return baseRange;
  }

  // Calculate optimal grid count
  calculateOptimalGridCount(atr, priceRange, volatility) {
    // Base grid count on ATR
    let gridCount = Math.floor(priceRange / atr);

    // Adjust based on volatility
    if (volatility > 0.5) {
      gridCount = Math.floor(gridCount * 1.2); // More grids for high volatility
    } else if (volatility < 0.2) {
      gridCount = Math.floor(gridCount * 0.8); // Fewer grids for low volatility
    }

    // Ensure within bounds
    gridCount = Math.max(this.minGridCount, Math.min(this.maxGridCount, gridCount));

    return gridCount;
  }

  // Calculate order size per grid level
  calculateOrderSize(investmentAmount, gridCount, currentPrice) {
    // Use 95% of investment amount for grid orders (5% kept as buffer)
    const usableAmount = investmentAmount * 0.95;
    
    // For now, we're placing only BUY orders below current price
    // Calculate how many BUY orders we expect (roughly half of grid)
    const buyOrderCount = Math.ceil(gridCount / 2);
    
    // Use the full usable amount for BUY orders to maximize investment utilization
    const orderValueInQuote = usableAmount / buyOrderCount;
    
    // Convert to base currency quantity
    const orderSize = orderValueInQuote / currentPrice;
    
    return orderSize;
  }

  // Calculate risk assessment
  calculateRiskAssessment(marketAnalysis, gridParams) {
    const { trend, volatility, marketRegime, rsi } = marketAnalysis;
    
    let riskScore = 5; // Medium risk by default (1-10 scale)
    let riskFactors = [];

    // Trend risk
    if (trend && trend.direction === 'bearish' && trend.strength > 30) {
      riskScore += 2;
      riskFactors.push('Strong bearish trend detected');
    } else if (trend && trend.direction === 'bullish' && trend.strength > 30) {
      riskScore -= 1;
      riskFactors.push('Strong bullish trend detected');
    }

    // Volatility risk
    if (volatility > 0.6) {
      riskScore += 2;
      riskFactors.push('High volatility detected');
    } else if (volatility < 0.2) {
      riskScore -= 1;
      riskFactors.push('Low volatility environment');
    }

    // Market regime risk
    if (marketRegime && marketRegime.regime === 'ranging') {
      riskScore -= 1;
      riskFactors.push('Ranging market - favorable for grid trading');
    } else if (marketRegime && marketRegime.regime === 'trending') {
      riskScore += 1;
      riskFactors.push('Trending market - increased risk');
    }

    // RSI risk
    if (rsi > 70) {
      riskScore += 1;
      riskFactors.push('Overbought conditions (RSI > 70)');
    } else if (rsi < 30) {
      riskScore += 1;
      riskFactors.push('Oversold conditions (RSI < 30)');
    }

    // Grid range risk
    const priceRangePercent = (gridParams.price_range / gridParams.current_price) * 100;
    if (priceRangePercent > 10) {
      riskScore += 1;
      riskFactors.push('Wide price range detected');
    }

    // Ensure risk score is within bounds
    riskScore = Math.max(1, Math.min(10, riskScore));

    return {
      risk_score: riskScore,
      risk_level: this.getRiskLevel(riskScore),
      risk_factors: riskFactors,
      max_loss_percentage: this.calculateMaxLossPercentage(gridParams),
      recommended_actions: this.getRecommendedActions(riskScore, marketAnalysis)
    };
  }

  // Get risk level description
  getRiskLevel(riskScore) {
    if (riskScore <= 3) return 'Low';
    if (riskScore <= 6) return 'Medium';
    if (riskScore <= 8) return 'High';
    return 'Very High';
  }

  // Calculate maximum potential loss percentage
  calculateMaxLossPercentage(gridParams) {
    const stopLossDistance = gridParams.current_price - gridParams.stop_loss_price;
    return (stopLossDistance / gridParams.current_price) * 100;
  }

  // Get recommended actions based on risk assessment
  getRecommendedActions(riskScore, marketAnalysis) {
    const actions = [];

    if (riskScore >= 8) {
      actions.push('Consider reducing investment amount');
      actions.push('Monitor closely for the first few hours');
    }

    if (marketAnalysis.trend && marketAnalysis.trend.direction === 'bearish') {
      actions.push('Consider waiting for more favorable market conditions');
    }

    if (marketAnalysis.volatility > 0.6) {
      actions.push('Consider using smaller position sizes');
    }

    if (marketAnalysis.rsi > 70) {
      actions.push('Market may be overbought - consider waiting');
    }

    return actions;
  }

  // Calculate expected performance
  calculateExpectedPerformance(marketAnalysis, gridParams) {
    const { volatility, marketRegime } = marketAnalysis;
    
    // Base profit per grid cycle (conservative estimate)
    const baseProfitPerCycle = 0.002; // 0.2%
    
    // Adjust based on market conditions
    let adjustedProfitPerCycle = baseProfitPerCycle;
    
    if (marketRegime && marketRegime.regime === 'ranging') {
      adjustedProfitPerCycle *= 1.5; // Better for ranging markets
    }
    
    if (volatility > 0.4) {
      adjustedProfitPerCycle *= 1.3; // More opportunities in volatile markets
    }
    
    // Calculate expected cycles per day (conservative estimate)
    const expectedCyclesPerDay = Math.min(volatility * 20, 10);
    
    // Calculate expected daily profit
    const expectedDailyProfitPercentage = adjustedProfitPerCycle * expectedCyclesPerDay * 100;
    
    return {
      expected_daily_profit_percentage: Number(expectedDailyProfitPercentage.toFixed(4)),
      expected_monthly_profit_percentage: Number((expectedDailyProfitPercentage * 30).toFixed(4)),
      expected_cycles_per_day: Number(expectedCyclesPerDay.toFixed(2)),
      profit_per_cycle_percentage: Number((adjustedProfitPerCycle * 100).toFixed(4)),
      market_suitability: this.getMarketSuitability(marketAnalysis),
      confidence_level: this.calculateConfidenceLevel(marketAnalysis)
    };
  }

  // Get market suitability score
  getMarketSuitability(marketAnalysis) {
    const { marketRegime, volatility, trend } = marketAnalysis;
    
    let suitabilityScore = 5; // Base score
    
    // Market regime
    if (marketRegime && marketRegime.regime === 'ranging') {
      suitabilityScore += 3;
    } else if (marketRegime && marketRegime.regime === 'trending') {
      suitabilityScore -= 1;
    }
    
    // Volatility
    if (volatility >= 0.2 && volatility <= 0.6) {
      suitabilityScore += 2; // Optimal volatility range
    } else if (volatility > 0.6) {
      suitabilityScore -= 1; // Too volatile
    } else {
      suitabilityScore -= 2; // Too low volatility
    }
    
    // Trend
    if (trend && trend.strength < 20) {
      suitabilityScore += 1; // Weak trend is good for grid
    } else if (trend && trend.strength > 40) {
      suitabilityScore -= 2; // Strong trend is bad for grid
    }
    
    suitabilityScore = Math.max(1, Math.min(10, suitabilityScore));
    
    return {
      score: suitabilityScore,
      level: suitabilityScore >= 7 ? 'High' : suitabilityScore >= 5 ? 'Medium' : 'Low',
      reasoning: this.getSuitabilityReasoning(marketAnalysis)
    };
  }

  // Get suitability reasoning
  getSuitabilityReasoning(marketAnalysis) {
    const reasons = [];
    
    if (marketAnalysis.marketRegime && marketAnalysis.marketRegime.regime === 'ranging') {
      reasons.push('Market is in ranging mode - ideal for grid trading');
    }
    
    if (marketAnalysis.volatility >= 0.2 && marketAnalysis.volatility <= 0.6) {
      reasons.push('Moderate volatility provides good trading opportunities');
    }
    
    if (marketAnalysis.trend && marketAnalysis.trend.strength < 20) {
      reasons.push('Weak trend allows for bidirectional trading');
    }
    
    return reasons;
  }

  // Calculate confidence level
  calculateConfidenceLevel(marketAnalysis) {
    const { atr, volatility, marketRegime } = marketAnalysis;
    
    let confidenceScore = 5;
    
    // ATR consistency
    if (atr > 0) {
      confidenceScore += 1;
    }
    
    // Volatility stability
    if (volatility >= 0.2 && volatility <= 0.5) {
      confidenceScore += 2;
    }
    
    // Market regime clarity
    if (marketRegime && marketRegime.strength > 1) {
      confidenceScore += 1;
    }
    
    confidenceScore = Math.max(1, Math.min(10, confidenceScore));
    
    return {
      score: confidenceScore,
      level: confidenceScore >= 7 ? 'High' : confidenceScore >= 5 ? 'Medium' : 'Low'
    };
  }

  // Validate grid parameters
  validateGridParameters(gridParams, symbolInfo) {
    const errors = [];
    
    // Check if prices are within valid range
    if (gridParams.upper_price <= gridParams.lower_price) {
      errors.push('Upper price must be greater than lower price');
    }
    
    // Check grid count
    if (gridParams.grid_count < this.minGridCount || gridParams.grid_count > this.maxGridCount) {
      errors.push(`Grid count must be between ${this.minGridCount} and ${this.maxGridCount}`);
    }
    
    // Check order size
    if (gridParams.order_size < symbolInfo.minQty) {
      errors.push(`Order size ${gridParams.order_size} is below minimum ${symbolInfo.minQty}`);
    }
    
    // Check price precision
    const pricePrecision = symbolInfo.tickSize.toString().split('.')[1]?.length || 0;
    if (gridParams.grid_spacing.toString().split('.')[1]?.length > pricePrecision) {
      errors.push('Grid spacing exceeds price precision');
    }
    
    // Check minimum notional
    const notional = gridParams.order_size * gridParams.current_price;
    if (notional < symbolInfo.minNotional) {
      errors.push(`Order notional ${notional} is below minimum ${symbolInfo.minNotional}`);
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }

  // Get available trading symbols
  async getAvailableSymbols() {
    try {
      const client = binanceService.getClient();
      if (!client) {
        throw new Error('Binance client not initialized');
      }

      const exchangeInfo = await client.exchangeInfo();
      const symbols = exchangeInfo.symbols
        .filter(symbol => 
          symbol.status === 'TRADING' && 
          symbol.symbol.endsWith('USDT') &&
          !symbol.symbol.includes('UP') &&
          !symbol.symbol.includes('DOWN') &&
          !symbol.symbol.includes('BEAR') &&
          !symbol.symbol.includes('BULL')
        )
        .map(symbol => ({
          symbol: symbol.symbol,
          baseAsset: symbol.baseAsset,
          quoteAsset: symbol.quoteAsset
        }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol));

      return {
        success: true,
        symbols: symbols // Return all available symbols
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default new AIGridService();