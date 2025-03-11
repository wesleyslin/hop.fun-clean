import TelegramBot from 'node-telegram-bot-api';
import { retrieveEnvVariable } from '../utils/utils';

const TG_BOT_TOKEN = retrieveEnvVariable('TG_BOT_TOKEN');
const bot = new TelegramBot(TG_BOT_TOKEN, { polling: true });
const TG_CHAT_ID = retrieveEnvVariable('TG_CHAT_ID');

export { bot, TG_CHAT_ID };