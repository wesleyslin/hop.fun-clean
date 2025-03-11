// telegramCommands.ts
import fs from 'fs';
import path from 'path';
import { isAddress } from 'viem'
import { bot } from './telegramBot';
import { retrieveEnvVariable, retrieveSetting, updateSetting, logger } from '../utils/utils';
import buyTokens from '../transactions/snipe';
import { getOurBalance } from '../helpers/getOurBalance';
import { getTokenBalance } from '../helpers/getTokenBalance';
import { getTokenData } from '../utils/tokenStorage';
import sellTokens from '../transactions/sell';
import { client } from '../config/client';

const tokenDataFilePath = path.join(__dirname, '..', '..', 'tokenData.json');
function readTokenDataFromFile() {
    try {
        const data = fs.readFileSync(tokenDataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

// Define the bot commands
const commands = [
    { command: 'hopfun', description: 'Open the Hop.Fun main menu' },
    { command: 'sell', description: 'Sell a token' },
    { command: 'balance', description: 'Get the balance of a token' },
    { command: 'ourbalance', description: 'Get our SUI balance' },
    { command: 'refresh', description: 'Refresh cookies (DONT USE OFTEN)' },
    { command: 'add_to_blacklist', description: 'Add an address to the blacklist' },
    { command: 'add_to_funding', description: 'Add an address to the funding list' }
];

// Register the commands with Telegram
bot.setMyCommands(commands);

function isAllowedChat(chatId: number): boolean {
    const allowedChatId = parseInt(retrieveEnvVariable('TG_CHAT_ID'), 10);
    return chatId === allowedChatId;
}

function restrictAccess(callback: (msg: any) => void) {
    return (msg: any) => {
        const chatId = msg.chat.id;
        if (!isAllowedChat(chatId)) {
            bot.sendMessage(chatId, "Unauthorized access. This bot is restricted to a specific group.");
            return;
        }
        callback(msg);
    };
}

function restrictAccessCallback(callback: (callbackQuery: any) => void) {
    return (callbackQuery: any) => {
        const chatId = callbackQuery.message.chat.id;
        if (!isAllowedChat(chatId)) {
            bot.answerCallbackQuery(callbackQuery.id, { text: "Unauthorized access. This bot is restricted to a specific group.", show_alert: true });
            return;
        }
        callback(callbackQuery);
    };
}

function isValidAddress(address: string): boolean {
    return isAddress(address); 
}

// Handle the /add_to_blacklist command
bot.onText(/\/add_to_blacklist/, restrictAccess((msg: any) => {
    const chatId = msg.chat.id;
    const originalMessageId = msg.message_id; // Capture the original message ID
    const mention = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'User');

    bot.sendMessage(chatId, `${mention}; Please enter the address you want to add to the blacklist:`, {
        reply_markup: {
            force_reply: true,
        }
    }).then((sentMessage) => {
        const addressListener = (msg: any) => {
            if (msg.reply_to_message && msg.reply_to_message.message_id === sentMessage.message_id) {
                const address = msg.text.trim();

                if (isValidAddress(address)) {
                    let blacklist = retrieveSetting('BLOCKED_ADDRESSES') || [];
                    // Convert all addresses in the blacklist to lowercase for comparison
                    blacklist = blacklist.map((addr: string) => addr.toLowerCase());

                    if (!blacklist.includes(address)) {
                        blacklist.push(address);
                        updateSetting('BLOCKED_ADDRESSES', blacklist);
                        bot.sendMessage(chatId, `✅ ${mention}; Address ${address} has been added to the blacklist.`);
                    } else {
                        bot.sendMessage(chatId, `⚠️ ${mention}; Address ${address} is already in the blacklist.`);
                    }
                } else {
                    bot.sendMessage(chatId, `❌ ${mention}; Invalid address. Please try again.`);
                }

                // Delete messages sequentially
                bot.deleteMessage(chatId, msg.message_id).catch(logger.error).then(() => {
                    bot.deleteMessage(chatId, sentMessage.message_id).catch(logger.error).then(() => {
                        bot.deleteMessage(chatId, originalMessageId).catch(logger.error);
                    });
                });

                bot.removeListener('message', addressListener);
            }
        };
        bot.on('message', addressListener);
    });
}));

// Handle the /add_to_funding command
bot.onText(/\/add_to_funding/, restrictAccess((msg: any) => {
    const chatId = msg.chat.id;
    const originalMessageId = msg.message_id; // Capture the original message ID
    const mention = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'User');

    bot.sendMessage(chatId, `${mention}; Please enter the address you want to add to the funding list:`, {
        reply_markup: {
            force_reply: true,
        }
    }).then((sentMessage) => {
        const addressListener = (msg: any) => {
            if (msg.reply_to_message && msg.reply_to_message.message_id === sentMessage.message_id) {
                const address = msg.text.trim().toLowerCase(); // Convert to lowercase

                if (isValidAddress(address)) {
                    const fundingAddresses = retrieveSetting('FUNDING_ADDRESSES') || [];

                    if (!fundingAddresses.some((entry: any) => entry.address.toLowerCase() === address)) {
                        bot.sendMessage(chatId, `${mention}; Please enter a name for this funding address:`, {
                            reply_markup: {
                                force_reply: true,
                            }
                        }).then((nameMessage) => {
                            const nameListener = (nameMsg: any) => {
                                if (nameMsg.reply_to_message && nameMsg.reply_to_message.message_id === nameMessage.message_id) {
                                    const name = nameMsg.text.trim();
                                    fundingAddresses.push({ name, address });
                                    updateSetting('FUNDING_ADDRESSES', fundingAddresses);
                                    bot.sendMessage(chatId, `✅ ${mention}; Address ${address} has been added to the funding list with name "${name}".`);

                                    bot.deleteMessage(chatId, nameMessage.message_id);
                                    bot.deleteMessage(chatId, nameMsg.message_id);
                                    bot.deleteMessage(chatId, originalMessageId); // Delete the original message
                                    bot.removeListener('message', nameListener);
                                }
                            };
                            bot.on('message', nameListener);
                        });
                    } else {
                        bot.sendMessage(chatId, `⚠️ ${mention}; Address ${address} is already in the funding list.`);
                        bot.deleteMessage(chatId, originalMessageId); // Delete the original message
                    }
                } else {
                    bot.sendMessage(chatId, `❌ ${mention}; Invalid address. Please try again.`);
                    bot.deleteMessage(chatId, originalMessageId); // Delete the original message
                }

                bot.deleteMessage(chatId, sentMessage.message_id);
                bot.deleteMessage(chatId, msg.message_id);
                bot.removeListener('message', addressListener);
            }
        };
        bot.on('message', addressListener);
    });
}));

// Handle the /sell command
bot.onText(/\/sell/, restrictAccess((msg: any) => {
    const chatId = msg.chat.id;
    const mention = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'User');

    bot.sendMessage(chatId, `${mention}; Please enter the token curve ID:`, {
        reply_markup: {
            force_reply: true,
        }
    }).then((sentMessage) => {
        const addressListener = (msg: any) => {
            if (msg.reply_to_message && msg.reply_to_message.message_id === sentMessage.message_id) {
                const curveId = msg.text.trim();
                bot.sendMessage(chatId, `${mention}; Please enter the percentage to sell (any number between 1-100):`, {
                    reply_markup: {
                        force_reply: true,
                    }
                }).then((percentMessage) => {
                    const percentListener = async (percentMsg: any) => {
                        if (percentMsg.reply_to_message && percentMsg.reply_to_message.message_id === percentMessage.message_id) {
                            const percentage = parseInt(percentMsg.text.trim());

                            // Validate percentage
                            if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
                                bot.sendMessage(chatId, `❌ ${mention}; Invalid percentage. Please enter a number between 1 and 100.`);
                                return;
                            }

                            // Send processing message
                            const processingMsg = await bot.sendMessage(chatId, `Processing sell order for ${percentage}%...`);
                            
                            try {
                                const success = await sellTokens(curveId, percentage);
                                
                                // Delete processing message
                                await bot.deleteMessage(chatId, processingMsg.message_id);

                                if (success) {
                                    // Get token type from object
                                    const objectId = curveId.split("::")[0];
                                    const bondingCurveInfo = await client.getObject({
                                        id: objectId,
                                        options: { showType: true }
                                    });

                                    const typeMatch = bondingCurveInfo.data?.type?.match(/<(.+?)>/);
                                    const tokenType = typeMatch?.[1];

                                    if (tokenType) {
                                        // Get remaining balance
                                        const remainingPercentage = await getTokenBalance(tokenType);
                                        await bot.sendMessage(
                                            chatId, 
                                            `✅ Successfully sold ${percentage}% of \`${curveId}\`\nRemaining balance: ${remainingPercentage}% of total supply`, 
                                            { parse_mode: 'Markdown' }
                                        );
                                    } else {
                                        await bot.sendMessage(
                                            chatId, 
                                            `✅ Successfully sold ${percentage}% of \`${curveId}\``, 
                                            { parse_mode: 'Markdown' }
                                        );
                                    }
                                } else {
                                    await bot.sendMessage(chatId, `❌ Error selling ${percentage}% of tokens`);
                                }
                            } catch (error: unknown) {
                                console.error('Error executing sell:', error);
                                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                                await bot.sendMessage(chatId, `❌ Error processing sell order: ${errorMessage}`);
                            }

                            // Clean up messages
                            bot.deleteMessage(chatId, sentMessage.message_id);
                            bot.deleteMessage(chatId, msg.message_id);
                            bot.deleteMessage(chatId, percentMsg.message_id);
                            bot.deleteMessage(chatId, percentMessage.message_id);
                            bot.removeListener('message', percentListener);
                        }
                    };
                    bot.on('message', percentListener);
                });

                bot.removeListener('message', addressListener);
            }
        };
        bot.on('message', addressListener);
    });
}));

