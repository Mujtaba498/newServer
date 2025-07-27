class TechnicalAnalysis {
  constructor() {
    this.defaultPeriod = 14;
  }

  // Simple Moving Average
  calculateSMA(data, period = 20) {
    if (data.length < period) return null;
    
    const smaData = [];
    for (let i = period - 1; i < data.length; i++) {
      const sum = data.slice(i - period + 1, i + 1).reduce((acc, val) => acc + val, 0);
      smaData.push(sum / period);
    }
    return smaData;
  }

  // Exponential Moving Average
  calculateEMA(data, period = 20) {
    if (data.length < period) return null;
    
    const emaData = [];
    const multiplier = 2 / (period + 1);
    
    // Start with SMA for the first value
    const sma = data.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
    emaData.push(sma);
    
    // Calculate EMA for remaining values
    for (let i = period; i < data.length; i++) {
      const ema = (data[i] - emaData[emaData.length - 1]) * multiplier + emaData[emaData.length - 1];
      emaData.push(ema);
    }
    
    return emaData;
  }

  // Average True Range
  calculateATR(ohlcData, period = 14) {
    if (ohlcData.length < period + 1) return null;
    
    const trueRanges = [];
    
    // Calculate True Range for each period
    for (let i = 1; i < ohlcData.length; i++) {
      const current = ohlcData[i];
      const previous = ohlcData[i - 1];
      
      const tr1 = current.high - current.low;
      const tr2 = Math.abs(current.high - previous.close);
      const tr3 = Math.abs(current.low - previous.close);
      
      trueRanges.push(Math.max(tr1, tr2, tr3));
    }
    
    // Calculate ATR using EMA of True Ranges
    const atrValues = this.calculateEMA(trueRanges, period);
    return atrValues ? atrValues[atrValues.length - 1] : null;
  }

  // Bollinger Bands
  calculateBollingerBands(data, period = 20, stdDevMultiplier = 2) {
    if (data.length < period) return null;
    
    const smaData = this.calculateSMA(data, period);
    if (!smaData) return null;
    
    const bollingerBands = [];
    
    for (let i = 0; i < smaData.length; i++) {
      const dataSlice = data.slice(i, i + period);
      const sma = smaData[i];
      
      // Calculate standard deviation
      const variance = dataSlice.reduce((acc, val) => acc + Math.pow(val - sma, 2), 0) / period;
      const stdDev = Math.sqrt(variance);
      
      bollingerBands.push({
        upper: sma + (stdDev * stdDevMultiplier),
        middle: sma,
        lower: sma - (stdDev * stdDevMultiplier),
        bandwidth: (stdDev * stdDevMultiplier * 2) / sma * 100
      });
    }
    
    return bollingerBands;
  }

  // RSI (Relative Strength Index)
  calculateRSI(data, period = 14) {
    if (data.length < period + 1) return null;
    
    const changes = [];
    for (let i = 1; i < data.length; i++) {
      changes.push(data[i] - data[i - 1]);
    }
    
    const gains = changes.map(change => change > 0 ? change : 0);
    const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);
    
    const avgGains = this.calculateEMA(gains, period);
    const avgLosses = this.calculateEMA(losses, period);
    
    if (!avgGains || !avgLosses) return null;
    
    const rsiData = [];
    for (let i = 0; i < avgGains.length; i++) {
      if (avgLosses[i] === 0) {
        rsiData.push(100);
      } else {
        const rs = avgGains[i] / avgLosses[i];
        const rsi = 100 - (100 / (1 + rs));
        rsiData.push(rsi);
      }
    }
    
    return rsiData;
  }

  // MACD (Moving Average Convergence Divergence)
  calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (data.length < slowPeriod) return null;
    
    const fastEMA = this.calculateEMA(data, fastPeriod);
    const slowEMA = this.calculateEMA(data, slowPeriod);
    
    if (!fastEMA || !slowEMA) return null;
    
    // Calculate MACD line
    const macdLine = [];
    const startIndex = slowPeriod - fastPeriod;
    
    for (let i = startIndex; i < fastEMA.length; i++) {
      macdLine.push(fastEMA[i] - slowEMA[i - startIndex]);
    }
    
    // Calculate signal line
    const signalLine = this.calculateEMA(macdLine, signalPeriod);
    
    if (!signalLine) return null;
    
    // Calculate histogram
    const histogram = [];
    for (let i = 0; i < signalLine.length; i++) {
      const macdIndex = i + (macdLine.length - signalLine.length);
      histogram.push(macdLine[macdIndex] - signalLine[i]);
    }
    
    return {
      macd: macdLine,
      signal: signalLine,
      histogram: histogram
    };
  }

  // Support and Resistance levels
  calculateSupportResistance(ohlcData, period = 20) {
    if (ohlcData.length < period) return null;
    
    const levels = [];
    
    for (let i = period; i < ohlcData.length - period; i++) {
      const slice = ohlcData.slice(i - period, i + period + 1);
      const current = ohlcData[i];
      
      // Check for resistance (local high)
      const isResistance = slice.every(candle => candle.high <= current.high);
      if (isResistance) {
        levels.push({
          type: 'resistance',
          price: current.high,
          index: i,
          strength: this.calculateLevelStrength(ohlcData, current.high, 'resistance')
        });
      }
      
      // Check for support (local low)
      const isSupport = slice.every(candle => candle.low >= current.low);
      if (isSupport) {
        levels.push({
          type: 'support',
          price: current.low,
          index: i,
          strength: this.calculateLevelStrength(ohlcData, current.low, 'support')
        });
      }
    }
    
    return this.filterSignificantLevels(levels);
  }

  // Calculate level strength based on how many times price tested the level
  calculateLevelStrength(ohlcData, price, type) {
    const tolerance = price * 0.002; // 0.2% tolerance
    let strength = 0;
    
    for (const candle of ohlcData) {
      if (type === 'resistance') {
        if (Math.abs(candle.high - price) <= tolerance) strength++;
      } else {
        if (Math.abs(candle.low - price) <= tolerance) strength++;
      }
    }
    
    return strength;
  }

  // Filter significant levels
  filterSignificantLevels(levels) {
    // Sort by strength and remove weak levels
    const filtered = levels.filter(level => level.strength >= 2);
    
    // Remove levels too close to each other
    const finalLevels = [];
    for (const level of filtered) {
      const tooClose = finalLevels.some(existing => 
        Math.abs(existing.price - level.price) / level.price < 0.01 // 1% tolerance
      );
      
      if (!tooClose) {
        finalLevels.push(level);
      }
    }
    
    return finalLevels.sort((a, b) => b.strength - a.strength);
  }

  // Calculate volatility
  calculateVolatility(data, period = 20) {
    if (data.length < period) return null;
    
    const returns = [];
    for (let i = 1; i < data.length; i++) {
      returns.push(Math.log(data[i] / data[i - 1]));
    }
    
    const volatilities = [];
    for (let i = period - 1; i < returns.length; i++) {
      const slice = returns.slice(i - period + 1, i + 1);
      const mean = slice.reduce((acc, val) => acc + val, 0) / period;
      const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
      volatilities.push(Math.sqrt(variance * 252)); // Annualized volatility
    }
    
    return volatilities;
  }

  // Detect market trend
  detectTrend(data, shortPeriod = 10, longPeriod = 30) {
    if (data.length < longPeriod) return null;
    
    const shortEMA = this.calculateEMA(data, shortPeriod);
    const longEMA = this.calculateEMA(data, longPeriod);
    
    if (!shortEMA || !longEMA) return null;
    
    const latestShort = shortEMA[shortEMA.length - 1];
    const latestLong = longEMA[longEMA.length - 1];
    const currentPrice = data[data.length - 1];
    
    // Determine trend direction
    let trend = 'sideways';
    if (latestShort > latestLong && currentPrice > latestShort) {
      trend = 'bullish';
    } else if (latestShort < latestLong && currentPrice < latestShort) {
      trend = 'bearish';
    }
    
    // Calculate trend strength
    const priceDiff = Math.abs(latestShort - latestLong);
    const priceRange = Math.max(...data.slice(-longPeriod)) - Math.min(...data.slice(-longPeriod));
    const trendStrength = (priceDiff / priceRange) * 100;
    
    return {
      direction: trend,
      strength: trendStrength,
      shortEMA: latestShort,
      longEMA: latestLong,
      currentPrice: currentPrice
    };
  }

  // Calculate price percentile
  calculatePricePercentile(data, currentPrice, period = 100) {
    if (data.length < period) return null;
    
    const recentData = data.slice(-period);
    const sorted = [...recentData].sort((a, b) => a - b);
    
    let rank = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] <= currentPrice) rank++;
    }
    
    return (rank / sorted.length) * 100;
  }

  // Calculate market regime (trending vs ranging)
  calculateMarketRegime(ohlcData, period = 20) {
    if (ohlcData.length < period) return null;
    
    const closePrices = ohlcData.map(candle => candle.close);
    const atr = this.calculateATR(ohlcData, period);
    const sma = this.calculateSMA(closePrices, period);
    
    if (!atr || !sma) return null;
    
    const latestSMA = sma[sma.length - 1];
    const currentPrice = closePrices[closePrices.length - 1];
    
    // Calculate ADX-like indicator for trend strength
    const priceDeviations = closePrices.slice(-period).map(price => 
      Math.abs(price - latestSMA) / latestSMA * 100
    );
    
    const avgDeviation = priceDeviations.reduce((acc, val) => acc + val, 0) / period;
    
    // Determine market regime
    let regime = 'ranging';
    if (avgDeviation > 2 && Math.abs(currentPrice - latestSMA) / latestSMA > 0.02) {
      regime = 'trending';
    }
    
    return {
      regime: regime,
      strength: avgDeviation,
      atr: atr,
      sma: latestSMA,
      currentPrice: currentPrice
    };
  }

  // Generate comprehensive market analysis
  generateMarketAnalysis(ohlcData) {
    if (ohlcData.length < 50) {
      throw new Error('Insufficient data for analysis. Need at least 50 candles.');
    }
    
    const closePrices = ohlcData.map(candle => candle.close);
    const currentPrice = closePrices[closePrices.length - 1];
    
    // Calculate all indicators
    const atr = this.calculateATR(ohlcData, 14);
    const bollingerBands = this.calculateBollingerBands(closePrices, 20, 2);
    const rsi = this.calculateRSI(closePrices, 14);
    const macd = this.calculateMACD(closePrices, 12, 26, 9);
    const supportResistance = this.calculateSupportResistance(ohlcData, 20);
    const trend = this.detectTrend(closePrices, 10, 30);
    const volatility = this.calculateVolatility(closePrices, 20);
    const marketRegime = this.calculateMarketRegime(ohlcData, 20);
    const pricePercentile = this.calculatePricePercentile(closePrices, currentPrice, 100);
    
    return {
      symbol: ohlcData[0].symbol || 'UNKNOWN',
      currentPrice: currentPrice,
      atr: atr,
      bollingerBands: bollingerBands ? bollingerBands[bollingerBands.length - 1] : null,
      rsi: rsi ? rsi[rsi.length - 1] : null,
      macd: macd ? {
        macd: macd.macd[macd.macd.length - 1],
        signal: macd.signal[macd.signal.length - 1],
        histogram: macd.histogram[macd.histogram.length - 1]
      } : null,
      supportResistance: supportResistance,
      trend: trend,
      volatility: volatility ? volatility[volatility.length - 1] : null,
      marketRegime: marketRegime,
      pricePercentile: pricePercentile,
      timestamp: Date.now()
    };
  }
}

export default new TechnicalAnalysis();