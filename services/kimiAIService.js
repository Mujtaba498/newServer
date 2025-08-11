const axios = require('axios');
const BinanceService = require('./binanceService');

class KimiAIService {
  constructor() {
    this.apiKey = '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';
    this.baseURL = 'https://openrouter.ai/api/v1/chat/completions';
    this.binanceService = new BinanceService();
  }

  async analyzeGridBotParameters(symbol, investmentAmount) {
    try {
      // Get current market data
      const currentPrice = await this.binanceService.getSymbolPrice(symbol);
      const symbolInfo = await this.binanceService.getSymbolInfo(symbol);
      
      // Get 24h price change data for volatility analysis
      const marketData = await this.getMarketAnalysisData(symbol);
      
      const prompt = this.createAnalysisPrompt(symbol, currentPrice, investmentAmount, marketData);
      
      const response = await axios.post(this.baseURL, {
        model: "moonshotai/kimi-k2:free",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3, // Lower temperature for more consistent results
        max_tokens: 1000
      }, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://aibot-crypto.com",
          "X-Title": "AI Grid Bot Crypto",
          "Content-Type": "application/json"
        }
      });

      const aiResponse = response.data.choices[0].message.content;
      return this.parseAIResponse(aiResponse, currentPrice, symbolInfo);
      
    } catch (error) {
      console.error('Error analyzing grid bot parameters with Kimi AI:', error.message);
      // Fallback to default parameters if AI fails
      return this.getDefaultParameters(symbol, investmentAmount);
    }
  }

  createAnalysisPrompt(symbol, currentPrice, investmentAmount, marketData) {
    return `You are an expert cryptocurrency grid trading bot analyst. Analyze the following trading pair and provide optimal grid trading parameters.

TRADING PAIR: ${symbol}
CURRENT PRICE: $${currentPrice}
INVESTMENT AMOUNT: $${investmentAmount}
MARKET DATA: ${JSON.stringify(marketData, null, 2)}

Based on the current market conditions, volatility, and trading patterns, please provide the following grid trading parameters:

1. UPPER_PRICE: The optimal upper boundary for the grid (should be above current price)
2. LOWER_PRICE: The optimal lower boundary for the grid (should be below current price)
3. GRID_LEVELS: Number of grid levels (between 5-50, based on volatility)
4. PROFIT_PER_GRID: Profit percentage per grid level (0.5% - 5%, based on volatility)

Considerations:
- Higher volatility = more grid levels with smaller profit margins
- Lower volatility = fewer grid levels with larger profit margins
- Price range should capture 80% of recent price movements
- Grid levels should be optimized for the investment amount
- Consider support and resistance levels
- Factor in trading fees (0.1% per trade)

Please respond ONLY in the following JSON format (no additional text):
{
  "upperPrice": number,
  "lowerPrice": number,
  "gridLevels": integer,
  "profitPerGrid": number,
  "reasoning": "Brief explanation of the strategy"
}
`;
  }

  async getMarketAnalysisData(symbol) {
    try {
      // Get 24h ticker data for volatility analysis
      const response = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
      const data = response.data;
      
      return {
        priceChange24h: parseFloat(data.priceChange),
        priceChangePercent24h: parseFloat(data.priceChangePercent),
        highPrice24h: parseFloat(data.highPrice),
        lowPrice24h: parseFloat(data.lowPrice),
        volume24h: parseFloat(data.volume),
        count: parseInt(data.count), // Number of trades
        volatility: Math.abs(parseFloat(data.priceChangePercent))
      };
    } catch (error) {
      console.error('Error fetching market analysis data:', error.message);
      return {
        priceChange24h: 0,
        priceChangePercent24h: 0,
        highPrice24h: 0,
        lowPrice24h: 0,
        volume24h: 0,
        count: 0,
        volatility: 2 // Default volatility
      };
    }
  }

  parseAIResponse(aiResponse, currentPrice, symbolInfo) {
    try {
      // Extract JSON from AI response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate and sanitize the response
      const upperPrice = this.validatePrice(parsed.upperPrice, currentPrice, symbolInfo, 'upper');
      const lowerPrice = this.validatePrice(parsed.lowerPrice, currentPrice, symbolInfo, 'lower');
      const gridLevels = this.validateGridLevels(parsed.gridLevels);
      const profitPerGrid = this.validateProfitPerGrid(parsed.profitPerGrid);
      
      // Ensure upper > lower
      if (upperPrice <= lowerPrice) {
        throw new Error('Invalid price range: upper price must be greater than lower price');
      }
      
      return {
        upperPrice,
        lowerPrice,
        gridLevels,
        profitPerGrid,
        reasoning: parsed.reasoning || 'AI-generated parameters based on market analysis',
        aiGenerated: true
      };
      
    } catch (error) {
      console.error('Error parsing AI response:', error.message);
      console.log('AI Response:', aiResponse);
      throw new Error('Failed to parse AI response');
    }
  }

  validatePrice(price, currentPrice, symbolInfo, type) {
    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice <= 0) {
      throw new Error(`Invalid ${type} price: ${price}`);
    }
    
    // Round to symbol precision
    const precision = symbolInfo.pricePrecision || 8;
    const rounded = Math.round(numPrice * Math.pow(10, precision)) / Math.pow(10, precision);
    
    // Validate reasonable range (within 50% of current price)
    const maxDeviation = currentPrice * 0.5;
    if (type === 'upper' && (rounded < currentPrice || rounded > currentPrice + maxDeviation)) {
      throw new Error(`Upper price ${rounded} is outside reasonable range`);
    }
    if (type === 'lower' && (rounded > currentPrice || rounded < currentPrice - maxDeviation)) {
      throw new Error(`Lower price ${rounded} is outside reasonable range`);
    }
    
    return rounded;
  }

  validateGridLevels(gridLevels) {
    const levels = parseInt(gridLevels);
    if (isNaN(levels) || levels < 5 || levels > 50) {
      return 10; // Default to 10 levels
    }
    return levels;
  }

  validateProfitPerGrid(profitPerGrid) {
    const profit = parseFloat(profitPerGrid);
    if (isNaN(profit) || profit < 0.5 || profit > 5) {
      return 1.5; // Default to 1.5%
    }
    return profit;
  }

  async getDefaultParameters(symbol, investmentAmount) {
    try {
      const currentPrice = await this.binanceService.getSymbolPrice(symbol);
      const symbolInfo = await this.binanceService.getSymbolInfo(symbol);
      
      // Conservative default parameters
      const priceRange = currentPrice * 0.2; // 20% range
      const upperPrice = currentPrice + priceRange;
      const lowerPrice = currentPrice - priceRange;
      
      return {
        upperPrice: Math.round(upperPrice * Math.pow(10, symbolInfo.pricePrecision || 8)) / Math.pow(10, symbolInfo.pricePrecision || 8),
        lowerPrice: Math.round(lowerPrice * Math.pow(10, symbolInfo.pricePrecision || 8)) / Math.pow(10, symbolInfo.pricePrecision || 8),
        gridLevels: 10,
        profitPerGrid: 1.5,
        reasoning: 'Default conservative parameters (AI analysis failed)',
        aiGenerated: false
      };
    } catch (error) {
      throw new Error('Failed to generate default parameters');
    }
  }
}

module.exports = KimiAIService;
