# Grid Trading Bot for Binance

A sophisticated grid trading bot that automatically executes buy and sell orders at predetermined price levels on Binance spot markets to profit from market volatility.

## 🤖 How Grid Trading Works

### Basic Concept
Grid trading is a quantitative trading strategy that places a series of buy and sell orders at regular intervals around a set price range. The bot profits from market volatility by:

1. **Setting up a price grid**: Define upper and lower price boundaries
2. **Placing initial orders**: Buy orders below current price, sell orders above
3. **Automatic rebalancing**: When an order fills, place an opposite order to capture profit
4. **Continuous operation**: Repeat the process as long as price stays within the grid

### Example Scenario
```
Symbol: BTCUSDT
Current Price: $45,000
Grid Range: $40,000 - $50,000
Grid Levels: 10
Investment: $1,000
Profit per Grid: 1%

Grid Levels:
$50,000 (SELL) ←
$48,889 (SELL) ←
$47,778 (SELL) ←
$46,667 (SELL) ←
$45,556 (SELL) ←
$45,000 (Current Price)
$44,444 (BUY) ←
$43,333 (BUY) ←
$42,222 (BUY) ←
$41,111 (BUY) ←
$40,000 (BUY) ←
```

### Profit Mechanism
- When price drops to $44,444, bot buys
- When price rises back to $44,888 (44,444 + 1%), bot sells
- Profit = 1% per completed grid cycle
- Process repeats automatically

## 🚀 Features

### Core Functionality
- ✅ **Automated Grid Trading**: Set and forget trading strategy
- ✅ **Binance Integration**: Direct connection to Binance spot trading
- ✅ **Risk Management**: Configurable price ranges and investment amounts
- ✅ **Real-time Monitoring**: Continuous order monitoring and management
- ✅ **Performance Tracking**: Detailed statistics and profit tracking
- ✅ **Multiple Bots**: Run multiple grid bots simultaneously

### Safety Features
- ✅ **Rate Limiting**: Prevents API abuse and account restrictions
- ✅ **Error Handling**: Robust error handling and recovery
- ✅ **Order Validation**: Validates all orders before placement
- ✅ **Balance Checking**: Ensures sufficient funds before trading
- ✅ **Price Validation**: Confirms prices are within acceptable ranges

## 📋 API Endpoints

### Authentication Required
All grid bot endpoints require JWT authentication via `Authorization: Bearer <token>` header.

### Grid Bot Management

#### Create Grid Bot
```bash
POST /api/grid-bots
Content-Type: application/json

{
  "name": "BTC Grid Bot",
  "symbol": "BTCUSDT",
  "upperPrice": 50000,
  "lowerPrice": 40000,
  "gridLevels": 10,
  "investmentAmount": 1000,
  "profitPerGrid": 1.0
}
```

#### Get All User's Grid Bots
```bash
GET /api/grid-bots
GET /api/grid-bots?status=active
GET /api/grid-bots?symbol=BTCUSDT
```

#### Get Specific Grid Bot
```bash
GET /api/grid-bots/:botId
```

#### Start Grid Bot
```bash
POST /api/grid-bots/:botId/start
```

#### Stop Grid Bot
```bash
POST /api/grid-bots/:botId/stop
```

#### Pause Grid Bot
```bash
POST /api/grid-bots/:botId/pause
```

#### Delete Grid Bot
```bash
DELETE /api/grid-bots/:botId
```

### Performance & Analytics

#### Get Bot Performance
```bash
GET /api/grid-bots/:botId/performance
```

#### Get Market Data
```bash
GET /api/grid-bots/market/:symbol
```

#### Get Account Balance
```bash
GET /api/grid-bots/account/balance
```

## 🔧 Configuration

### Environment Variables
Add these to your `.env` file:

```env
# Binance API Configuration
BINANCE_API_KEY=your-binance-api-key-here
BINANCE_SECRET_KEY=your-binance-secret-key-here
```

### Binance API Setup
1. Log in to your Binance account
2. Go to API Management
3. Create a new API key
4. Enable "Spot & Margin Trading"
5. **Important**: Restrict IP access for security
6. Copy API Key and Secret Key to your `.env` file

### Grid Bot Parameters

