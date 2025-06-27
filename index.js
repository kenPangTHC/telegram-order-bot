const { Telegraf } = require("telegraf");
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

let orders = {};
let maxQty = 0;
let isOpen = false;
let closeTime = null;

function postSummary(ctx) {
  let summary = "📦 Order Summary:\n";
  let total = 0;
  let i = 1;
  for (const [user, data] of Object.entries(orders)) {
    // list the orders by each user with numbered
    summary += `\n${i}. ${user}: x ${data.qty} (${
      data.paid ? "✅ Paid" : "❌ Not Paid"
    })`;
    i++;
    total += data.qty;
  }
  summary += `\n***********************************`;
  summary += `\nTotal ordered: ${total}${maxQty ? '/' + maxQty : '' }\n`;
  summary += `\n 👉 Add your orders to @${bot.botInfo.username}.`;
  bot.telegram.sendMessage(GROUP_CHAT_ID, summary);
}

bot.command("startorders", (ctx) => {
  const args = ctx.message.text.split(" ");
  const min = parseInt(args[1]);
  const max = args[2] ? parseInt(args[2]) : Infinity;
  
  if (!min || min < 1) {
    return ctx.reply("❌ Please provide a valid minimum quantity: /startorders <min> [max]");
  }
  
  maxQty = max;
  orders = {};
  isOpen = true;
  closeTime = null;
  
  const maxText = max === Infinity ? "unlimited" : max;
  ctx.reply(`🟢 Orders are now open! Min: ${min}, Max: ${maxText}`);
  postSummary(ctx);
});

bot.command("order", (ctx) => {
  if (!isOpen) return ctx.reply("❌ Orders are closed.");
  const qty = parseInt(ctx.message.text.split(" ")[1]);
  const user = ctx.from.username;
  const currentQty = Object.values(orders).reduce((sum, o) => sum + o.qty, 0);
  if (currentQty + qty > maxQty) return ctx.reply("⚠️ Not enough slots!");
  orders[user] = { qty, paid: false };
  ctx.reply(`✅ Order received from @${user}: ${qty}`);
  postSummary(ctx);
});

bot.command("paid", (ctx) => {
  const user = ctx.from.username;
  if (orders[user]) {
    orders[user].paid = true;
    ctx.reply(`💰 Marked @${user} as paid.`);
    postSummary(ctx);
  } else {
    ctx.reply("❌ You haven't ordered yet.");
  }
});

bot.command("closeorders", (ctx) => {
  if (ctx.from.username !== process.env.HOST_USERNAME) {
    return ctx.reply("❌ Only host can close orders.");
  }
  isOpen = false;
  closeTime = Date.now();
  ctx.reply("🕒 Orders closed. 1 hour countdown started.");
  setTimeout(() => {
    for (const [user, data] of Object.entries(orders)) {
      if (!data.paid) {
        delete orders[user];
      }
    }
    ctx.reply("⏰ Time's up! Unpaid orders removed.");
    postSummary(ctx);
  }, 3600000); // 1 hour
});

bot.on("message", (ctx) => {
  if (ctx.chat.type !== "private") {
    return; // Ignore group messages
  }
  // handle logic...
});

bot.launch();