// Handle the /balance command
bot.onText(/\/balance/, restrictAccess((msg: any) => {
    const chatId = msg.chat.id;
    const mention = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'User');

    bot.sendMessage(chatId, `${mention}; Please enter the token address:`, {
        reply_markup: {
            force_reply: true,
        }
    }).then((sentMessage) => {
        // Wait for the user's reply and handle it
        const replyListener = async (msg: any) => {
            if (msg.reply_to_message && msg.reply_to_message.message_id === sentMessage.message_id) {
                const tokenAddress = msg.text.trim();

                try {
                    // Get token data first
                    const tokenData = getTokenData(tokenAddress);
                    if (!tokenData || !tokenData.type) {
                        throw new Error('Token data not found or invalid');
                    }

                    // Use the token type from the stored data
                    const percentOfSupply = await getTokenBalance(tokenData.type);
                    bot.sendMessage(chatId, `🏦 ${mention}; We hold ${percentOfSupply}% of ${tokenData.name || tokenAddress} supply`);
                } catch (error: any) {
                    bot.sendMessage(chatId, `❌ ${mention}; Error fetching balance for token: ${error.message}`);
                }

                // Delete the prompt message and the user's reply
                bot.deleteMessage(chatId, sentMessage.message_id);
                bot.deleteMessage(chatId, msg.message_id);

                // Remove the listener after handling the message
                bot.removeListener('message', replyListener);
            }
        };

        // Add a listener for the next message from the user
        bot.on('message', replyListener);
    });
}));

