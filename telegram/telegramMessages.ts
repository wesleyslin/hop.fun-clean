// telegramMessages.ts
import { bot, TG_CHAT_ID } from "./telegramBot";
import { getObjectType } from "../transactions/snipe";
import buyTokens from "../transactions/snipe";
import { storeTokenData, getTokenData, isTokenDuplicate } from '../utils/tokenStorage';
import sellTokens from "../transactions/sell";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { WALLET_ADDRESSES } from "../config/client";
import { getTokenBalance } from "../helpers/getTokenBalance"; 

const rpcUrl = getFullnodeUrl("mainnet");
const client = new SuiClient({ url: rpcUrl });

function sleep(ms: any) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeMarkdown(text: string): string {
  if (typeof text !== "string") {
    return "";
  }
  return text.replace(/([_*[\]~`>#+=\\])/g, (match) =>
    match === "+" ? match : "\\" + match
  );
}

export function escapeUrl(url: string): string {
  return url.replace(/([_*[\]()~`>#+|{}\\])/g, (match) =>
    match === "+" ? match : "\\" + match
  );
}

export async function sendTelegramListing(
  token: any,
  tokensLaunched: any,
  deployerBalance: any,
  creatorTokenHoldings: any
) {
  try {
    if (isTokenDuplicate(token.curve_id)) {
      return;
    }

    const objectId = token.curve_id.split("::")[0];
    const bondingCurveInfo = await getObjectType(objectId);
    const typeMatch = bondingCurveInfo?.type?.match(/<(.+?)>/);
    const tokenType = typeMatch ? typeMatch[1] : null;

    const hopFunUrl = tokenType ? 
      `https://hop.ag/fun/${encodeURIComponent(tokenType)}` : 
      `https://hop.fun/${token.curve_id}`;

    const messageText = `━━━━━━━━━━━━━━━━━━━━━━━
*${escapeMarkdown(token.coin_name)}* #${escapeMarkdown(token.ticker)}
\`${token.curve_id}\`

\`${escapeMarkdown(token.description ?? "N/A")}\`

🌐 Social Media:
  - Twitter: ${token.twitter !== "no twitter" ? escapeUrl(token.twitter) : "N/A"}
  - Telegram: ${token.telegram !== "no telegram" ? escapeUrl(token.telegram) : "N/A"}
  - Website: ${token.website !== "no website" ? escapeUrl(token.website) : "N/A"}

🔧 Token Info:
  - Curve ID: \`${token.curve_id}\`
  - Token Type: \`${tokenType || "N/A"}\`
  - Chart: [View on Hop.fun](${hopFunUrl})

📊 Background:
  - Deployer: [${escapeMarkdown(token.creator)}](https://suivision.xyz/address/${token.creator})
  - Tokens Launched: ${tokensLaunched} Token(s)
  - Deployer Balance: ${parseFloat(deployerBalance).toFixed(2)} SUI
  - Creator Holdings: ${creatorTokenHoldings.toFixed(2)}%


━━━━━━━━━━━━━━━━━━━━━━━`;

    const listingId = Math.random().toString(36).substring(2, 8);
    
    storeTokenData(listingId, token.curve_id, {
      name: token.coin_name,
      ticker: token.ticker,
      type: tokenType || "N/A"
    });
    
    const opts: any = {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "💵 Buy 1 SUI",
              callback_data: `buy_1_${listingId}`,
            },
            {
              text: "💵 Buy 25 SUI",
              callback_data: `buy_25_${listingId}`,
            },
          ],
          [
            {
              text: "💵 Buy 50 SUI",
              callback_data: `buy_50_${listingId}`,
            },
            {
              text: "💵 Buy 100 SUI",
              callback_data: `buy_100_${listingId}`,
            },
          ],
          [
            {
              text: "💵 Buy 300 SUI",
              callback_data: `buy_300_${listingId}`,
            },
          ],
          [
            {
              text: "🛑 Sell 10%",
              callback_data: `sell_10_${listingId}`,
            },
            {
              text: "🛑 Sell 40%",
              callback_data: `sell_40_${listingId}`,
            },
          ],
          [
            {
              text: "🛑 Sell All",
              callback_data: `sell_100_${listingId}`,
            },
          ],
          [
            {
              text: "🏦 Get Balance",
              callback_data: `ape_bal_0_${listingId}`,
            },
          ],
        ],
      },
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };

    console.log('Sending Telegram message for token:', token.curve_id);
    await bot.sendMessage(TG_CHAT_ID, messageText, opts);

    // Send image if available
    if (token.image_url && token.image_url !== "no image") {
      try {
        const cleanIpfsHash = token.image_url.replace('https://images.hop.ag/ipfs/', '');
        const imageUrl = `https://images.hop.ag/ipfs/${cleanIpfsHash}`;
        
        await bot.sendPhoto(TG_CHAT_ID, imageUrl).catch(error => {
          console.log('Error sending image:', error);
          return bot.sendMessage(TG_CHAT_ID, `Logo: ${imageUrl}`);
        });
      } catch (imageError) {
        console.log('Error handling image:', imageError);
      }
    }

  } catch (error: any) {
    console.log('Error sending Telegram message:', error);
  }
}

