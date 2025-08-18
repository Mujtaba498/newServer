const mongoose = require('mongoose');
const GridBot = require('./models/GridBot');
const RecoveryService = require('./services/recoveryService');
const BinanceService = require('./services/binanceService');
require('dotenv').config();

// Mock Binance service for testing
class MockBinanceService {
  constructor() {
    this.mockOrders = new Map();
    this.nextOrderId = 1000;
  }

  async getSymbolInfo(symbol) {
    return {
      symbol: symbol,
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      stepSize: 0.00001,
      tickSize: 0.01,
      minQty: 0.00001,
      minNotional: 10,
      quantityPrecision: 5,
      pricePrecision: 2
    };
  }

  async placeLimitOrder(symbol, side, quantity, price) {
    const orderId = this.nextOrderId++;
    const order = {
      orderId: orderId.toString(),
      clientOrderId: `test_${orderId}`,
      symbol,
      side,
      type: 'LIMIT',
      quantity,
      price,
      status: 'NEW',
      timestamp: new Date()
    };
    
    this.mockOrders.set(orderId.toString(), order);
    console.log(`📝 Mock order placed: ${side} ${quantity} ${symbol} @ ${price} (ID: ${orderId})`);
    return order;
  }

  async getOrderStatus(symbol, orderId) {
    const order = this.mockOrders.get(orderId.toString());
    return order || null;
  }

  async getAssetBalance(asset) {
    return { free: 1000, locked: 0 }; // Mock sufficient balance
  }
}

