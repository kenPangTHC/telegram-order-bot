const { Telegraf } = require('telegraf');
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

let orders = {};
let maxQty = 0;
let isOpen = false;
let closeTime = null;

function postSummary(ctx) {
  let summary = '📦 Order Summary:\\n';
  let total = 0;
  for (const [user, data] of Object.entries(orders)) {
    summary += `@${user}: ${data.qty} ${data.paid ? '✅' : '❌'}\\n`;
    total += data.qty;
  }
  summary += `Total ordered: ${total}/${maxQty}`;
  bot.telegram.sendMessage(GROUP_CHAT_ID, summary);
}

bot.command('startorders', ctx => {
  if (ctx.from.username !== process.env.HOST_USERNAME) {
    return ctx.reply('❌ Only host can start orders.');
  }
  const parts = ctx.message.text.split(' ');
  maxQty = parseInt(parts[1]);
  isOpen = true;
  orders = {};
  ctx.reply(`🚀 Order started! Max slots: ${maxQty}`);
});

bot.command('order', ctx => {
  if (!isOpen) return ctx.reply('❌ Orders are closed.');
  const qty = parseInt(ctx.message.text.split(' ')[1]);
  const user = ctx.from.username;
  const currentQty = Object.values(orders).reduce((sum, o) => sum + o.qty, 0);
  if (currentQty + qty > maxQty) return ctx.reply('⚠️ Not enough slots!');
  orders[user] = { qty, paid: false };
  ctx.reply(`✅ Order received from @${user}: ${qty}`);
  postSummary(ctx);
});

bot.command('paid', ctx => {
  const user = ctx.from.username;
  if (orders[user]) {
    orders[user].paid = true;
    ctx.reply(`💰 Marked @${user} as paid.`);
    postSummary(ctx);
  } else {
    ctx.reply("❌ You haven't ordered yet.");
  }
});

bot.command('closeorders', ctx => {
  if (ctx.from.username !== process.env.HOST_USERNAME) {
    return ctx.reply('❌ Only host can close orders.');
  }
  isOpen = false;
  closeTime = Date.now();
  ctx.reply('🕒 Orders closed. 1 hour countdown started.');
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


bot.on('message', ctx => {
  if (ctx.chat.type !== 'private') {
    return; // Ignore group messages
  }
  // handle logic...
});


bot.launch();