bot.on('callback_query', async (ctx: any) => {
  try {
    if (!ctx?.data) return;

    const callbackData = ctx.data;
    const [action, amount, listingId] = callbackData.split('_');
    const chatId = ctx?.message?.chat?.id;
    const userId = ctx.from.id;  // Get user's Discord ID
    const username = ctx.from.username;  // Get username
    const mention = username ? `@${username}` : `User`;

    if (!chatId) return;

    try {
      await bot.answerCallbackQuery(ctx.id);
    } catch (error) {
      console.log('Error acknowledging callback:', error);
    }

    if (action === 'buy') {
      try {
        const suiAmount = parseInt(amount);
        const tokenData = getTokenData(listingId);
        
        if (!tokenData) {
          await bot.sendMessage(chatId, 'Token data expired or not found. Please get a new quote.');
          return;
        }
        
        const curveId = tokenData.curveId;
        
        const processingMsg = await bot.sendMessage(chatId, `🔄 ${mention} is attempting to purchase ${suiAmount} SUI of ${tokenData.name}`);
        const success = await buyTokens(curveId, suiAmount);
        
        await bot.deleteMessage(chatId, processingMsg.message_id);
        
        if (success) {
          await bot.sendMessage(chatId, `✅ ${mention} successfully bought ${suiAmount} SUI worth of ${tokenData.name}`, { parse_mode: 'Markdown' });
        } else {
          await bot.sendMessage(chatId, `❌ ${mention}'s transaction failed. Please check your SUI balance and try again.`);
        }
      } catch (error) {
        console.log('Error processing buy:', error);
        await bot.sendMessage(chatId, `❌ ${mention}'s transaction failed. Please check your SUI balance and try again.`);
      }
    }

    if (action === 'sell') {
      try {
        const percentage = parseInt(amount);
        const tokenData = getTokenData(listingId);
        
        if (!tokenData) {
          await bot.sendMessage(chatId, 'Token data expired or not found. Please get a new quote.');
          return;
        }
        
        const curveId = tokenData.curveId;
        
        const processingMsg = await bot.sendMessage(chatId, `🔄 ${mention} is attempting to sell ${percentage}% of ${tokenData.name}`);
        const success = await sellTokens(curveId, percentage);
        
        await bot.deleteMessage(chatId, processingMsg.message_id);
        
        if (success) {
          if (tokenData.type) {
            const remainingPercentage = await getTokenBalance(tokenData.type);
            await bot.sendMessage(
              chatId, 
              `✅ ${mention} successfully sold ${percentage}% of \`${curveId}\` \nRemaining balance: ${remainingPercentage.toFixed(2)}% of total supply` , 
              { parse_mode: 'Markdown' }
            );
          }
        } else {
          await bot.sendMessage(chatId, `❌ ${mention}'s transaction failed. Please try again.`);
        }
      } catch (error) {
        console.log('Error processing sell:', error);
        await bot.sendMessage(chatId, `❌ ${mention}'s transaction failed. Please try again.`);
      }
    }

    if (action === 'ape_bal') {
      try {
        const tokenData = getTokenData(listingId);
        console.log(`Retrieved token data for listingId ${listingId}:`, tokenData);
        
        if (!tokenData || !tokenData.type) {
          await bot.sendMessage(chatId, 'Token data expired or not found. Please get a new quote.');
          return;
        }

        // Use the token type from tokenData
        const coinType = tokenData.type;
        console.log(`Fetching balances for coinType: ${coinType}`);
        
        // Fetch balances for all wallets and sum them
        const balances = await Promise.all(
          WALLET_ADDRESSES.map(address => 
            client.getBalance({
              owner: address,
              coinType: coinType
            })
          )
        );

        // Sum up all balances
        const totalBalance = balances.reduce(
          (sum, balance) => sum + BigInt(balance.totalBalance), 
          BigInt(0)
        );

        console.log(`Total balance across wallets:`, totalBalance.toString());

        // Calculate percentage
        const ownedPercentage = (totalBalance * BigInt(100)) / BigInt("100000000000000");
        const ownedPercentageNumber = Number(ownedPercentage);

        await bot.sendMessage(
          chatId, 
          `🏦 You own ${ownedPercentageNumber.toFixed(2)}% of the total supply.`
        );
      } catch (error) {
        console.log('Error retrieving balance:', error);
        await bot.sendMessage(chatId, 'Error retrieving balance. Please try again.');
      }
    }
  } catch (error: any) {
    console.log('Error handling button press:', error);
    
    try {
      const chatId = ctx?.message?.chat?.id;
      if (chatId) {
        await bot.sendMessage(chatId, 'Error processing your request. Please try again.');
      }
    } catch (sendError) {
      console.log('Error sending error message:', sendError);
    }
  }
});