// Test scenarios
async function testEnhancedRecovery() {
  try {
    console.log('🧪 Testing Enhanced Recovery System');
    console.log('=' .repeat(50));

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Create test bot with mixed scenarios
    const testBot = new GridBot({
      userId: new mongoose.Types.ObjectId(),
      name: 'Enhanced Recovery Test Bot',
      symbol: 'BTCUSDT',
      config: {
        lowerPrice: 30000,
        upperPrice: 35000,
        gridLevels: 10,
        profitPerGrid: 1.5,
        investmentAmount: 1000
      },
      status: 'active',
      orders: [
        // Scenario 1: Filled buy order without corresponding sell order
        {
          orderId: '1001',
          side: 'BUY',
          type: 'LIMIT',
          quantity: 0.003,
          executedQty: 0.003,
          price: 31000,
          executedPrice: 31000,
          gridLevel: 2,
          status: 'FILLED',
          timestamp: new Date(),
          hasCorrespondingSell: false
        },
        // Scenario 2: Filled sell order without corresponding buy order
        {
          orderId: '1002',
          side: 'SELL',
          type: 'LIMIT',
          quantity: 0.003,
          executedQty: 0.003,
          price: 32500,
          executedPrice: 32500,
          gridLevel: 5,
          status: 'FILLED',
          timestamp: new Date()
        },
        // Scenario 3: Complete pair (buy + sell) - should not need recovery
        {
          orderId: '1003',
          side: 'BUY',
          type: 'LIMIT',
          quantity: 0.003,
          executedQty: 0.003,
          price: 30500,
          executedPrice: 30500,
          gridLevel: 1,
          status: 'FILLED',
          timestamp: new Date(),
          hasCorrespondingSell: true
        },
        {
          orderId: '1004',
          side: 'SELL',
          type: 'LIMIT',
          quantity: 0.003,
          price: 30957.5, // 30500 * 1.015
          gridLevel: 1,
          status: 'NEW',
          timestamp: new Date()
        },
        // Scenario 4: Another filled buy without sell
        {
          orderId: '1005',
          side: 'BUY',
          type: 'LIMIT',
          quantity: 0.003,
          executedQty: 0.003,
          price: 33000,
          executedPrice: 33000,
          gridLevel: 6,
          status: 'FILLED',
          timestamp: new Date(),
          hasCorrespondingSell: false
        }
      ],
      statistics: {
        totalTrades: 0,
        totalProfit: 0,
        successfulTrades: 0
      }
    });

    await testBot.save();
    console.log(`✅ Test bot created with ID: ${testBot._id}`);

    // Create mock Binance service
    const mockBinance = new MockBinanceService();

    console.log('\n🔍 Initial Bot State:');
    console.log(`Orders: ${testBot.orders.length}`);
    testBot.orders.forEach(order => {
      console.log(`  ${order.side} ${order.orderId} - ${order.status} - Grid ${order.gridLevel} - Price: ${order.price}`);
    });

    // Test recovery analysis
    console.log('\n🔍 Running Recovery Analysis...');
    const recoveryActions = await RecoveryService.analyzeRecoveryNeeds(testBot, mockBinance);

    console.log('\n📋 Recovery Analysis Results:');
    console.log(`Needs Recovery: ${recoveryActions.needsRecovery}`);
    console.log(`Missing Sell Orders: ${recoveryActions.missingSellOrders.length}`);
    console.log(`Missing Buy Orders: ${recoveryActions.missingBuyOrders.length}`);
    console.log(`Filled Buy Orders: ${recoveryActions.filledBuyOrders}`);
    console.log(`Filled Sell Orders: ${recoveryActions.filledSellOrders}`);

    // Test placing missing orders
    if (recoveryActions.needsRecovery) {
      console.log('\n🔄 Placing Missing Orders...');
      
      if (recoveryActions.missingSellOrders.length > 0) {
        console.log(`\n📈 Placing ${recoveryActions.missingSellOrders.length} missing sell orders:`);
        recoveryActions.missingSellOrders.forEach(({ buyOrder, expectedSellPrice }) => {
          console.log(`  For buy order ${buyOrder.orderId} (grid ${buyOrder.gridLevel}): sell at ${expectedSellPrice}`);
        });
        await RecoveryService.placeMissingSellOrders(testBot, mockBinance, recoveryActions);
      }
      
      if (recoveryActions.missingBuyOrders.length > 0) {
        console.log(`\n📉 Placing ${recoveryActions.missingBuyOrders.length} missing buy orders:`);
        recoveryActions.missingBuyOrders.forEach(({ sellOrder, expectedBuyPrice }) => {
          console.log(`  For sell order ${sellOrder.orderId} (grid ${sellOrder.gridLevel}): buy at ${expectedBuyPrice}`);
        });
        await RecoveryService.placeMissingBuyOrders(testBot, mockBinance, recoveryActions);
      }
    }

    // Verify final state
    const updatedBot = await GridBot.findById(testBot._id);
    console.log('\n✅ Final Bot State:');
    console.log(`Total Orders: ${updatedBot.orders.length}`);
    
    const recoveryOrders = updatedBot.orders.filter(o => o.isRecoveryOrder);
    console.log(`Recovery Orders Placed: ${recoveryOrders.length}`);
    
    recoveryOrders.forEach(order => {
      console.log(`  Recovery ${order.side} ${order.orderId} - Grid ${order.gridLevel} - Price: ${order.price}`);
    });

    // Test second recovery run (should find no missing orders)
    console.log('\n🔍 Running Second Recovery Analysis (should find no issues)...');
    const secondRecovery = await RecoveryService.analyzeRecoveryNeeds(updatedBot, mockBinance);
    console.log(`Second Recovery Needed: ${secondRecovery.needsRecovery}`);
    console.log(`Missing Sell Orders: ${secondRecovery.missingSellOrders.length}`);
    console.log(`Missing Buy Orders: ${secondRecovery.missingBuyOrders.length}`);

    if (!secondRecovery.needsRecovery) {
      console.log('✅ SUCCESS: No additional recovery needed after first run!');
    } else {
      console.log('❌ ISSUE: Recovery still needed after first run');
    }

    // Cleanup
    await GridBot.findByIdAndDelete(testBot._id);
    console.log('\n🧹 Test bot cleaned up');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the test
if (require.main === module) {
  testEnhancedRecovery()
    .then(() => {
      console.log('\n🎉 Enhanced Recovery Test Completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = { testEnhancedRecovery };