const { Telegraf } = require("telegraf");
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

let orders = {};
let maxQty = 0;
let isOpen = false;
let closeTime = null;
// Initialize global available items
global.availableItems = [];

// Helper function to get user identifier (username or ID)
function getUserIdentifier(user) {
  return user.username || user.id.toString();
}

// Helper function to get user display name
function getUserDisplayName(user) {
  if (user.username) {
    return `@${user.username}`;
  }
  const firstName = user.first_name || '';
  const lastName = user.last_name || '';
  return `${firstName} ${lastName}`.trim() || `User ${user.id}`;
}

// Helper function to check if user is host
function isHost(user) {
  const username = user.username;
  const userId = user.id.toString();
  
  return (username && (username === process.env.HOST_USERNAME || username === process.env.HOST2_USERNAME)) ||
         userId === process.env.HOST_USER_ID || userId === process.env.HOST2_USER_ID;
}


function postSummary(ctx, closedOrders = false) {
  let summary = "📦 Order Summary:\n";
  let totalOrders = Object.keys(orders).length;
  
  // Display available items when orders are open
  if (isOpen && global.availableItems && global.availableItems.length > 0) {
    summary += "\n📋 Available Items:\n";
    global.availableItems.forEach((item, index) => {
      const letter = String.fromCharCode(65 + index); // A, B, C, etc.
      const maxText = item.max === Infinity ? "unlimited" : item.max;
      summary += `${letter}. ${item.name} (${item.min}-${maxText})\n`;
    });
    summary += "\n";
  }
  
  if (totalOrders === 0) {
    summary += "No orders yet.";
  } else {
    let i = 1;
    for (const [userKey, data] of Object.entries(orders)) {
      const itemsList = Object.entries(data.items || {})
        .map(([itemName, qty]) => {
          // Find the item index to get the letter (A, B, C, etc.)
          const itemIndex = global.availableItems.findIndex(item => item.name === itemName);
          const itemLetter = itemIndex >= 0 ? String.fromCharCode(65 + itemIndex) : itemName;
          return `${itemLetter}: ${qty}`;
        })
        .join(", ");
      
      const displayName = data.userInfo ? getUserDisplayName(data.userInfo) : `@${userKey}`;
      summary += `\n${i}. ${displayName}: ${itemsList} (${
        data.paid ? "✅ Paid" : "❌ Not Paid"
      })`;
      i++;
    }
  }
  
  summary += `\n***********************************`;
  
  let totalQty = Object.values(orders).reduce((sum, o) => sum + o.qty, 0);
  // Calculate quantities per item type
  const itemTotals = {};
  Object.values(orders).forEach(order => {
    Object.entries(order.items || {}).forEach(([itemName, qty]) => {
      itemTotals[itemName] = (itemTotals[itemName] || 0) + qty;
    });
  });
  
  // Display totals per item if there are any orders
  if (Object.keys(itemTotals).length > 0) {
    summary += "\n\n📊 Item Totals:\n";
    global.availableItems.forEach((item, index) => {
      const letter = String.fromCharCode(65 + index);
      const total = itemTotals[item.name] || 0;
      const maxText = item.max === Infinity ? "∞" : item.max;
      summary += `${letter}. ${item.name}: ${total}/${maxText}\n`;
    });
  }
  
  summary += `\nTotal quantity: ${totalQty}${maxQty !== Infinity ? '/' + maxQty : ''}`;
  summary += `\nTotal orders: ${totalOrders}`;
  if (closedOrders) {
    summary += `\nOrders closed at: ${closeTime ? closeTime.toLocaleString() : "N/A"}`;
  } else {
    summary += `\nOrders are currently ${isOpen ? "open" : "closed"}.`;
    if (isOpen) {
      summary += `\n👉 Add your orders to @${bot.botInfo.username}.`;
    }
  }
  
  bot.telegram.sendMessage(GROUP_CHAT_ID, summary);
}