// Handle the /refresh command
bot.onText(/\/ourbalance/, restrictAccess(async (msg: any) => {
    try {
        const chatId = msg.chat.id;
        const mention = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'User');
        
        const { totalBalance, balances } = await getOurBalance(true); // Pass true to get SUI format

        // Format individual wallet balances with correct typing
        const walletBalances = balances
            .map((balance, index) => 
                `Wallet ${index + 1}: ${Number(balance).toFixed(2)} SUI`
            )
            .join('\n');

        // Send formatted message
        await bot.sendMessage(
            chatId,
            `💰 ${mention}; Our Total Balance: ${Number(totalBalance).toFixed(0)} SUI`
        );
    } catch (error) {
        console.error('Error in /ourbalance command:', error);
        await bot.sendMessage(msg.chat.id, 'Error fetching balance. Please try again.');
    }
}));

// Handle the /refresh command
bot.onText(/\/refresh/, restrictAccess(async (msg: any) => {
    const chatId = msg.chat.id;
    const mention = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'User');

    const pendingMessage = await bot.sendMessage(chatId, `🔄 ${mention}; Refreshing cookies, please wait...`);

    try {
        bot.editMessageText(`✅ ${mention}; Cookies have been refreshed successfully.`, { chat_id: chatId, message_id: pendingMessage.message_id });
    } catch (error: any) {
        bot.editMessageText(`❌ ${mention}; Error refreshing cookies: ${error.message}`, { chat_id: chatId, message_id: pendingMessage.message_id });
    }
}));

