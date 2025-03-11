import { Logger, pino } from 'pino';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Create and export the logger
export const logger = pino();

export const retrieveEnvVariable = (variableName: string) => {
    const variable = process.env[variableName] || '';
    if (!variable) {
        logger.error(`${variableName} is not set`);
        process.exit(1);
    }
    return variable;
};

const settingsPath = path.join(__dirname, '../settings.json');

export const retrieveSetting = (settingName: string) => {
    try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (settings[settingName] === undefined) {
            logger.error(`${settingName} is not set`);
            return null;
        }
        return settings[settingName];
    } catch (error: any) {
        logger.error(`Error reading settings: ${error.message}`);
        process.exit(1);
    }
};

export const updateSetting = (settingName: string, value: any) => {
    try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        settings[settingName] = value;
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (error: any) {
        logger.error(`Error updating settings: ${error.message}`);
        process.exit(1);
    }
};
