const SCOPES = 'spark:kms cjp:user cjp:config cjp:config_read cjp:config_write';

function showNotify(title, message, isError = false) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: isError ? 'icon48.png' : 'icon48.png', // You can use a red version for errors if you have one
        title: title,
        message: message,
        priority: 2
    });
}

chrome.action.onClicked.addListener(async (tab) => {
    try {
        const settings = await chrome.storage.local.get(['staticEpId', 'originNumber', 'clientId', 'clientSecret']);
        
        if (!settings.staticEpId || !settings.originNumber || !settings.clientId || !settings.clientSecret) {
            showNotify("Configuration Required", "Please right-click the extension and set your credentials in Options.", true);
            chrome.runtime.openOptionsPage();
            return;
        }

        const match = tab.url.match(/\/flow\/([a-f0-9]+)/);
        if (!match) {
            showNotify("Invalid Page", "Please navigate to a Webex Flow Designer page.", true);
            return;
        }
        const targetFlowId = match[1];
        const orgId = new URL(tab.url).searchParams.get("orgId");

        const accessToken = await getValidToken();
        
        // 1. Check/Update Routing
        await ensureEntryPointRouting(accessToken, targetFlowId, orgId, settings.staticEpId);
        
        // 2. Execute Task
        await createWebexTask(accessToken, settings.staticEpId, settings.originNumber);
        
        // 3. Success Notification!
        showNotify("Flow Executed", `Check your debugger for a new execution!`);

    } catch (error) {
        console.error(error);
        // 4. Failure Notification
        showNotify("Execution Failed", error.message, true);
    }
});

async function getValidToken() {
    const data = await chrome.storage.local.get(['webex_access_token', 'webex_expires_at', 'clientId', 'clientSecret']);
    
    // Check if we have credentials at all
    if (!data.clientId || !data.clientSecret) {
        throw new Error("API Credentials missing in Settings.");
    }

    const now = Date.now();
    if (data.webex_access_token && data.webex_expires_at && now < data.webex_expires_at - 300000) {
        return data.webex_access_token;
    }

    return await fetchNewToken(data.clientId, data.clientSecret);
}

async function fetchNewToken(clientId, clientSecret) {
    const redirectUri = chrome.identity.getRedirectURL(); 
    const authUrl = `https://webexapis.com/v1/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES)}&state=extension_auth`;

    const responseUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true
    });

    const url = new URL(responseUrl);
    const code = url.searchParams.get('code');

    if (!code) throw new Error("Failed to get authorization code.");

    const tokenResponse = await fetch('https://webexapis.com/v1/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
            redirect_uri: redirectUri
        })
    });

    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token) {
        throw new Error("Failed to exchange code for token: " + JSON.stringify(tokenData));
    }

    // 3. Calculate expiration timestamp (convert expires_in seconds to milliseconds)
    const expiresAt = Date.now() + (tokenData.expires_in * 1000);

    // 4. Save the new token and its expiration time to local browser storage
    await chrome.storage.local.set({
        'webex_access_token': tokenData.access_token,
        'webex_expires_at': expiresAt
    });

    return tokenData.access_token;
}

// Updated signature to accept epId
async function ensureEntryPointRouting(accessToken, targetFlowId, orgId, epId) {
    // Use the epId passed from settings instead of a hardcoded constant
    const apiUrl = `https://api.wxcc-us1.cisco.com/organization/${orgId}/entry-point/${epId}`;

    console.log("Fetching current Entry Point configuration...");
    const getResponse = await fetch(apiUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
        }
    });

    if (!getResponse.ok) throw new Error(`Failed to GET Entry Point: ${getResponse.status}`);
    const entryPointConfig = await getResponse.json();

    if (entryPointConfig.flowId === targetFlowId) {
        console.log("Entry Point is already routed to this flow. No update needed.");
        return; 
    }

    console.log(`Mismatch detected. Updating Entry Point ${epId} to flow: ${targetFlowId}`);
    entryPointConfig.flowId = targetFlowId;
    
    const putResponse = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(entryPointConfig)
    });

    if (!putResponse.ok) {
        const err = await putResponse.text();
        throw new Error(`Failed to UPDATE Entry Point: ${putResponse.status} - ${err}`);
    }

    console.log("Entry Point updated successfully.");
}

async function createWebexTask(accessToken, epId, originNumber) {
    const apiUrl = 'https://api.wxcc-us1.cisco.com/v1/tasks'; 
    
    const payload = {
        "destination": "1000",
        "entryPointId": epId,        // Dynamically injected from Options
        "outboundType": "EXECUTE_FLOW",
        "mediaType": "telephony",
        "origin": originNumber       // Dynamically injected from Options
    };

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API call failed: ${response.status} - ${err}`);
    }

    const data = await response.json();
    console.log("API Response:", data);
    return data;
}