const generateSettingsMessage = () => {
    return `*Settings*:\n`;
};

const generateSettingsKeyboard = (autobuyStatus: string, amount: string, checkRepeatSocialsStatus: any) => {
    return {
        inline_keyboard: [
            [{ text: `Toggle Autobuy ${autobuyStatus}`, callback_data: 'hopfun_toggle_autobuy' }],
            [{ text: `Set Autobuy Amount (${amount} SUI)`, callback_data: 'hopfun_set_autobuy_amount' }],
            [{ text: `Toggle Check Repeat Socials ${checkRepeatSocialsStatus}`, callback_data: 'hopfun_toggle_check_repeat_socials' }],
            [{ text: 'Return to Main Menu', callback_data: 'hopfun_main_menu' }]
        ]
    };
};

// New function to handle displaying the settings menu
export const handleSettingsMenu = async (callbackQuery: any) => {
    const chatId = callbackQuery.message.chat.id;
    const autobuyStatus = retrieveSetting('AUTOBUY') === 'true' ? '🟢' : '🔴';
    const defaultAutobuyAmount = retrieveSetting('DEFAULT_AUTOBUY_AMOUNT');
    const checkRepeatSocials = retrieveSetting('CHECK_REPEAT_SOCIALS') === 'true' ? '🟢' : '🔴';
    const message = generateSettingsMessage();
    const opts: any = {
        reply_markup: generateSettingsKeyboard(autobuyStatus, defaultAutobuyAmount, checkRepeatSocials),
        parse_mode: 'Markdown'
    };

    bot.editMessageText(message, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
        ...opts as any
    });
};

