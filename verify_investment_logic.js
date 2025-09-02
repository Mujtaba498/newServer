/**
 * Simple verification of the investment logic
 */

console.log('🧪 Investment Logic Verification\n');

// Simulate a grid bot scenario
const botScenario = {
  configuredInvestment: 1000,
  orders: [
    // Initial buy orders
    { side: 'BUY', status: 'FILLED', price: 100, quantity: 5, executedPrice: 100, executedQty: 5 }, // 500
    { side: 'BUY', status: 'FILLED', price: 95, quantity: 5.26, executedPrice: 95, executedQty: 5.26 }, // 500
    
    // Some sell orders (profit taking)
    { side: 'SELL', status: 'FILLED', price: 105, quantity: 2, executedPrice: 105, executedQty: 2 }, // Sold 2 units
    { side: 'SELL', status: 'FILLED', price: 110, quantity: 1, executedPrice: 110, executedQty: 1 }, // Sold 1 unit
    
    // More buy orders (grid continues)
    { side: 'BUY', status: 'FILLED', price: 90, quantity: 5.56, executedPrice: 90, executedQty: 5.56 }, // 500 (from profits)
  ]
};

console.log('📊 Bot Scenario:');
console.log(`Configured Investment: ${botScenario.configuredInvestment}`);
console.log('\nOrder History:');

let totalBought = 0;
let totalBoughtValue = 0;
let totalSold = 0;
let totalExecutedBuyValue = 0;

for (const order of botScenario.orders) {
  const value = order.executedPrice * order.executedQty;
  console.log(`${order.side}: ${order.executedQty} @ ${order.executedPrice} = ${value}`);
  
  if (order.side === 'BUY' && order.status === 'FILLED') {
    totalBought += order.executedQty;
    totalBoughtValue += value;
    totalExecutedBuyValue += value; // This is what we were counting before (WRONG)
  } else if (order.side === 'SELL' && order.status === 'FILLED') {
    totalSold += order.executedQty;
  }
}

const netHoldings = totalBought - totalSold;
const avgBuyPrice = totalBought > 0 ? totalBoughtValue / totalBought : 0;
const currentHoldingsValue = netHoldings * avgBuyPrice;

console.log('\n📈 Calculations:');
console.log(`Total Bought: ${totalBought} units`);
console.log(`Total Sold: ${totalSold} units`);
console.log(`Net Holdings: ${netHoldings} units`);
console.log(`Average Buy Price: ${avgBuyPrice.toFixed(2)}`);
console.log(`Current Holdings Value: ${currentHoldingsValue.toFixed(2)}`);

console.log('\n🔍 Comparison:');
console.log(`Configured Investment: ${botScenario.configuredInvestment}`);
console.log(`Total Executed Buy Orders (OLD LOGIC): ${totalExecutedBuyValue.toFixed(2)} ❌`);
console.log(`Current Holdings Value (NEW LOGIC): ${currentHoldingsValue.toFixed(2)} ✅`);

console.log('\n✅ The NEW logic makes sense because:');
console.log('- Configured Investment: Money user allocated to the bot');
console.log('- Current Holdings Value: Money currently tied up in unsold positions');
console.log('- Holdings Value should be ≤ Configured Investment (unless profits are reinvested)');
console.log('- Old logic counted ALL buy orders, including those already sold for profit');

const isLogical = currentHoldingsValue <= botScenario.configuredInvestment;
console.log(`\n${isLogical ? '✅' : '❌'} Logic Check: Holdings Value ≤ Configured Investment: ${isLogical}`);