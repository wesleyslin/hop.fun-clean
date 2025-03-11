// proxyAxios.ts
import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
dotenv.config();

const RETRY_CONFIG = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 5000
};

// Create custom HTTPS agent that ignores certificate errors
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Format proxy auth properly
const proxyAuth = {
    username: 'brd-customer-hl_c1ebbeb3-zone-sui',
    password: '9do7qrasdt6q'
};

const proxyAxios = axios.create({
    proxy: {
        host: 'brd.superproxy.io',
        port: 22225,
        auth: {
            username: proxyAuth.username,
            password: proxyAuth.password
        },
        protocol: 'https'
    },
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    }),
    timeout: 10000,
    headers: {
        'Connection': 'keep-alive',
        'Keep-Alive': 'timeout=5, max=1000',
        'Proxy-Authorization': `Basic ${Buffer.from(`${proxyAuth.username}:${proxyAuth.password}`).toString('base64')}`
    }
});

// Add retry interceptor with better error handling
proxyAxios.interceptors.response.use(undefined, async (err) => {
    // Make sure we have a config object
    if (!err.config) {
        return Promise.reject(err);
    }

    // Initialize retry count if not present
    err.config.retry = err.config.retry || 0;

    // Check if we should retry
    if (err.config.retry >= RETRY_CONFIG.maxRetries) {
        return Promise.reject(err);
    }

    // Increment retry count
    err.config.retry += 1;

    // Calculate delay time
    const delayTime = Math.min(
        RETRY_CONFIG.initialDelay * Math.pow(2, err.config.retry - 1),
        RETRY_CONFIG.maxDelay
    );

    console.log(`Proxy connection failed (attempt ${err.config.retry}/${RETRY_CONFIG.maxRetries}). Retrying in ${delayTime}ms...`);
    await new Promise(resolve => setTimeout(resolve, delayTime));

    // Return new promise
    return proxyAxios(err.config);
});

export default proxyAxios;