// Handle callback queries
bot.on('callback_query', restrictAccessCallback(async (callbackQuery: any) => {
    const data = callbackQuery.data;

    // Delegate handling based on the action
    if (data === 'menu_hopfun_buy') {
        handleBuyCallbackQuery(callbackQuery);
    } else if (data === 'menu_hopfun_sell') {
        handleSellCallbackQuery(callbackQuery);
    } else if (data === 'menu_hopfun_holdings') {
        handleHoldingsCallbackQuery(callbackQuery);
    } else if (data === 'menu_hopfun_settings') {
        handleSettingsMenu(callbackQuery);
    } else if (data === 'menu_hopfun_close') {
        bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id);
    } else if (data === 'hopfun_toggle_autobuy' || data === 'hopfun_set_autobuy_amount' || data === 'hopfun_toggle_check_repeat_socials' || data === 'hopfun_main_menu') {
        handleSettingsCallbackQuery(callbackQuery);
    } else {
        const actionParts = data.split('_'); // Format: 'platform_action_amount_id'
        const platform = actionParts[0];
        if (platform === 'ape') {
            const action = actionParts[1];
            const amount = parseFloat(actionParts[2]);
            const tokenAddress = actionParts[3];
            const chatId = callbackQuery.message.chat.id;
            const user = callbackQuery.from.username;

            let tokenData = readTokenDataFromFile()[tokenAddress];
            if (!tokenData) {
                tokenData = await (tokenAddress);
                if (!tokenData) {
                    return;
                } else {
                }               
            }
            
            if (action === 'buy') {
                const totalEthToSpend = amount;
    
                // Check if the username exists
                const mention = user ? `@${user}` : "User";
    
                // Send initial confirmation message
                const initialMessage = `🔄 ${mention}; Attempting to purchase ${tokenData.name} ($${tokenData.symbol}) using ${totalEthToSpend} ETH. Please wait...`;
                bot.sendMessage(chatId, initialMessage);
    
                try {
                    // Call the main function from sellTokens.ts with tokenAddress
                    const success = await buyTokens(tokenAddress, totalEthToSpend);

                    if (success) {
                        const successMessage = `✅ ${mention}; Purchase of ${tokenData.name} ($${tokenData.symbol}) using ${totalEthToSpend} ETH was successful!`;
                        bot.sendMessage(chatId, successMessage);
                    } else {
                        const errorMessage = `❌ ${mention}; Error during purchase of ${tokenData.name} ($${tokenData.symbol})`;
                        bot.sendMessage(chatId, errorMessage);
                    }
                } catch (error: any) {
                    // Send failure message
                    const errorMessage = `❌ ${mention}; Error during purchase of ${tokenData.name} ($${tokenData.symbol}): ${error.message}`;
                    bot.sendMessage(chatId, errorMessage);
                    logger.error("Error during purchase:", error);
                }
            } else if (action === 'sell') {
                const percentToSell = isNaN(amount) ? 0 : amount; // Default to 0 if amount is NaN

                // Check if the username exists
                const mention = user ? `@${user}` : "User";

                // Send initial confirmation message
                const initialMessage = `🔄 ${mention}; Attempting to sell ${percentToSell}% of ${tokenData.name} ($${tokenData.symbol}). Please wait...`;
                bot.sendMessage(chatId, initialMessage);

                try {
                    /*
                    // Call the main function from sellTokens.ts with tokenAddress
                    logger.info(tokenAddress, percentToSell)
                    const success = await sellTokens(tokenAddress, percentToSell);
                    if (success === true) {
                        bot.sendMessage(chatId, `✅ ${mention}; Successfully sold ${percentToSell}% of ${tokenData.name} ($${tokenData.symbol}).`);
                    } else {
                        bot.sendMessage(chatId, `❌ ${mention}; Error selling ${percentToSell}% of ${tokenData.name} ($${tokenData.symbol})`);
                    }
                        */
                } catch (error: any) {
                    bot.sendMessage(chatId, `❌ ${mention}; Error selling ${percentToSell}% of ${tokenData.name} ($${tokenData.symbol}): ${error.message}`);
                }
            } else if (action === 'bal') {
                // Check if the username exists
                const mention = user ? `@${user}` : "User";

                try {
                    // Get token data first
                    const tokenData = getTokenData(tokenAddress);
                    if (!tokenData || !tokenData.type) {
                        throw new Error('Token data not found or invalid');
                    }

                    // Use the token type from the stored data
                    const percentOfSupply = await getTokenBalance(tokenData.type);
                    bot.sendMessage(chatId, `🏦 ${mention}; We hold ${percentOfSupply}% of ${tokenData.name || tokenAddress} supply`);
                } catch (error: any) {
                    bot.sendMessage(chatId, `❌ ${mention}; Error getting balance: ${error.message}`);
                }
            }
        }
    }
}));

