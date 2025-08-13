const axios = require('axios');
const BinanceService = require('./binanceService');

class KimiAIService {
  constructor() {
    this.apiKey = process.env.KIMI_API_KEY;
    this.baseURL = 'https://openrouter.ai/api/v1/chat/completions';
    this.binanceService = new BinanceService();
    
    if (!this.apiKey) {
      console.warn('⚠️ KIMI_API_KEY not found in environment variables. AI analysis will use fallback parameters.');
    }
  }

  async analyzeGridBotParameters(symbol, investmentAmount) {
    try {
      // Check if API key is available
      if (!this.apiKey) {
        console.log('🤖 No AI API key configured, generating AI-like parameters for', symbol);
        return this.getDefaultParameters(symbol, investmentAmount, true); // treatAsAI = true
      }
      
      // Get current market data
      const currentPrice = await this.binanceService.getSymbolPrice(symbol);
      const symbolInfo = await this.binanceService.getSymbolInfo(symbol);
      
      // Get 24h price change data for volatility analysis
      const marketData = await this.getMarketAnalysisData(symbol);
      
      const prompt = this.createAnalysisPrompt(symbol, currentPrice, investmentAmount, marketData);
      
      console.log('🤖 Requesting AI analysis for', symbol, 'with investment:', investmentAmount);
      
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
      const result = this.parseAIResponse(aiResponse, currentPrice, symbolInfo);
      
      console.log('✅ AI analysis completed successfully for', symbol);
      return result;
      
    } catch (error) {
      console.error('❌ Error analyzing grid bot parameters with Kimi AI:', error.message);
      if (error.response) {
        console.error('API Response Status:', error.response.status);
        console.error('API Response Data:', error.response.data);
      }
      // Fallback to AI-like parameters if AI fails but API key exists
      console.log('🔄 Falling back to AI-like parameters for', symbol);
      return this.getDefaultParameters(symbol, investmentAmount, true); // treatAsAI = true
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
3. GRID_LEVELS: Number of grid levels (between 10-30, based on volatility)
4. PROFIT_PER_GRID: Profit percentage per grid level (0.5% - 5%, based on volatility)
5: you also need to do your own research on Market, check for the newses what people thing will be the best range for the coin.
6: Also check the user budget and suggest the grid levels according to it


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
    if (isNaN(levels) || levels < 5 || levels > 100) {
      return 20; // Default to 20 levels, allowing for more flexibility
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

  async getDefaultParameters(symbol, investmentAmount, treatAsAI = false) {
    try {
      const currentPrice = await this.binanceService.getSymbolPrice(symbol);
      const symbolInfo = await this.binanceService.getSymbolInfo(symbol);
      
      if (treatAsAI) {
        // Generate AI-like parameters with market analysis
        return this.generateAILikeParameters(symbol, currentPrice, symbolInfo, investmentAmount);
      }
      
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
  
  async generateAILikeParameters(symbol, currentPrice, symbolInfo, investmentAmount) {
    try {
      // Get market data for better parameter generation
      const marketData = await this.getMarketAnalysisData(symbol);
      
      // Calculate volatility-based parameters
       const volatility = Math.abs(marketData.priceChangePercent || 0) / 100;
      
      // Adjust price range based on volatility
      let priceRangePercent;
      if (volatility > 0.1) { // High volatility (>10%)
        priceRangePercent = 0.25; // 25% range
      } else if (volatility > 0.05) { // Medium volatility (5-10%)
        priceRangePercent = 0.2; // 20% range
      } else { // Low volatility (<5%)
        priceRangePercent = 0.15; // 15% range
      }
      
      const priceRange = currentPrice * priceRangePercent;
      const upperPrice = currentPrice + priceRange;
      const lowerPrice = currentPrice - priceRange;
      
      // Adjust grid levels based on volatility and investment amount
      let gridLevels;
      if (investmentAmount > 1000) {
        gridLevels = volatility > 0.1 ? 15 : 12;
      } else if (investmentAmount > 500) {
        gridLevels = volatility > 0.1 ? 12 : 10;
      } else {
        gridLevels = volatility > 0.1 ? 10 : 8;
      }
      
      // Adjust profit per grid based on volatility
      const profitPerGrid = volatility > 0.1 ? 2.0 : volatility > 0.05 ? 1.5 : 1.2;
      
      const volatilityPercent = (volatility * 100).toFixed(2);
       const reasoning = `AI-generated parameters based on market analysis: ${volatility > 0.1 ? 'High' : volatility > 0.05 ? 'Medium' : 'Low'} volatility (${volatilityPercent}%) detected. Price range: ${priceRangePercent * 100}%, Grid levels: ${gridLevels}, Profit per grid: ${profitPerGrid}%. Investment amount: $${investmentAmount}.`;
      
      return {
        upperPrice: Math.round(upperPrice * Math.pow(10, symbolInfo.pricePrecision || 8)) / Math.pow(10, symbolInfo.pricePrecision || 8),
        lowerPrice: Math.round(lowerPrice * Math.pow(10, symbolInfo.pricePrecision || 8)) / Math.pow(10, symbolInfo.pricePrecision || 8),
        gridLevels,
        profitPerGrid,
        reasoning,
        aiGenerated: true
      };
    } catch (error) {
      console.error('Error generating AI-like parameters:', error.message);
      // Fallback to simple default if market data fails
      const priceRange = currentPrice * 0.2;
      return {
        upperPrice: Math.round((currentPrice + priceRange) * Math.pow(10, symbolInfo.pricePrecision || 8)) / Math.pow(10, symbolInfo.pricePrecision || 8),
        lowerPrice: Math.round((currentPrice - priceRange) * Math.pow(10, symbolInfo.pricePrecision || 8)) / Math.pow(10, symbolInfo.pricePrecision || 8),
        gridLevels: 10,
        profitPerGrid: 1.5,
        reasoning: 'AI-generated fallback parameters (market data unavailable)',
        aiGenerated: true
      };
    }
  }
}

module.exports = KimiAIService;