bot.command("startorders", (ctx) => {
  // check if the user is the host and host2
  if (!isHost(ctx.from)) {
    return ctx.reply("❌ Only the host can start orders.");
  }
  const args = ctx.message.text.split(" ");
  

  // Format: /startorders item1 min max
  // item2 min max
  // item3 min max
  // the host will send message of the items without spaces like Durian_MSW_$33
  // first order is in same line with the command
  // subsequent orders are in new lines
  const message = ctx.message.text;
  const lines = message.split('\n');

  // Extract first item from command line if provided
  const commandParts = lines[0].split(' ');
  const items = [];

  // Parse first item from command line (/startorders Durian_MSW_$33 1 5)
  if (commandParts.length >= 3) {
    const itemName = commandParts[1];
    const min = parseInt(commandParts[2]);
    const max = commandParts[3] ? parseInt(commandParts[3]) : Infinity;
    
    if (!min || min < 1) {
      return ctx.reply(`❌ Invalid minimum quantity for "${itemName}": ${commandParts[2]}`);
    }
    
    items.push({ name: itemName, min, max });
  }

  // Parse additional items from subsequent lines
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(' ');
    if (parts.length < 2) {
      return ctx.reply(`❌ Invalid format on line ${i + 1}: "${line}"\nExpected: item min [max]`);
    }
    
    const itemName = parts[0];
    const min = parseInt(parts[1]);
    const max = parts[2] ? parseInt(parts[2]) : Infinity;
    
    if (!min || min < 1) {
      return ctx.reply(`❌ Invalid minimum quantity for "${itemName}": ${parts[1]}`);
    }
    
    items.push({ name: itemName, min, max });
  }

  if (items.length === 0) {
    return ctx.reply("❌ Please provide at least one item:\n/startorders Durian_MSW_$33 1 5\nor\n/startorders\nDurian_MSW_$33 1 5\nMango_Thai_$25 2 10");
  }

  // Store items globally for order command to reference
  global.availableItems = items;

  // Reset orders structure
  orders = {};

  // Calculate total max capacity across all items
  maxQty = items.reduce((sum, item) => {
    return item.max === Infinity ? Infinity : sum + item.max;
  }, 0);

  isOpen = true;
  closeTime = null;

  let itemsList = items.map((item, index) => {
    const letter = String.fromCharCode(65 + index); // A, B, C, etc.
    const maxText = item.max === Infinity ? "unlimited" : item.max;
    return `${letter}. ${item.name} (${item.min}-${maxText})`;
  }).join('\n');

  ctx.reply(`🟢 Orders are now open!\n\n${itemsList}`);
  postSummary(ctx);
});