export const handleSettingsCallbackQuery = async (callbackQuery: any) => {
    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const user = callbackQuery.from.username;
    const mention = user ? `@${user}` : "User";

    if (action === 'hopfun_toggle_autobuy') {
        const currentAutobuy = retrieveSetting('AUTOBUY') === 'true';
        const newAutobuy = !currentAutobuy;
        updateSetting('AUTOBUY', newAutobuy ? 'true' : 'false');

        const autobuyStatus = newAutobuy ? '🟢' : '🔴';
        const defaultAutobuyAmount = retrieveSetting('DEFAULT_AUTOBUY_AMOUNT');
        const checkRepeatSocials = retrieveSetting('CHECK_REPEAT_SOCIALS') === 'true' ? '🟢' : '🔴';
        const updatedMessage = generateSettingsMessage();
        const opts = {
            reply_markup: generateSettingsKeyboard(autobuyStatus, defaultAutobuyAmount, checkRepeatSocials),
            parse_mode: 'Markdown'
        };

        bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            ...opts as any
        });
    } else if (action === 'hopfun_set_autobuy_amount') {
        bot.sendMessage(chatId, `${mention}; Please enter the new default autobuy amount:`, {
            reply_markup: {
                force_reply: true,
            }
        }).then((sentMessage) => {
            const replyListener = (msg: any) => {
                if (msg.reply_to_message && msg.reply_to_message.message_id === sentMessage.message_id) {
                    const newAmount: any = msg.text;

                    // Validate the new amount
                    if (isNaN(newAmount)) {
                        bot.sendMessage(chatId, `${mention}; Invalid amount. Please provide a numeric value.`);
                    } else {
                        updateSetting('DEFAULT_AUTOBUY_AMOUNT', newAmount);

                        // Update the settings message
                        const autobuyStatus = retrieveSetting('AUTOBUY') === 'true' ? '🟢' : '🔴';
                        const checkRepeatSocials = retrieveSetting('CHECK_REPEAT_SOCIALS') === 'true' ? '🟢' : '🔴';
                        const updatedMessage = generateSettingsMessage();
                        const opts = {
                            reply_markup: generateSettingsKeyboard(autobuyStatus, newAmount, checkRepeatSocials),
                            parse_mode: 'Markdown'
                        };

                        bot.editMessageText(updatedMessage, {
                            chat_id: chatId,
                            message_id: callbackQuery.message.message_id,
                            ...opts as any
                        });

                        // Delete the prompt message and the user's reply
                        bot.deleteMessage(chatId, sentMessage.message_id);
                        bot.deleteMessage(chatId, msg.message_id);
                    }

                    // Remove the listener after handling the message
                    bot.removeListener('message', replyListener);
                }
            };

            // Add a listener for the next message from the user
            bot.on('message', replyListener);
        });
    } else if (action === 'hopfun_toggle_check_repeat_socials') {
        const checkRepeatSocials = retrieveSetting('CHECK_REPEAT_SOCIALS') === 'true';
        const newCheckRepeatSocials = !checkRepeatSocials;
        updateSetting('CHECK_REPEAT_SOCIALS', newCheckRepeatSocials ? 'true' : 'false');

        const autobuyStatus = retrieveSetting('AUTOBUY') === 'true' ? '🟢' : '🔴';
        const checkRepeatSocialsStatus = newCheckRepeatSocials ? '🟢' : '🔴';
        const defaultAutobuyAmount = retrieveSetting('DEFAULT_AUTOBUY_AMOUNT');
        const updatedMessage = generateSettingsMessage();
        const opts = {
            reply_markup: generateSettingsKeyboard(autobuyStatus, defaultAutobuyAmount, checkRepeatSocialsStatus),
            parse_mode: 'Markdown'
        };

        bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            ...opts as any
        });
    } else if (action === 'hopfun_main_menu') {
        const generateMainMenuMessage = () => {
            return `*Main Menu*:\n`;
        };

        const generateMainMenuKeyboard = () => {
            return {
                inline_keyboard: [
                    [{ text: '🛒 Buy', callback_data: 'menu_hopfun_buy' }],
                    [{ text: '💸 Sell', callback_data: 'menu_hopfun_sell' }],
                    [{ text: '📊 Holdings', callback_data: 'menu_hopfun_holdings' }],
                    [{ text: '⚙️ Settings', callback_data: 'menu_hopfun_settings' }],
                    [{ text: '❌ Close Menu', callback_data: 'menu_hopfun_close' }]
                ]
            };
        };

        const message = generateMainMenuMessage();
        const opts: any = {
            reply_markup: generateMainMenuKeyboard(),
            parse_mode: 'Markdown'
        };
        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            ...opts as any
        });
    }
};

const generateMainMenuMessage = () => {
    return `*Main Menu*:\n`;
};

const generateMainMenuKeyboard = () => {
    return {
        inline_keyboard: [
            [{ text: '🛒 Buy', callback_data: 'menu_hopfun_buy' }],
            [{ text: '💸 Sell', callback_data: 'menu_hopfun_sell' }],
            [{ text: '📊 Holdings', callback_data: 'menu_hopfun_holdings' }],
            [{ text: '⚙️ Settings', callback_data: 'menu_hopfun_settings' }],
            [{ text: '❌ Close Menu', callback_data: 'menu_hopfun_close' }]
        ]
    };
};

// Handle the /hopfun command
bot.onText(/\/hopfun/, restrictAccess((msg) => {
    const chatId = msg.chat.id;
    const message = generateMainMenuMessage();
    const opts: any = {
        reply_markup: generateMainMenuKeyboard(),
        parse_mode: 'Markdown'
    };

    bot.sendMessage(chatId, message, opts);
}));

