import proxyAxios from '../proxy/proxyAxios';

const MAX_REQUEST_TIME = 8000;  // 8 seconds
const API_URL = 'https://ape.store/api/token/base/';
const HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

function normalizeData(data: any) {
    const { token, ...rest } = data;
    return { ...token, ...rest };
}

async function main(tokenToBuy: any) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await proxyAxios.get(API_URL + tokenToBuy, { headers: HEADERS, timeout: MAX_REQUEST_TIME });
            if (response.status === 200 && response.data) {
                return normalizeData(response.data);  // Normalize and return the data
            } else if (response.status === 200) {
                return;  // Exit function as there's no need to retry for this condition
            } else {
                continue;
            }
        } catch (error: any) {
            if (error.code === 'ECONNABORTED' && error.message.indexOf('timeout') !== -1) {
                console.error(`Request for token address ${tokenToBuy} timed out.`);
            } else if (error.response && (error.response.status === 429 || error.response.status === 504)) {
                console.error(`Error (status ${error.response.status}) for token address ${tokenToBuy}.`);
            } else {
                console.error(`Error searching for token address ${tokenToBuy}:`, error.message);
            }
            if (attempt === 2) {  // Last attempt
                return null;  // Return null after the last retry attempt
            }
        }
    }
}

export default main;