bot.command("order", (ctx) => {
  if (!isOpen) return ctx.reply("❌ Orders are closed.");
  
  // Format 
  // /order A <qty>
  // B <qty>
  // C <qty>
  // it should make it easy for the user to specify A to refer to item 1 and B to refer to item 2
  // and so on.
  // first order is in same line with the command
  // subsequent orders are in new lines
  const message = ctx.message.text;
  const lines = message.split('\n');
  
  // Extract first order from the command line
  const commandParts = lines[0].split(' ');
  if (commandParts.length < 3) {
    return ctx.reply("❌ Please specify items and quantities:\n\n/order A 2 \nor\n /order A 2\nB 1\nC 3");
  }
  
  const user = getUserIdentifier(ctx.from);
  const userOrder = {};
  
  // Get available items from the global items list (need to store from startorders)
  if (!global.availableItems || global.availableItems.length === 0) {
    return ctx.reply("❌ No items available. Host needs to start orders first.");
  }
  
  // Parse first order from command line (/order A 2)
  const firstItemLetter = commandParts[1].toUpperCase();
  const firstQty = parseInt(commandParts[2]);
  
  // Convert A, B, C to item index (A=0, B=1, C=2)
  let itemIndex = firstItemLetter.charCodeAt(0) - 65;
  
  if (itemIndex < 0 || itemIndex >= global.availableItems.length) {
    return ctx.reply(`❌ Invalid item "${firstItemLetter}". Available items: ${global.availableItems.map((_, i) => String.fromCharCode(65 + i)).join(', ')}`);
  }
  
  let item = global.availableItems[itemIndex];
  
  // Default to 1 if no quantity specified or invalid, max 5 per item
  let validFirstQty = firstQty;
  if (isNaN(firstQty) || firstQty < 1) {
    validFirstQty = 1;
  } else if (firstQty > 5) {
    validFirstQty = 5;
  }
  
  // Check against item max constraint
  if (validFirstQty > item.max) {
    const maxText = item.max === Infinity ? "unlimited" : item.max;
    return ctx.reply(`❌ Invalid quantity for ${item.name} (${firstItemLetter}): maximum is ${maxText}.`);
  }
  
  // Check capacity left for this specific item
  const currentItemQty = Object.values(orders).reduce((sum, order) => {
    return sum + (order.items?.[item.name] || 0);
  }, 0);
  
  if (item.max !== Infinity && currentItemQty + validFirstQty > item.max) {
    const remainingCapacity = item.max - currentItemQty;
    return ctx.reply(`❌ Only ${remainingCapacity} slots remaining for ${item.name} (${firstItemLetter}).`);
  }    userOrder[item.name] = validFirstQty;
  
  // Parse additional orders from subsequent lines
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(' ');
    if (parts.length !== 2) {
      return ctx.reply(`❌ Invalid format on line ${i + 1}: "${line}"\nExpected: A quantity or B quantity`);
    }
    
    const itemLetter = parts[0].toUpperCase();
    const qty = parseInt(parts[1]);
    
    // Convert A, B, C to item index (A=0, B=1, C=2)
    itemIndex = itemLetter.charCodeAt(0) - 65;
    
    if (itemIndex < 0 || itemIndex >= global.availableItems.length) {
      return ctx.reply(`❌ Invalid item "${itemLetter}". Available items: ${global.availableItems.map((_, i) => String.fromCharCode(65 + i)).join(', ')}`);
    }
    
    item = global.availableItems[itemIndex];
    
    // Default to 1 if no quantity specified or invalid, max 5 per item
    let validQty = qty;
    if (isNaN(qty) || qty < 1) {
      validQty = 1;
    } else if (qty > 5) {
      validQty = 5;
    }
    
    // Check against item max constraint
    if (validQty > item.max) {
      const maxText = item.max === Infinity ? "unlimited" : item.max;
      return ctx.reply(`❌ Invalid quantity for ${item.name} (${itemLetter}): maximum is ${maxText}.`);
    }
    
    userOrder[item.name] = validQty;
  }
  
  // Check user's order limit (max 5 items per user)
  const requestedTotalQty = Object.values(userOrder).reduce((sum, qty) => sum + qty, 0);
  
  if (requestedTotalQty > 5) {
    return ctx.reply(`❌ You can only order a maximum of 5 items total. Your request has ${requestedTotalQty} items.`);
  }
  
  // Check total capacity constraints
  const currentTotalQty = Object.values(orders).reduce((sum, order) => {
    return sum + Object.values(order.items || {}).reduce((itemSum, qty) => itemSum + qty, 0);
  }, 0);
  
  if (maxQty !== Infinity && currentTotalQty + requestedTotalQty > maxQty) {
    const remainingSlots = maxQty - currentTotalQty;
    return ctx.reply(`❌ Only ${remainingSlots} slots remaining. Your requested ${requestedTotalQty} items exceed capacity.`);
  }
  
  orders[user] = { 
    items: userOrder, 
    paid: false, 
    qty: requestedTotalQty,
    userInfo: ctx.from 
  };
  
  const itemsList = Object.entries(userOrder)
    .map(([item, qty]) => `${item}: ${qty}`)
    .join(", ");
  
  const displayName = getUserDisplayName(ctx.from);
  ctx.reply(`✅ Order received from ${displayName}:\n${itemsList}`);
  postSummary(ctx);
});

bot.command("paid", (ctx) => {
  const user = getUserIdentifier(ctx.from);
  if (orders[user]) {
    orders[user].paid = true;
    const itemsList = Object.entries(orders[user].items || {})
      .map(([itemName, qty]) => {
        // Find the item index to get the letter (A, B, C, etc.)
        const itemIndex = global.availableItems.findIndex(item => item.name === itemName);
        const itemLetter = itemIndex >= 0 ? String.fromCharCode(65 + itemIndex) : itemName;
        return `${itemLetter}: ${qty}`;
      })
      .join(", ");
    const displayName = getUserDisplayName(ctx.from);
    ctx.reply(`💰 Marked ${displayName} as paid for: ${itemsList}`);
    postSummary(ctx);
  } else {
    ctx.reply("❌ You haven't ordered yet.");
  }
});

bot.command("closeorders", (ctx) => {
  if (!isHost(ctx.from)) {
    return ctx.reply("❌ Only host can close orders.");
  }
  // post summary messages to the groupchat and also to the in the bot chat
  if (!isOpen) return ctx.reply("❌ Orders are already closed.");
  isOpen = false;
  closeTime = new Date();
  ctx.reply("🔴 Orders are now closed.")
  postSummary(ctx)
  bot.telegram.sendMessage(GROUP_CHAT_ID, "🔴 Orders are now closed."
  + `\nClosed at: ${closeTime.toLocaleString()}`);
});

bot.on("message", (ctx) => {
  if (ctx.chat.type !== "private") {
    return; // Ignore group messages
  }
  // handle logic...
});

bot.launch();