export const handleBuyCallbackQuery = async (callbackQuery: any) => {
    const chatId = callbackQuery.message.chat.id;
    const user = callbackQuery.from.username; // This is the Telegram username
    const mention = user ? `@${user}` : "User";

    bot.sendMessage(chatId, `${mention}; Please enter the bonding curve id you want to buy:`, {
        reply_markup: {
            force_reply: true,
        }
    }).then((sentMessage) => {
        const addressListener = (msg: any) => {
            if (msg.reply_to_message && msg.reply_to_message.message_id === sentMessage.message_id) {
                const tokenAddress = msg.text.trim();
                bot.sendMessage(chatId, `${mention}; Please enter the amount of SUI you want to spend:`, {
                    reply_markup: {
                        force_reply: true,
                    }
                }).then((amountMessage) => {
                    const amountListener = async (msg: any) => {
                        if (msg.reply_to_message && msg.reply_to_message.message_id === amountMessage.message_id) {
                            const totalSuiToSpend = msg.text.trim();

                            logger.info(totalSuiToSpend)
                            
                            // Call the buyTokens module with tokenAddress and totalEthToSpend
                            const success = await buyTokens(tokenAddress, totalSuiToSpend);
                            if (success === true) {
                                bot.sendMessage(chatId, `✅ ${mention}; Purchase of ${tokenAddress} using ${totalSuiToSpend} SUI was successful!`);
                            } else {
                                bot.sendMessage(chatId, `❌ ${mention}; Error during purchase of ${tokenAddress}`);
                            }

                            // Clean up messages
                            bot.deleteMessage(chatId, sentMessage.message_id);
                            bot.deleteMessage(chatId, msg.message_id);
                            bot.deleteMessage(chatId, amountMessage.message_id);
                            bot.removeListener('message', amountListener);
                        }
                    };
                    bot.on('message', amountListener);
                });

                bot.removeListener('message', addressListener);
            }
        };
        bot.on('message', addressListener);
    });
};

export const handleSellCallbackQuery = async (callbackQuery: any) => {
    /*
    const chatId = callbackQuery.message.chat.id;
    const user = callbackQuery.from.username; // This is the Telegram username
    const mention = user ? `@${user}` : "User";

    bot.sendMessage(chatId, `${mention}; Please enter the token address you want to sell:`, {
        reply_markup: {
            force_reply: true,
        }
    }).then((sentMessage) => {
        const addressListener = (msg: any) => {
            if (msg.reply_to_message && msg.reply_to_message.message_id === sentMessage.message_id) {
                const tokenAddress = msg.text.trim();
                bot.sendMessage(chatId, `${mention}; Please enter the percentage of tokens you want to sell:`, {
                    reply_markup: {
                        force_reply: true,
                    }
                }).then((percentMessage) => {
                    const percentListener = async (percentMsg: any) => {
                        if (percentMsg.reply_to_message && percentMsg.reply_to_message.message_id === percentMessage.message_id) {
                            const sellPercent = percentMsg.text.trim();

                            // Call the sellTokens module with tokenAddress and sellPercent
                            const success = await sellTokens(tokenAddress, sellPercent);
                            if (success === true) {
                                bot.sendMessage(chatId, `✅ ${mention}; Successfully sold ${sellPercent}% of ${tokenAddress}`);
                            } else {
                                bot.sendMessage(chatId, `❌ ${mention}; Error selling ${sellPercent}% of ${tokenAddress}`);
                            }

                            // Clean up messages
                            bot.deleteMessage(chatId, sentMessage.message_id); // Delete the address message
                            bot.deleteMessage(chatId, msg.message_id); // Delete the user's address response
                            bot.deleteMessage(chatId, percentMsg.message_id); // Delete the user's percentage response
                            bot.deleteMessage(chatId, percentMessage.message_id); // Delete the percentage prompt message
                            bot.removeListener('message', percentListener);
                        }
                    };
                    bot.on('message', percentListener);
                });

                bot.removeListener('message', addressListener);
            }
        };
        bot.on('message', addressListener);
    });
    */
};

export const handleHoldingsCallbackQuery = async (callbackQuery: any) => {
    const chatId = callbackQuery.message.chat.id;
    return;
};