| Parameter | Description | Range | Example |
|-----------|-------------|-------|----------|
| `name` | Bot identifier | 1-50 chars | "BTC Grid Bot" |
| `symbol` | Trading pair | Valid Binance symbol | "BTCUSDT" |
| `upperPrice` | Grid upper boundary | > lowerPrice | 50000 |
| `lowerPrice` | Grid lower boundary | > 0 | 40000 |
| `gridLevels` | Number of grid levels | 2-100 | 10 |
| `investmentAmount` | Total investment | ≥ 1 | 1000 |
| `profitPerGrid` | Profit per grid (%) | 0.1-50 | 1.0 |

## 📊 Bot States

- **`paused`**: Bot created but not started
- **`active`**: Bot running and monitoring orders
- **`stopped`**: Bot stopped, all orders canceled

## 💡 Best Practices

### Grid Configuration
1. **Choose appropriate price range**: 
   - Too narrow: Limited profit potential
   - Too wide: Capital inefficiency
   - Recommended: 20-50% range around current price

2. **Optimal grid levels**:
   - More levels = smaller profits per trade, more frequent trades
   - Fewer levels = larger profits per trade, less frequent trades
   - Recommended: 10-20 levels for most scenarios

3. **Profit per grid**:
   - Higher percentage = larger profits but fewer trades
   - Lower percentage = more trades but smaller profits
   - Recommended: 0.5-2% for most volatile pairs

### Risk Management
1. **Start small**: Test with small amounts first
2. **Monitor regularly**: Check bot performance daily
3. **Set appropriate ranges**: Don't set ranges too wide
4. **Diversify**: Don't put all funds in one bot
5. **Market conditions**: Grid trading works best in sideways markets

### Symbol Selection
1. **High volume pairs**: Better liquidity and execution
2. **Volatile but stable**: Avoid extremely volatile or trending markets
3. **Major pairs**: BTC, ETH, BNB pairs typically work well

## 🔍 Monitoring & Analytics

### Performance Metrics
- **Total Profit**: Realized profits from completed trades
- **Total Trades**: Number of completed buy/sell cycles
- **Success Rate**: Percentage of profitable trades
- **Unrealized PnL**: Current profit/loss from open positions
- **Running Time**: How long the bot has been active

### Order Tracking
- **Active Orders**: Currently open buy/sell orders
- **Order History**: Complete history of all orders
- **Grid Levels**: Visual representation of price levels

## ⚠️ Important Warnings

### Market Risks
1. **Trending Markets**: Grid bots can lose money in strong trending markets
2. **Price Breakouts**: If price breaks above/below grid range, bot may hold losing positions
3. **Market Volatility**: Extreme volatility can cause rapid losses

### Technical Risks
1. **API Limits**: Binance has rate limits that the bot respects
2. **Network Issues**: Internet connectivity problems can affect bot operation
3. **Exchange Downtime**: Binance maintenance can temporarily stop trading

### Security
1. **API Key Security**: Never share your API keys
2. **IP Restrictions**: Always restrict API access to your server IP
3. **Permissions**: Only enable "Spot Trading" permission
4. **Regular Monitoring**: Check bot activity regularly

## 🛠️ Installation & Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start the server**:
   ```bash
   npm run dev
   ```

4. **Create and start a grid bot**:
   ```bash
   # First, register/login to get JWT token
   # Then create and start your grid bot using the API
   ```

## 📈 Example Usage

### Creating a Conservative BTC Grid Bot
```bash
curl -X POST http://localhost:5000/api/grid-bots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Conservative BTC Bot",
    "symbol": "BTCUSDT",
    "upperPrice": 48000,
    "lowerPrice": 42000,
    "gridLevels": 15,
    "investmentAmount": 500,
    "profitPerGrid": 0.8
  }'
```

### Starting the Bot
```bash
curl -X POST http://localhost:5000/api/grid-bots/BOT_ID/start \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Checking Performance
```bash
curl -X GET http://localhost:5000/api/grid-bots/BOT_ID/performance \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 🤝 Support

For questions, issues, or feature requests, please check the bot logs and error messages. The bot includes comprehensive error handling and logging to help diagnose any issues.

---

**Disclaimer**: Grid trading involves financial risk. Past performance does not guarantee future results. Only trade with funds you can afford to lose. This bot is for educational and research purposes.